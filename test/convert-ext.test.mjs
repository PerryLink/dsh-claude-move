// convert-ext.test.mjs — 转换核心扩展行为单测：畸形行行号、custom-title 优先级、
// 类型计数、非对象行。上游行为由 vendored convert.test.mjs 覆盖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convertClaudeJsonl, createClaudeStreamConverter, MALFORMED_REPORT_CAP } from '../lib/convert.mjs'
import { summarizePermissions } from '../lib/report.mjs'

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
