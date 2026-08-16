// claude-mapper.test.mjs — Claude 源映射器：会话计划/技能 copy/memory+CLAUDE.md
// append-section/hooks 不支持清单。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mapSource } from '../../lib/sources/claude/mapper.mjs'
import { digestText } from '../../lib/sources/contract.mjs'

test('mapSource：四类条目 → 计划', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-map-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(path.join(dir, 'mem'), { recursive: true })
  const memoryFile = path.join(dir, 'mem', 'notes.md')
  const claudeMd = path.join(dir, 'CLAUDE.md')
  await writeFile(memoryFile, '记忆内容')
  await writeFile(claudeMd, '# Rules\nBe careful.\n')
  const detection = {
    source: 'claude',
    home: dir,
    sessions: [{ id: 's1', file: path.join(dir, 's1.jsonl'), title: 'T1', cwd: 'D:\\repo', format: 'claude-jsonl' }],
    skills: [{
      id: 'pdf', dir: path.join(dir, 'skills', 'pdf'), file: path.join(dir, 'skills', 'pdf', 'SKILL.md'),
      name: 'pdf-helper', description: 'PDF', compatible: true, digest: digestText('PDF'),
    }],
    memories: [{ id: memoryFile, file: memoryFile, kind: 'claude-memory:project', digest: digestText('记忆内容') }],
    instructions: [{ id: claudeMd, file: claudeMd, kind: 'claude-md', digest: digestText('# Rules\nBe careful.\n') }],
    commands: [],
    hooks: [{ id: 'PreToolUse:Bash', file: path.join(dir, 'settings.json'), kind: 'claude-hook:PreToolUse', matcher: 'Bash' }],
    errors: [],
  }
  const { plans } = await mapSource('claude', detection, { skillsDir: 'D:\\dsh\\skills', agentsMdPath: 'D:\\dsh\\AGENTS.md' })

  const session = plans.find((p) => p.kind === 'session')
  assert.equal(session.action, 'import-session')
  assert.equal(session.provider, 'claude-code')
  assert.equal(session.digest, undefined)

  const skill = plans.find((p) => p.kind === 'skill')
  assert.equal(skill.action, 'copy')
  assert.equal(skill.target.path, 'D:\\dsh\\skills\\pdf-helper\\SKILL.md')

  const memory = plans.find((p) => p.kind === 'memory')
  assert.equal(memory.action, 'append-section')
  assert.equal(memory.target.path, 'D:\\dsh\\AGENTS.md')
  assert.equal(memory.content, '记忆内容')

  const instruction = plans.find((p) => p.kind === 'instruction')
  assert.equal(instruction.action, 'append-section')
  assert.match(instruction.content, /Be careful/)

  const hook = plans.find((p) => p.kind === 'hook')
  assert.equal(hook.action, 'unsupported')
  assert.match(hook.reason, /settings\.json/)
})

test('mapSource：源文件缺失 → errors 记录，计划跳过', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-map-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const detection = {
    source: 'claude', home: dir, sessions: [], skills: [], commands: [], hooks: [],
    memories: [{ id: 'gone', file: path.join(dir, 'gone.md'), kind: 'x', digest: 'd' }],
    instructions: [],
    errors: [],
  }
  const { plans, errors } = await mapSource('claude', detection, { skillsDir: 'D:\\dsh\\skills' })
  assert.equal(plans.length, 0)
  assert.equal(errors.length, 1)
})
