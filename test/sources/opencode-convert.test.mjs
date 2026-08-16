// opencode-convert.test.mjs — OpenCode 会话转换：回合/步骤合成、工具调用平衡、
// 标题唯一、事件纪律（validateSessionEvents）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convertOpencodeRows, loadDbSessionRows } from '../../lib/sources/opencode/convert.mjs'
import { validateSessionEvents } from '../../lib/convert.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

function makeDb(rows) {
  const dir = mkdtempSync(path.join(tmpdir(), 'opencode-conv-'))
  const dbPath = path.join(dir, 'opencode.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
  `)
  db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?)').run('ses_a', 'DB session', 'D:\\repo', 100, 900, null)
  let mi = 0
  let pi = 0
  for (const row of rows) {
    mi++
    db.prepare('INSERT INTO message VALUES (?,?,?,?,?)').run('msg_' + mi, 'ses_a', mi * 10, mi * 10, JSON.stringify(row.data))
    for (const part of row.parts ?? []) {
      pi++
      db.prepare('INSERT INTO part VALUES (?,?,?,?,?,?)').run('prt_' + pi, 'msg_' + mi, 'ses_a', pi * 10, pi * 10, JSON.stringify(part))
    }
  }
  db.close()
  return { dir, dbPath }
}

const toolPart = (extra = {}) => ({
  type: 'tool', tool: 'bash', callID: 'call_1',
  state: { status: 'completed', input: { command: 'ls' }, output: 'a.txt' },
  ...extra,
})

test('convertOpencodeRows：用户/助手回合、文本/推理/工具平衡、标题唯一', () => {
  const { dir, dbPath } = makeDb([
    { data: { role: 'user' }, parts: [{ type: 'text', text: 'List files' }] },
    {
      data: { role: 'assistant', modelID: 'm1' },
      parts: [
        { type: 'step-start' },
        { type: 'reasoning', text: 'think…' },
        { type: 'text', text: 'Here you go:' },
        toolPart(),
        { type: 'step-finish' },
      ],
    },
  ])
  try {
    const loaded = loadDbSessionRows(dbPath, 'ses_a')
    const converted = convertOpencodeRows(loaded)
    assert.equal(converted.meta.cwd, 'D:\\repo')
    assert.equal(converted.sourceId, 'ses_a')
    assert.equal(converted.turns.length, 1)
    assert.equal(converted.toolCalls, 1)
    assert.ok(converted.events.some((e) => e.type === 'assistant/message'
      && e.data.message.content.some((b) => b.type === 'reasoning')))
    // 标题事件恰好一条（session.title 优先）。
    const titles = converted.events.filter((e) => e.type === 'session/title')
    assert.equal(titles.length, 1)
    assert.equal(titles[0].data.title, 'DB session')
    assert.deepEqual(validateSessionEvents(converted.events), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('convertOpencodeRows：pending 工具调用补合成错误结果；error 状态保 isError', () => {
  const { dir, dbPath } = makeDb([
    { data: { role: 'user' }, parts: [{ type: 'text', text: 'do it' }] },
    {
      data: { role: 'assistant' },
      parts: [
        toolPart({ callID: 'pending_1', state: { status: 'pending', input: { command: 'x' } } }),
        toolPart({ callID: 'err_1', state: { status: 'error', input: { command: 'y' }, error: 'boom' } }),
      ],
    },
  ])
  try {
    const loaded = loadDbSessionRows(dbPath, 'ses_a')
    const converted = convertOpencodeRows(loaded)
    assert.deepEqual(validateSessionEvents(converted.events), [])
    const results = converted.events.filter((e) => e.type === 'tool/result')
    assert.equal(results.length, 2)
    assert.equal(converted.repaired.synthesized, 1)
    const errResult = results.find((e) => e.data.message.content[0].toolCallId === 'err_1')
    assert.equal(errResult.data.message.content[0].isError, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('convertOpencodeRows：无标题 → 首条提问兜底；多用户消息切多回合', () => {
  const loaded = {
    session: { id: 'ses_b', title: '', directory: null, time_created: 100 },
    messages: [
      { id: 'm1', data: { role: 'user' }, parts: [{ type: 'text', text: 'First question?' }] },
      { id: 'm2', data: { role: 'assistant' }, parts: [{ type: 'text', text: 'A1' }] },
      { id: 'm3', data: { role: 'user' }, parts: [{ type: 'text', text: 'Second?' }] },
      { id: 'm4', data: { role: 'assistant' }, parts: [{ type: 'text', text: 'A2' }] },
    ],
  }
  const converted = convertOpencodeRows(loaded)
  assert.equal(converted.turns.length, 2)
  const titles = converted.events.filter((e) => e.type === 'session/title')
  assert.equal(titles.length, 1)
  assert.equal(titles[0].data.title, 'First question?')
  assert.deepEqual(validateSessionEvents(converted.events), [])
})

test('convertOpencodeRows：空输入 → 空会话，不抛错', () => {
  const converted = convertOpencodeRows(null)
  assert.equal(converted.events.length, 0)
  assert.equal(converted.messages, 0)
})
