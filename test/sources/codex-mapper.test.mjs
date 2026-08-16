// SPDX-License-Identifier: Apache-2.0
// codex-mapper.test.mjs — Codex 源映射器单元测试（合成 fixture，零真实 transcript）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mapSource } from '../../lib/sources/codex/mapper.mjs'
import { defaultAgentsMdPath } from '../../lib/agmd-section.mjs'

/** 在临时目录内搭建合成 home（test 结束自动清理）。 */
async function withHome(t, files) {
  const home = await mkdtemp(path.join(tmpdir(), 'codex-mapper-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(home, rel)
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, content)
  }
  return home
}

/** 最小 detection 骨架。 */
function detection(home, extra = {}) {
  return {
    source: 'codex',
    home,
    sessions: [],
    skills: [],
    memories: [],
    instructions: [],
    commands: [],
    hooks: [],
    ...extra,
  }
}

test('mapSource：session 计划无 digest、provider=codex', async (t) => {
  const home = await withHome(t, {})
  const sessionFile = path.join(home, 'sessions', 'rollout-a.jsonl')
  const det = detection(home, {
    sessions: [{ file: sessionFile, title: '标题', cwd: '/x' }],
  })
  const result = await mapSource('codex', det, { skillsDir: path.join(home, 'ds', 'skills') })

  assert.equal(result.plans.length, 1)
  assert.equal(result.errors, undefined)
  const p = result.plans[0]
  assert.equal(p.key, 'codex:session:' + sessionFile)
  assert.equal(p.kind, 'session')
  assert.equal(p.action, 'import-session')
  assert.equal(p.provider, 'codex')
  assert.equal(p.title, '标题')
  assert.equal('digest' in p, false)
  assert.deepEqual(p.source, { file: sessionFile, title: '标题', cwd: '/x' })
  assert.deepEqual(p.target, {})
})

test('mapSource：skill 计划 target 路径 kebab、不兼容 → convert-copy', async (t) => {
  const home = await withHome(t, {})
  const skillsDir = path.join(home, 'ds', 'skills')
  const det = detection(home, {
    skills: [
      { id: 'skills/My Skill/SKILL.md', dir: path.join(home, 'skills', 'My Skill'), file: path.join(home, 'skills', 'My Skill', 'SKILL.md'), name: 'My Skill', description: 'desc', compatible: true, digest: 'd1' },
      { id: 'skills/plain/SKILL.md', dir: path.join(home, 'skills', 'plain'), file: path.join(home, 'skills', 'plain', 'SKILL.md'), name: 'plain', description: '', compatible: false, digest: 'd2' },
    ],
  })
  const { plans } = await mapSource('codex', det, { skillsDir })

  assert.equal(plans.length, 2)
  const good = plans.find((p) => p.action === 'copy')
  assert.equal(good.target.path, path.join(skillsDir, 'my-skill', 'SKILL.md'))
  assert.equal(good.digest, 'd1')

  const plain = plans.find((p) => p.action === 'convert-copy')
  assert.equal(plain.target.path, path.join(skillsDir, 'plain', 'SKILL.md'))
  assert.equal(plain.digest, 'd2')
})

test('mapSource：memory/instruction append-section 且 content 非空', async (t) => {
  const home = await withHome(t, {
    'memories/note.md': '# Memory\nbody',
    'AGENTS.md': '# Global\n',
  })
  const agentsMdPath = path.join(home, 'ds', 'AGENTS.md')
  const det = detection(home, {
    memories: [{ id: 'memories/note.md', file: path.join(home, 'memories', 'note.md'), kind: 'codex-memory', bytes: 1, digest: 'm1' }],
    instructions: [{ id: 'AGENTS.md', file: path.join(home, 'AGENTS.md'), kind: 'agents-md', bytes: 1, digest: 'i1' }],
  })
  const { plans } = await mapSource('codex', det, { skillsDir: path.join(home, 'ds', 'skills'), agentsMdPath })

  assert.equal(plans.length, 2)
  const mem = plans.find((p) => p.kind === 'memory')
  assert.equal(mem.key, 'codex:memory:memories/note.md')
  assert.equal(mem.action, 'append-section')
  assert.equal(mem.target.path, agentsMdPath)
  assert.equal(mem.content, '# Memory\nbody')
  assert.equal(mem.digest, 'm1')

  const ins = plans.find((p) => p.kind === 'instruction')
  assert.equal(ins.key, 'codex:instruction:AGENTS.md')
  assert.equal(ins.action, 'append-section')
  assert.equal(ins.target.path, agentsMdPath)
  assert.equal(ins.content, '# Global\n')
})

test('mapSource：agentsMdPath 缺省走 defaultAgentsMdPath()', async (t) => {
  const home = await withHome(t, { 'memories/note.md': 'x' })
  const det = detection(home, {
    memories: [{ id: 'memories/note.md', file: path.join(home, 'memories', 'note.md'), kind: 'codex-memory', bytes: 1, digest: 'm' }],
  })
  const { plans } = await mapSource('codex', det, { skillsDir: path.join(home, 'ds', 'skills') })
  assert.equal(plans[0].target.path, defaultAgentsMdPath())
})

test('mapSource：含 shell 命令 → unsupported、钩子 → unsupported', async (t) => {
  const home = await withHome(t, {
    'hooks/run/command.md': '#!/bin/sh\nnpm test\n',
  })
  const det = detection(home, {
    commands: [{ id: 'hooks/run/command.md', file: path.join(home, 'hooks', 'run', 'command.md'), name: 'run', promptOnly: false, bytes: 20, digest: 'c1' }],
    hooks: [{ id: 'hooks/commit/prompt.md', file: path.join(home, 'hooks', 'commit', 'prompt.md'), kind: 'codex-hook', bytes: 5 }],
  })
  const { plans } = await mapSource('codex', det, { skillsDir: path.join(home, 'ds', 'skills') })

  const cmd = plans.find((p) => p.kind === 'command')
  assert.equal(cmd.action, 'unsupported')
  assert.match(cmd.reason, /shell/)

  const hook = plans.find((p) => p.kind === 'hook')
  assert.equal(hook.action, 'unsupported')
  assert.match(hook.reason, /Codex/)
})

test('mapSource：读取失败/缺文件跳过并返回 errors（plans 仍返回）', async (t) => {
  const home = await withHome(t, {})
  const missing = path.join(home, 'memories', 'gone.md')
  const det = detection(home, {
    memories: [{ id: 'memories/gone.md', file: missing, kind: 'codex-memory', bytes: 1, digest: 'x' }],
  })
  const result = await mapSource('codex', det, { skillsDir: path.join(home, 'ds', 'skills') })
  assert.equal(result.plans.length, 0)
  assert.ok(Array.isArray(result.errors))
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /gone\.md/)
})

test('mapSource：越界读取被守卫拦截并记 errors', async (t) => {
  const home = await withHome(t, {})
  const outside = path.join(home, 'auth.json') // 不在白名单
  const det = detection(home, {
    memories: [{ id: 'auth', file: outside, kind: 'codex-memory', bytes: 1, digest: 'x' }],
  })
  const result = await mapSource('codex', det, { skillsDir: path.join(home, 'ds', 'skills') })
  assert.equal(result.plans.length, 0)
  assert.match(result.errors[0], /越界|白名单/)
})
