// opencode-parser.test.mjs — OpenCode 解析器：SQLite 检测、旧版 JSON 兜底、
// agents/commands/AGENTS.md、只读白名单负例。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { detect, locateHome, locateConfigHome, whitelist, openDb } from '../../lib/sources/opencode/parser.mjs'
import { assertAllowedRead } from '../../lib/sources/contract.mjs'

/** 搭一个最小 opencode.db（session/message/part 表 + 合成数据）。 */
function makeFixtureDb(dir) {
  const dbPath = path.join(dir, 'opencode.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY, title TEXT, directory TEXT,
      time_created INTEGER, time_updated INTEGER, time_archived INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
    );
  `)
  db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?)')
    .run('ses_new', 'Fix the build', 'D:\\repo\\app', 1000, 3000, null)
  db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?)')
    .run('ses_archived', 'Old one', 'D:\\repo\\old', 500, 600, 999)
  db.prepare('INSERT INTO message VALUES (?,?,?,?,?)')
    .run('msg_1', 'ses_new', 1000, 1000, JSON.stringify({ role: 'user' }))
  db.prepare('INSERT INTO message VALUES (?,?,?,?,?)')
    .run('msg_2', 'ses_new', 2000, 2000, JSON.stringify({ role: 'assistant', modelID: 'claude-sonnet-4-6', providerID: 'anthropic' }))
  db.prepare('INSERT INTO part VALUES (?,?,?,?,?,?)')
    .run('prt_1', 'msg_2', 'ses_new', 2000, 2000, JSON.stringify({ type: 'tool', tool: 'bash', callID: 'c1', state: { status: 'completed', input: { command: 'ls' }, output: 'x' } }))
  db.close()
  return dbPath
}

test('locateHome / locateConfigHome：环境变量优先', () => {
  assert.equal(locateHome({ OPENCODE_DATA_HOME: 'D:\\oc-data' }), 'D:\\oc-data')
  assert.equal(locateConfigHome({ OPENCODE_CONFIG_HOME: 'D:\\oc-config' }), 'D:\\oc-config')
})

test('detect：SQLite 会话（标题/目录/统计/归档过滤）', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'opencode-home-'))
  const config = await mkdtemp(path.join(tmpdir(), 'opencode-config-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  t.after(() => rm(config, { recursive: true, force: true }))
  makeFixtureDb(home)

  const d = await detect(home, { configHome: config })
  assert.equal(d.source, 'opencode')
  assert.equal(d.sessions.length, 1) // 归档会话被过滤
  const s = d.sessions[0]
  assert.equal(s.sessionId, 'ses_new')
  assert.equal(s.title, 'Fix the build')
  assert.equal(s.cwd, 'D:\\repo\\app')
  assert.equal(s.turns, 1)
  assert.equal(s.messages, 2)
  assert.equal(s.toolCalls, 1)
  assert.equal(s.format, 'opencode-db')
})

test('detect：旧版 storage JSON 布局兜底（无 db 时）', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'opencode-legacy-'))
  const config = await mkdtemp(path.join(tmpdir(), 'opencode-config-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  t.after(() => rm(config, { recursive: true, force: true }))
  const sessionDir = path.join(home, 'storage', 'session', 'global')
  const messageDir = path.join(home, 'storage', 'message', 'ses_legacy')
  await mkdir(sessionDir, { recursive: true })
  await mkdir(messageDir, { recursive: true })
  await writeFile(path.join(sessionDir, 'ses_legacy.json'), JSON.stringify({
    id: 'ses_legacy', title: 'Legacy chat', directory: 'D:\\repo', time: { created: 100, updated: 200 },
  }))
  await writeFile(path.join(messageDir, 'msg_a.json'), JSON.stringify({ id: 'msg_a', role: 'user' }))
  await writeFile(path.join(messageDir, 'msg_b.json'), JSON.stringify({ id: 'msg_b', role: 'assistant' }))

  const d = await detect(home, { configHome: config })
  assert.equal(d.sessions.length, 1)
  assert.equal(d.sessions[0].sessionId, 'ses_legacy')
  assert.equal(d.sessions[0].format, 'opencode-legacy')
  assert.equal(d.sessions[0].messages, 2)
})

test('detect：agents → 技能条目（一律转换）、commands 分类、全局 AGENTS.md', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'opencode-home-'))
  const config = await mkdtemp(path.join(tmpdir(), 'opencode-config-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  t.after(() => rm(config, { recursive: true, force: true }))
  await mkdir(path.join(config, 'agent'), { recursive: true })
  await mkdir(path.join(config, 'command'), { recursive: true })
  await writeFile(path.join(config, 'agent', 'reviewer.md'), '# Reviewer\n\nYou review diffs.\n')
  await writeFile(path.join(config, 'command', 'test.md'), 'Run the test suite for this change.\n')
  await writeFile(path.join(config, 'command', 'ship.md'), 'Deploy.\n```!command\nnpm publish\n```\n')
  await writeFile(path.join(config, 'AGENTS.md'), '# Global rules\nAlways test.\n')
  await writeFile(path.join(home, 'auth.json'), JSON.stringify({ openai: { type: 'api', key: 'sk-secret' } })) // 白名单外，绝不读取

  const d = await detect(home, { configHome: config })
  assert.equal(d.skills.length, 1)
  assert.equal(d.skills[0].name, 'reviewer')
  assert.equal(d.skills[0].compatible, false)
  assert.equal(d.commands.length, 2)
  const testCmd = d.commands.find((c) => c.id === 'test')
  const shipCmd = d.commands.find((c) => c.id === 'ship')
  assert.equal(testCmd.promptOnly, true)
  assert.equal(shipCmd.promptOnly, false)
  assert.equal(d.instructions.length, 1)
  assert.equal(d.instructions[0].kind, 'agents-md')
})

test('白名单：auth.json / log / snapshot 越界读抛错；opencode.db 放行', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'opencode-home-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const roots = whitelist(home)
  assert.throws(() => assertAllowedRead(roots, path.join(home, 'auth.json')), /越界/)
  assert.throws(() => assertAllowedRead(roots, path.join(home, 'log', 'x.log')), /越界/)
  assert.throws(() => assertAllowedRead(roots, path.join(home, 'snapshot')), /越界/)
  assert.equal(assertAllowedRead(roots, path.join(home, 'opencode.db')), path.join(home, 'opencode.db'))
})

test('openDb：只读打开可用（node:sqlite 特性探测）', (t) => {
  const dir = path.join(tmpdir(), 'opencode-db-probe-' + Date.now())
  mkdirSync(dir, { recursive: true })
  t.after(() => rm(dir, { recursive: true, force: true }))
  const dbPath = makeFixtureDb(dir)
  const db = openDb(dbPath)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session').get().n, 2)
  db.close()
})
