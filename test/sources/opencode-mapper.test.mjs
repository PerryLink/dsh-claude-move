// opencode-mapper.test.mjs — OpenCode 映射器：会话/技能转换/命令分类/AGENTS.md 段。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mapSource } from '../../lib/sources/opencode/mapper.mjs'
import { digestText } from '../../lib/sources/contract.mjs'

const detection = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'opencode-map-'))
  const agent = path.join(dir, 'reviewer.md')
  const testCmd = path.join(dir, 'test.md')
  const shipCmd = path.join(dir, 'ship.md')
  const agentsMd = path.join(dir, 'AGENTS.md')
  await writeFile(agent, '# Reviewer\n\nReview diffs.\n')
  await writeFile(testCmd, 'Run the tests for this change.\n')
  await writeFile(shipCmd, 'Deploy.\n```!command\nnpm publish\n```\n')
  await writeFile(agentsMd, '# Global\nBe careful.\n')
  return {
    dir,
    detection: {
      source: 'opencode',
      home: dir,
      sessions: [
        { id: 'ses_x', sessionId: 'ses_x', file: dir + '\\opencode.db', storage: 'opencode-db', title: 'Fix', cwd: 'D:\\repo', format: 'opencode-db' },
      ],
      skills: [{ id: 'agent:reviewer.md', dir, file: agent, name: 'reviewer', description: '', compatible: false, digest: digestText('# Reviewer\n\nReview diffs.\n') }],
      commands: [
        { id: 'test', file: testCmd, name: 'test', promptOnly: true, digest: digestText('Run the tests for this change.\n') },
        { id: 'ship', file: shipCmd, name: 'ship', promptOnly: false, digest: digestText('Deploy.\n```!command\nnpm publish\n```\n') },
      ],
      instructions: [{ id: agentsMd, file: agentsMd, kind: 'agents-md', digest: digestText('# Global\nBe careful.\n') }],
      hooks: [],
      memories: [],
      errors: [],
    },
  }
}

test('mapSource：会话计划（provider/无 digest/storage 保留）', async (t) => {
  const { dir, detection: d } = await detection()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { plans } = await mapSource('opencode', d, { skillsDir: 'D:\\dsh\\skills' })
  const session = plans.find((p) => p.kind === 'session')
  assert.equal(session.action, 'import-session')
  assert.equal(session.provider, 'opencode')
  assert.equal(session.source.storage, 'opencode-db')
  assert.equal(session.digest, undefined)
  assert.match(session.key, /^opencode:session:/)
})

test('mapSource：agent → convert-copy、纯提示词命令 → register-command、shell → unsupported', async (t) => {
  const { dir, detection: d } = await detection()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { plans } = await mapSource('opencode', d, { skillsDir: 'D:\\dsh\\skills' })
  const skill = plans.find((p) => p.kind === 'skill')
  assert.equal(skill.action, 'convert-copy')
  assert.equal(skill.target.path, 'D:\\dsh\\skills\\reviewer\\SKILL.md')
  const testPlan = plans.find((p) => p.kind === 'command' && p.target.commandName === 'test')
  assert.equal(testPlan.action, 'register-command')
  const shipPlan = plans.find((p) => p.kind === 'command' && p.target.commandName === 'ship')
  assert.equal(shipPlan.action, 'unsupported')
  assert.match(shipPlan.reason, /shell/)
})

test('mapSource：全局 AGENTS.md → append-section（独立段 key + content）', async (t) => {
  const { dir, detection: d } = await detection()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { plans } = await mapSource('opencode', d, { skillsDir: 'D:\\dsh\\skills', agentsMdPath: 'D:\\dsh\\AGENTS.md' })
  const ins = plans.find((p) => p.kind === 'instruction')
  assert.equal(ins.action, 'append-section')
  assert.equal(ins.target.path, 'D:\\dsh\\AGENTS.md')
  assert.match(ins.content, /Be careful/)
  assert.match(ins.key, /^opencode:instruction:/)
})
