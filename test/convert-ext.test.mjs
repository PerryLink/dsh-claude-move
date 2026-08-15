// convert-ext.test.mjs — 转换核心扩展行为单测：畸形行行号、custom-title 优先级、
// 类型计数、非对象行。上游行为由 vendored convert.test.mjs 覆盖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { convertClaudeJsonl, createClaudeStreamConverter, validateSessionEvents, SYNTHETIC_TOOL_RESULT_TEXT, MALFORMED_REPORT_CAP } from '../lib/convert.mjs'
import { summarizePermissions } from '../lib/report.mjs'

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

function claudeLine(type, extra = {}) {
  return JSON.stringify({
    type,
    timestamp: '2026-08-01T10:00:00.000Z',
    sessionId: 'sess-ext',
    cwd: 'D:\\demo\\proj',
    ...extra,
  })
}

test('convertClaudeJsonl：畸形行带行号明细且计数一致（F10）', () => {
  const raw = [
    claudeLine('user', { message: { content: 'q1' } }),
    '{ broken 1',
    claudeLine('assistant', { message: { content: [{ type: 'text', text: 'a1' }] } }),
    'not json at all',
    '42',
    claudeLine('user', { message: { content: 'q2' } }),
  ].join('\n') + '\n'

  const out = convertClaudeJsonl(raw)
  assert.equal(out.skipped, 3)
  assert.deepEqual(out.skippedLines.map((l) => l.line), [2, 4, 5], '行号 1-based，空行不计')
  assert.equal(out.skippedLines[0].error.length > 0, true)
  assert.equal(out.turns.length, 2, '畸形行不中断轮次解析')
})

test('convertClaudeJsonl：custom-title 优先于 ai-title（F9 标题钉住）', () => {
  const raw = [
    claudeLine('ai-title', { aiTitle: 'ai 标题' }),
    claudeLine('custom-title', { customTitle: 'custom 标题' }),
    claudeLine('user', { message: { content: 'q' } }),
    claudeLine('assistant', { message: { content: [{ type: 'text', text: 'a' }] } }),
  ].join('\n') + '\n'
  const out = convertClaudeJsonl(raw)
  assert.equal(out.title, 'custom 标题')
  const titleEvent = out.events.find((e) => e.type === 'session/title')
  assert.equal(titleEvent.data.title, 'custom 标题')
})

test('convertClaudeJsonl：typeCounts 覆盖权限类与未知类型（S5）', () => {
  const raw = [
    claudeLine('permission', { permission: { rule: 'bash' } }),
    claudeLine('queue-operation', {}),
    claudeLine('some-future-type', {}),
    claudeLine('user', { message: { content: 'q' } }),
  ].join('\n') + '\n'
  const out = convertClaudeJsonl(raw)
  assert.equal(out.typeCounts.permission, 1)
  assert.equal(out.typeCounts['queue-operation'], 1)
  assert.equal(out.typeCounts['some-future-type'], 1, '未知类型宽容计数，不 fail')
  const perms = summarizePermissions(out.typeCounts)
  assert.equal(perms.total, 2)
  assert.deepEqual(perms.byType, { permission: 1, 'queue-operation': 1 })
})

test('convertClaudeJsonl：sourceId 暴露供导入映射（F9）', () => {
  const raw = claudeLine('user', { message: { content: 'q' } }) + '\n'
  const out = convertClaudeJsonl(raw)
  assert.equal(out.sourceId, 'sess-ext')
})

test('MALFORMED_REPORT_CAP：畸形行明细有上限，计数不受限', () => {
  const lines = []
  for (let i = 0; i < MALFORMED_REPORT_CAP + 10; i++) lines.push('{ nope')
  lines.push(claudeLine('user', { message: { content: 'q' } }))
  const out = convertClaudeJsonl(lines.join('\n'))
  assert.equal(out.skipped, MALFORMED_REPORT_CAP + 10)
  assert.equal(out.skippedLines.length, MALFORMED_REPORT_CAP)
})

test('createClaudeStreamConverter：分块 feed 与整段转换结果一致（C3）', () => {
  const raw = [
    claudeLine('user', { message: { content: 'q1' } }),
    claudeLine('assistant', { message: { content: [{ type: 'text', text: 'a1' }] } }),
    claudeLine('user', { message: { content: 'q2' } }),
    claudeLine('assistant', { message: { content: [{ type: 'thinking', thinking: '想一下' }] } }),
  ].join('\n') + '\n'
  const whole = convertClaudeJsonl(raw)

  const batches = []
  const converter = createClaudeStreamConverter({ keepTurns: true, onBatch: (events) => batches.push(events) })
  // 2 字符一块：跨行边界切分，carry 逻辑全程参与。
  for (let i = 0; i < raw.length; i += 2) converter.feed(raw.slice(i, i + 2))
  const result = converter.end()

  assert.deepEqual(batches.flat().map((e) => ({ type: e.type, seq: e.seq, data: e.data })),
    whole.events.map((e) => ({ type: e.type, seq: e.seq, data: e.data })), '分块与整段事件完全一致')
  assert.deepEqual(result.meta, whole.meta)
  assert.equal(result.turns.length, whole.turns.length)
  assert.equal(result.messages, whole.messages)
  assert.equal(result.toolCalls, whole.toolCalls)
})

test('createClaudeStreamConverter：batchEvents 分批且 seq 连续（C3）', () => {
  const raw = [
    claudeLine('user', { message: { content: 'q1' } }),
    claudeLine('assistant', { message: { content: [{ type: 'text', text: 'a1' }] } }),
    claudeLine('user', { message: { content: 'q2' } }),
    claudeLine('assistant', { message: { content: [{ type: 'text', text: 'a2' }] } }),
  ].join('\n') + '\n'
  const batches = []
  const converter = createClaudeStreamConverter({ batchEvents: 4, onBatch: (events) => batches.push(events) })
  converter.feed(raw)
  const result = converter.end()
  assert.ok(batches.length >= 2, '小批大小强制多次回调')
  const all = batches.flat()
  assert.equal(all.length, result.emittedEvents)
  for (let i = 0; i < all.length; i++) assert.equal(all[i].seq, i, 'seq 连续')
})

test('createClaudeStreamConverter：skipTurns/startSeq 续写前缀（C3）', () => {
  const raw = [
    claudeLine('user', { message: { content: 'q1' } }),
    claudeLine('assistant', { message: { content: [{ type: 'text', text: 'a1' }] } }),
    claudeLine('user', { message: { content: 'q2' } }),
    claudeLine('assistant', { message: { content: [{ type: 'text', text: 'a2' }] } }),
    claudeLine('user', { message: { content: 'q3' } }),
    claudeLine('assistant', { message: { content: [{ type: 'text', text: 'a3' }] } }),
  ].join('\n') + '\n'
  const whole = convertClaudeJsonl(raw)

  // 前缀 = 前 2 轮的事件（含其后未落盘的标题？标题在最后，不含在前缀里）。
  const prefixEvents = whole.events.filter((e) => {
    if (e.type === 'turn/start') return e.data.turn <= 2
    if (e.type === 'session/title') return false
    const turnRef = e.data?.turn
    return typeof turnRef === 'number' && turnRef <= 2
  }).length

  const batches = []
  const converter = createClaudeStreamConverter({
    skipTurns: 2, startSeq: prefixEvents, onBatch: (events) => batches.push(events),
  })
  converter.feed(raw)
  const result = converter.end()
  const tail = batches.flat()
  assert.ok(tail.length > 0)
  assert.equal(tail[0].seq, prefixEvents, '新事件 seq 从存储长度起')
  assert.equal(tail[0].type, 'turn/start')
  assert.equal(tail[0].data.turn, 3, '续写从第 3 轮起')
  assert.equal(result.turns, 3, 'turns 为轮次数')
  for (let i = 0; i < tail.length; i++) assert.equal(tail[i].seq, prefixEvents + i, '续写 seq 连续')
})

test('convertClaudeJsonl：中断工具调用补为恰好一条合成 tool/result（issue#1）', () => {
  const raw = readFileSync(fixture('interrupted-tool.jsonl'), 'utf8')
  const out = convertClaudeJsonl(raw)
  // toolu_int_1 无结果 → 合成 1 条；toolu_dup 两条结果 → 丢弃 1 条；
  // toolu_orphan 无声明 → 丢弃。
  assert.deepEqual(out.repaired, { synthesized: 1, duplicateResults: 1, orphanResults: 1 })

  const byCallId = new Map()
  for (const ev of out.events) {
    if (ev.type === 'tool/result') {
      const id = ev.data.message.content[0].toolCallId
      byCallId.set(id, (byCallId.get(id) ?? 0) + 1)
    }
  }
  assert.equal(byCallId.get('toolu_int_1'), 1, '被中断的调用恰好一条结果')
  assert.equal(byCallId.get('toolu_int_2'), 1, '正常调用一条结果')
  assert.equal(byCallId.get('toolu_dup'), 1, '重复结果去重为一条')
  assert.equal(byCallId.has('toolu_orphan'), false, '孤儿结果被丢弃')

  const synth = out.events.find((e) => e.type === 'tool/result'
    && e.data.message.content[0].toolCallId === 'toolu_int_1')
  assert.equal(synth.data.message.content[0].isError, true, '合成结果标记 isError')
  assert.equal(synth.data.message.content[0].content[0].text, SYNTHETIC_TOOL_RESULT_TEXT)
  assert.deepEqual(synth.sourceEventSeqs, [out.events.find((e) => e.type === 'tool/call'
    && e.data.callId === 'toolu_int_1').seq], '合成结果关联声明的 tool/call')

  assert.deepEqual(validateSessionEvents(out.events), [], '合成日志满足续聊协议不变式')
})

test('convertClaudeJsonl：流式路径同样修复中断工具调用（issue#1）', () => {
  const raw = readFileSync(fixture('interrupted-tool.jsonl'), 'utf8')
  const batches = []
  const converter = createClaudeStreamConverter({ onBatch: (events) => batches.push(events) })
  converter.feed(raw)
  const result = converter.end()
  assert.deepEqual(result.repaired, { synthesized: 1, duplicateResults: 1, orphanResults: 1 })
  assert.deepEqual(validateSessionEvents(batches.flat()), [], '流式路径输出同样平衡')
})

test('validateSessionEvents：不平衡日志被逐条报出（issue#1 自校验）', () => {
  const meta = { version: 0, id: 'import-x', createdAt: 1 }
  const mk = (type, seq, data) => ({ type, seq, time: 1, data })
  const missingResult = [
    mk('turn/start', 0, { turn: 1 }),
    mk('user/message', 1, { role: 'user' }),
    mk('assistant/message', 2, { message: { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'Bash', arguments: '{}' }] } }),
    mk('tool/call', 3, { callId: 'c1', name: 'Bash', arguments: '{}' }),
    mk('turn/end', 4, { turn: 1 }),
  ]
  const issues = validateSessionEvents(missingResult)
  assert.ok(issues.some((i) => i.includes('tool/call c1 has no tool/result')), issues)

  const orphan = [
    mk('turn/start', 0, { turn: 1 }),
    mk('tool/result', 1, { message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'ghost', content: [] }] } }),
    mk('turn/end', 2, { turn: 1 }),
  ]
  const issues2 = validateSessionEvents(orphan)
  assert.ok(issues2.some((i) => i.includes("tool/result ghost has no tool/call")), issues2)

  const duplicate = [
    mk('turn/start', 0, { turn: 1 }),
    mk('tool/call', 1, { callId: 'c1', name: 'Bash', arguments: '{}' }),
    mk('tool/result', 2, { message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [] }] } }),
    mk('tool/result', 3, { message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [] }] } }),
    mk('turn/end', 4, { turn: 1 }),
  ]
  const issues3 = validateSessionEvents(duplicate)
  assert.ok(issues3.some((i) => i.includes('tool/call c1 has 2 tool/result events')), issues3)
})

test('validateSessionEvents：seq 断档与 step 未闭合被报出', () => {
  const mk = (type, seq, data) => ({ type, seq, time: 1, data })
  const issues = validateSessionEvents([
    mk('turn/start', 0, { turn: 1 }),
    mk('user/message', 2, { role: 'user' }),
    mk('step/start', 3, { turn: 1, step: 1 }),
    mk('turn/end', 4, { turn: 1 }),
  ])
  assert.ok(issues.some((i) => i.includes('seq gap at 1')), issues)
  assert.ok(issues.some((i) => i.includes('turn ended with 1 open steps')), issues)
})
