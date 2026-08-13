// skills-provider.test.mjs — Claude 技能 provider 单测：kebab 归一化、发现、上限、归属校验。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { kebabName, makeClaudeSkillsProvider, CLAUDE_SKILLS_PROVIDER } from '../lib/skills-provider.mjs'

async function makeTempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-move-skills-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  return dir
}

test('kebabName：大小写/空格/符号归一化、空回退', () => {
  assert.equal(kebabName('My Skill Name!'), 'my-skill-name')
  assert.equal(kebabName('  ---  '), 'skill')
  assert.equal(kebabName('PDF-Tools'), 'pdf-tools')
})

test('provider.list：目录束 + 扁平文件 + frontmatter + 缺失目录', async (t) => {
  const root = await makeTempDir(t)
  await mkdir(path.join(root, 'bundle'), { recursive: true })
  await writeFile(path.join(root, 'bundle', 'SKILL.md'), '---\nname: bundle-skill\ndescription: 束技能\n---\n\n# 正文一\n', 'utf8')
  await writeFile(path.join(root, 'flat.md'), '---\nname: Flat Skill\ndescription: 扁平技能\n---\n\n扁平正文\n', 'utf8')

  const provider = makeClaudeSkillsProvider({ roots: [root, path.join(root, 'nope')], maxSkills: 30 })
  const candidates = await provider.list()
  assert.equal(provider.name, CLAUDE_SKILLS_PROVIDER)
  assert.deepEqual(candidates.map((c) => c.name), ['bundle-skill', 'flat-skill'])
  assert.equal(candidates[1].description, '扁平技能')
  assert.equal(candidates[0].resourceBase.kind, 'directory')
  assert.equal(candidates[0].rank, 260)
  assert.equal(candidates[0].source, 'claude')
})

test('provider.list：名称冲突追加 -2/-3 后缀；maxSkills 截断', async (t) => {
  const root = await makeTempDir(t)
  await writeFile(path.join(root, 'a.md'), '---\nname: dup\n---\n\none\n', 'utf8')
  await writeFile(path.join(root, 'b.md'), '---\nname: DUP\n---\n\ntwo\n', 'utf8')
  await writeFile(path.join(root, 'c.md'), '---\nname: dup-2\n---\n\nthree\n', 'utf8')
  await writeFile(path.join(root, 'd.md'), '---\nname: other\n---\n\nfour\n', 'utf8')

  const provider = makeClaudeSkillsProvider({ roots: [root], maxSkills: 3 })
  const names = (await provider.list()).map((c) => c.name)
  assert.deepEqual(names, ['dup', 'dup-2', 'dup-2-2'], '确定性唯一：字面 dup-2 与冲突分配的 dup-2 撞名后追加后缀')
  assert.equal(new Set(names).size, names.length)
})

test('provider.get：归属校验，伪 candidate 返回 undefined', async (t) => {
  const root = await makeTempDir(t)
  await writeFile(path.join(root, 's.md'), '---\nname: s\n---\n\n正文\n', 'utf8')
  const provider = makeClaudeSkillsProvider({ roots: [root], maxSkills: 30 })
  const [candidate] = await provider.list()

  const definition = await provider.get(candidate)
  assert.equal(definition.name, 's')
  assert.equal(definition.content, '正文')

  assert.equal(await provider.get({ ...candidate }), undefined, '伪造候选（丢失 locator）拒绝')
  assert.equal(await provider.get({ ...candidate, provider: 'other' }), undefined)
  assert.equal(await provider.get({ name: 'unknown' }), undefined)
})
