// hermes-mapper.test.mjs — Hermes 源映射器：技能 copy/convert-copy、记忆管理段。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mapSource } from '../../lib/sources/hermes/mapper.mjs'
import { detect } from '../../lib/sources/hermes/parser.mjs'
import { skillTargetPath, kebabName } from '../../lib/skill-migrate.mjs'
import { digestText } from '../../lib/sources/contract.mjs'
import { defaultAgentsMdPath } from '../../lib/agmd-section.mjs'

async function makeTempHome(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hermes-move-test-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  return dir
}

test('mapSource：技能 target 用 frontmatter name kebab；兼容 copy / 缺描述 convert-copy', async (t) => {
  const home = await makeTempHome(t)
  const skillsRoot = path.join(home, 'skills')
  await mkdir(path.join(skillsRoot, 'devops', 'deploy-k8s'), { recursive: true })
  await writeFile(path.join(skillsRoot, 'devops', 'deploy-k8s', 'SKILL.md'),
    '---\nname: Deploy K8s\ndescription: Deploy clusters\n---\n\n# Steps\n', 'utf8')
  await mkdir(path.join(skillsRoot, 'qa', 'smoke-tests'), { recursive: true })
  await writeFile(path.join(skillsRoot, 'qa', 'smoke-tests', 'SKILL.md'),
    '---\nname: smoke-tests\n---\n\n# Run smoke tests\n', 'utf8')

  const detection = await detect(home)
  const skillsDir = 'D:\\dsh\\skills'
  const { plans, errors } = mapSource('hermes', detection, { skillsDir })
  assert.deepEqual(errors, [])

  const skills = plans.filter((p) => p.kind === 'skill')
  assert.equal(skills.length, 2)
  const copy = skills.find((p) => p.source.name === 'Deploy K8s')
  const convert = skills.find((p) => p.source.name === 'smoke-tests')
  assert.ok(copy && convert)
  assert.equal(copy.action, 'copy')
  assert.equal(convert.action, 'convert-copy')
  assert.equal(kebabName('Deploy K8s'), 'deploy-k8s')
  assert.equal(copy.target.path, skillTargetPath(skillsDir, 'deploy-k8s'))
  assert.equal(copy.key, 'hermes:skill:devops/deploy-k8s')
  assert.equal(convert.key, 'hermes:skill:qa/smoke-tests')
  assert.equal(copy.source.dir, path.join(skillsRoot, 'devops', 'deploy-k8s'))
  assert.equal(copy.digest, detection.skills.find((s) => s.id === 'devops/deploy-k8s').digest)
})

test('mapSource：memory → append-section，content 非空、MEMORY/USER 独立段 key', async (t) => {
  const home = await makeTempHome(t)
  const memoriesRoot = path.join(home, 'memories')
  await mkdir(memoriesRoot, { recursive: true })
  const memContent = '§ 条目一\n§ 条目二\n'
  const userContent = '§ 用户偏好\n'
  await writeFile(path.join(memoriesRoot, 'MEMORY.md'), memContent, 'utf8')
  await writeFile(path.join(memoriesRoot, 'USER.md'), userContent, 'utf8')

  const detection = await detect(home)
  const agentsMdPath = 'D:\\dsh\\AGENTS.md'
  const { plans, errors } = mapSource('hermes', detection, { agentsMdPath })
  assert.deepEqual(errors, [])

  const memories = plans.filter((p) => p.kind === 'memory')
  assert.equal(memories.length, 2)
  const mem = memories.find((p) => p.source.file.endsWith('MEMORY.md'))
  const user = memories.find((p) => p.source.file.endsWith('USER.md'))
  assert.ok(mem && user)
  assert.equal(mem.action, 'append-section')
  assert.equal(mem.target.path, agentsMdPath)
  assert.equal(mem.content, memContent)
  assert.ok(mem.content.length > 0)
  assert.equal(mem.digest, digestText(memContent))
  assert.equal(mem.key, 'hermes:memory:MEMORY.md')
  assert.equal(user.key, 'hermes:memory:USER.md')
  assert.notEqual(mem.key, user.key, 'MEMORY.md 与 USER.md 各一个独立段 key')
  assert.equal(mem.source.kind, 'hermes-memory')
  assert.equal(user.source.kind, 'hermes-user')
})

test('mapSource：agentsMdPath 缺省 defaultAgentsMdPath', async (t) => {
  const home = await makeTempHome(t)
  const memoriesRoot = path.join(home, 'memories')
  await mkdir(memoriesRoot, { recursive: true })
  await writeFile(path.join(memoriesRoot, 'MEMORY.md'), '§ x\n', 'utf8')

  const detection = await detect(home)
  const { plans } = mapSource('hermes', detection, {})
  const mem = plans.find((p) => p.kind === 'memory')
  assert.equal(mem.target.path, defaultAgentsMdPath())
})

test('mapSource：memory 越界/缺失读取失败跳过并记 errors', () => {
  const home = 'D:\\hermes-home'
  const detection = {
    source: 'hermes',
    home,
    skills: [],
    memories: [
      { id: 'MEMORY.md', file: path.join(home, 'config.yaml'), kind: 'hermes-memory', bytes: 0, digest: 'x' },
      { id: 'USER.md', file: path.join(home, 'memories', 'USER.md'), kind: 'hermes-user', bytes: 0, digest: 'y' },
    ],
  }
  const { plans, errors } = mapSource('hermes', detection, { skillsDir: path.join(home, 'out', 'skills') })
  assert.deepEqual(plans, [])
  assert.equal(errors.length, 2)
  assert.match(errors[0], /越界/)
  assert.match(errors[1], /ENOENT/)
})
