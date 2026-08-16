// SPDX-License-Identifier: Apache-2.0
// codex-parser.test.mjs — Codex 源解析器单元测试（合成 fixture，零真实 transcript）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { source, locateHome, whitelist, detect } from '../../lib/sources/codex/parser.mjs'
import { assertAllowedRead } from '../../lib/sources/contract.mjs'

/** 在临时目录内搭建合成 home（test 结束自动清理）。 */
async function withHome(t, files) {
  const home = await mkdtemp(path.join(tmpdir(), 'codex-parser-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(home, rel)
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, content)
  }
  return home
}

test('source 标识为 codex', () => {
  assert.equal(source, 'codex')
})

test('locateHome：CODEX_HOME 优先，否则 ~/.codex', () => {
  assert.equal(locateHome({ CODEX_HOME: '/data/codex' }, '/home/u'), '/data/codex')
  assert.equal(locateHome({}, '/home/u'), path.join('/home/u', '.codex'))
})

test('whitelist：只含七类路径，凭据/内部状态越界读取抛错', () => {
  const home = path.resolve('/home/u/.codex')
  const roots = whitelist(home)
  const expected = ['sessions', 'skills', 'hooks', 'memories', 'AGENTS.md', 'CODEX.md', 'config.toml']
  assert.deepEqual(roots, expected.map((r) => path.join(home, r)))

  // 正例：白名单内读取不抛。
  assert.doesNotThrow(() => assertAllowedRead(roots, path.join(home, 'sessions', 'x', 'rollout-a.jsonl')))

  // 负例：凭据与内部状态永不在白名单，越界读取直接抛错。
  const bad = [
    'auth.json',
    'state_20260518.sqlite',
    'logs_20260518.sqlite',
    'history.jsonl',
    path.join('log', 'codex.log'),
    path.join('.tmp', 'x'),
    path.join('cache', 'x'),
    path.join('tmp', 'x'),
    path.join('shell_snapshots', 'x'),
    'version.json',
  ]
  for (const rel of bad) {
    assert.throws(() => assertAllowedRead(roots, path.join(home, rel)), /越界|白名单/)
  }
})

test('detect：home 不存在 → homeExists=false 且各数组为空', async () => {
  const det = await detect(path.join(tmpdir(), 'definitely-not-a-codex-home'))
  assert.equal(det.source, 'codex')
  assert.equal(det.homeExists, false)
  assert.deepEqual(det.sessions, [])
  assert.deepEqual(det.skills, [])
  assert.deepEqual(det.memories, [])
  assert.deepEqual(det.instructions, [])
  assert.deepEqual(det.commands, [])
  assert.deepEqual(det.hooks, [])
  assert.deepEqual(det.errors, [])
})

test('detect：sessions 扫描（标题/消息/工具计数/畸形行计数）', async (t) => {
  const rollout = [
    '{"timestamp":"2026-05-18T13:21:30.751Z","type":"session_meta","payload":{"id":"sess-1","timestamp":"2026-05-18T13:20:00.000Z","cwd":"/workspace/demo"}}',
    '{"timestamp":"2026-05-18T13:21:31.000Z","type":"turn_context","payload":{"turn_id":"t1"}}',
    '{"timestamp":"2026-05-18T13:21:31.500Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"你好，修这个 bug"}]}}',
    '{"timestamp":"2026-05-18T13:21:32.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"好的"}]}}',
    '{"timestamp":"2026-05-18T13:21:33.000Z","type":"response_item","payload":{"type":"function_call","name":"shell_command","arguments":"{}","call_id":"c1"}}',
    '{"timestamp":"2026-05-18T13:21:34.000Z","type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch","input":"x","call_id":"c2"}}',
    '{not json}',
  ].join('\n')
  const home = await withHome(t, { 'sessions/2026-05/rollout-abc.jsonl': rollout })

  const det = await detect(home)
  assert.equal(det.homeExists, true)
  assert.equal(det.sessions.length, 1)
  const s = det.sessions[0]
  assert.equal(s.id, 'sess-1')
  assert.equal(s.file, path.join(home, 'sessions', '2026-05', 'rollout-abc.jsonl'))
  assert.equal(s.format, 'rollout-jsonl')
  assert.equal(s.title, '你好，修这个 bug')
  assert.equal(s.cwd, '/workspace/demo')
  assert.equal(s.createdAt, Date.parse('2026-05-18T13:20:00.000Z'))
  assert.equal(s.lastActivity, Date.parse('2026-05-18T13:21:34.000Z'))
  assert.equal(s.turns, 1)
  assert.equal(s.messages, 2)
  assert.equal(s.toolCalls, 2)
  assert.equal(s.malformed, 1)
})

test('detect：标题兜底——无 session_meta 用文件名、harness 注入块不作标题', async (t) => {
  const rollout = [
    '{"timestamp":"2026-05-18T13:21:30.000Z","type":"turn_context","payload":{"turn_id":"t1"}}',
    '{"timestamp":"2026-05-18T13:21:31.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<system-reminder>ignore</system-reminder>"}]}}',
  ].join('\n')
  const home = await withHome(t, { 'sessions/rollout-noid.jsonl': rollout })

  const det = await detect(home)
  assert.equal(det.sessions.length, 1)
  const s = det.sessions[0]
  assert.equal(s.id, 'rollout-noid.jsonl')
  assert.equal('title' in s, false)
  assert.equal('cwd' in s, false)
  assert.equal(s.turns, 1)
  assert.equal(s.messages, 1)
  assert.equal(s.toolCalls, 0)
})

test('detect：skills 兼容/不兼容判定 + .system/README/MEMORY 跳过', async (t) => {
  const home = await withHome(t, {
    'skills/good-skill/SKILL.md': '---\nname: good-skill\ndescription: A good skill\n---\n\n# Body\n',
    'skills/no-desc/SKILL.md': '---\nname: no-desc\n---\n\n# Only name\n',
    'skills/plain/SKILL.md': '# Just a heading\n\nsome body\n',
    'skills/.system/bundled/SKILL.md': 'bundled, must skip',
    'skills/README.md': 'not a skill dir',
    'skills/memo/MEMORY.md': 'memo dir has no SKILL.md',
  })

  const det = await detect(home)
  const names = det.skills.map((s) => s.name).sort()
  assert.deepEqual(names, ['good-skill', 'no-desc', 'plain'])

  const good = det.skills.find((s) => s.name === 'good-skill')
  assert.equal(good.compatible, true)
  assert.equal(good.description, 'A good skill')
  assert.equal(good.digest.length, 64)

  const nodesc = det.skills.find((s) => s.name === 'no-desc')
  assert.equal(nodesc.compatible, false)

  const plain = det.skills.find((s) => s.name === 'plain')
  assert.equal(plain.compatible, false)
  assert.equal(plain.id, 'skills/plain/SKILL.md')
})

test('detect：memories / instructions / AGENTS.md / CODEX.md 检出', async (t) => {
  const home = await withHome(t, {
    'memories/note.md': '# Note\nbody',
    'memories/other.txt': 'ignored (not .md)',
    'AGENTS.md': '# Global agents',
    'CODEX.md': '# Codex instructions',
  })

  const det = await detect(home)
  assert.equal(det.memories.length, 1)
  const memory = det.memories[0]
  assert.equal(memory.id, 'memories/note.md')
  assert.equal(memory.kind, 'codex-memory')
  assert.equal(memory.bytes, Buffer.byteLength('# Note\nbody', 'utf8'))
  assert.equal(memory.digest.length, 64)

  assert.equal(det.instructions.length, 2)
  const kinds = det.instructions.map((i) => i.kind).sort()
  assert.deepEqual(kinds, ['agents-md', 'codex-md'])
  const agents = det.instructions.find((i) => i.kind === 'agents-md')
  assert.equal(agents.id, 'AGENTS.md')
  assert.equal(agents.bytes, Buffer.byteLength('# Global agents', 'utf8'))
  const codex = det.instructions.find((i) => i.kind === 'codex-md')
  assert.equal(codex.id, 'CODEX.md')
})

test('detect：hooks/command.md 分类 + config.toml [commands] 计入 hooks', async (t) => {
  const home = await withHome(t, {
    'hooks/commit/command.md': 'Write a commit message for the diff.',
    'hooks/run-tests/command.md': '#!/bin/sh\nnpm test\n',
    'hooks/commit/prompt.md': 'You are a commit helper.',
    'config.toml': '[model]\nprovider = "openai"\n\n[commands]\nhello = "echo hello world"\nfoo = "run something"\n',
  })

  const det = await detect(home)
  assert.equal(det.commands.length, 2)

  const commit = det.commands.find((c) => c.name === 'commit')
  assert.equal(commit.promptOnly, true)
  assert.equal(commit.id, 'hooks/commit/command.md')
  assert.equal(commit.bytes, Buffer.byteLength('Write a commit message for the diff.', 'utf8'))

  const runTests = det.commands.find((c) => c.name === 'run-tests')
  assert.equal(runTests.promptOnly, false) // shebang → 含 shell

  assert.equal(det.hooks.length, 3)
  const promptHook = det.hooks.find((h) => h.id === 'hooks/commit/prompt.md')
  assert.equal(promptHook.kind, 'codex-hook')
  assert.equal('matcher' in promptHook, false)

  const configHook = det.hooks.find((h) => h.id === 'config.toml:hello')
  assert.equal(configHook.kind, 'codex-hook')
  assert.equal(configHook.matcher, 'hello')
  assert.equal(configHook.file, path.join(home, 'config.toml'))
  assert.equal(configHook.bytes, Buffer.byteLength('echo hello world', 'utf8'))

  const configHook2 = det.hooks.find((h) => h.id === 'config.toml:foo')
  assert.equal(configHook2.matcher, 'foo')
})

test('detect：config.toml 缺失不抛、不记错误', async (t) => {
  const home = await withHome(t, { 'memories/note.md': 'x' })
  const det = await detect(home)
  assert.equal(det.hooks.length, 0)
  assert.deepEqual(det.errors, [])
})
