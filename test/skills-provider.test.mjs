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
  await writeFile(path.join(root, 'a.md'), '---\nname: dup\ndescription: one\n---\n\none\n', 'utf8')
  await writeFile(path.join(root, 'b.md'), '---\nname: DUP\ndescription: two\n---\n\ntwo\n', 'utf8')
  await writeFile(path.join(root, 'c.md'), '---\nname: dup-2\ndescription: three\n---\n\nthree\n', 'utf8')
  await writeFile(path.join(root, 'd.md'), '---\nname: other\ndescription: four\n---\n\nfour\n', 'utf8')

  const provider = makeClaudeSkillsProvider({ roots: [root], maxSkills: 3 })
  const names = (await provider.list()).map((c) => c.name)
  assert.deepEqual(names, ['dup', 'dup-2', 'dup-2-2'], '确定性唯一：字面 dup-2 与冲突分配的 dup-2 撞名后追加后缀')
  assert.equal(new Set(names).size, names.length)
})

test('provider.get：归属校验，伪 candidate 返回 undefined', async (t) => {
  const root = await makeTempDir(t)
  await writeFile(path.join(root, 's.md'), '---\nname: s\ndescription: s desc\n---\n\n正文\n', 'utf8')
  const provider = makeClaudeSkillsProvider({ roots: [root], maxSkills: 30 })
  const [candidate] = await provider.list()

  const definition = await provider.get(candidate)
  assert.equal(definition.name, 's')
  assert.equal(definition.content, '正文')

  assert.equal(await provider.get({ ...candidate }), undefined, '伪造候选（丢失 locator）拒绝')
  assert.equal(await provider.get({ ...candidate, provider: 'other' }), undefined)
  assert.equal(await provider.get({ name: 'unknown' }), undefined)
})

test('provider.list：candidate 携带 path 与 metadata；options.cwd 暴露项目技能（B2）', async (t) => {
  const root = await makeTempDir(t)
  const proj = await makeTempDir(t)
  await writeFile(path.join(root, 'global.md'), '---\nname: global-skill\ndescription: 全局\n---\n\n全局正文\n', 'utf8')
  await mkdir(path.join(proj, '.claude', 'skills'), { recursive: true })
  await writeFile(path.join(proj, '.claude', 'skills', 'proj.md'), '---\nname: proj-skill\ndescription: 项目\ncustom: v1\n---\n\n项目正文\n', 'utf8')

  const provider = makeClaudeSkillsProvider({ roots: [root], maxSkills: 30 })
  const candidates = await provider.list({ cwd: proj })
  assert.deepEqual(candidates.map((c) => c.name), ['global-skill', 'proj-skill'])
  const global = candidates.find((c) => c.name === 'global-skill')
  const project = candidates.find((c) => c.name === 'proj-skill')
  assert.equal(global.source, 'claude')
  assert.equal(global.rank, 260)
  assert.ok(typeof global.path === 'string' && global.path.endsWith('global.md'), 'candidate 携带官方 path 字段')
  assert.ok(global.metadata && global.metadata.description === '全局', 'candidate 携带 frontmatter metadata')
  assert.equal(project.source, 'claude-project')
  assert.equal(project.rank, 280)
  assert.ok(project.path.includes(path.join('.claude', 'skills')))

  const def = await provider.get(project, { cwd: proj })
  assert.equal(def.content, '项目正文')
  assert.equal(def.metadata.custom, 'v1')
})

test('provider.list：options.signal 已中止立即抛 signal.reason（B2）', async (t) => {
  const root = await makeTempDir(t)
  const provider = makeClaudeSkillsProvider({ roots: [root], maxSkills: 30 })
  const controller = new AbortController()
  controller.abort(new Error('stop-list'))
  await assert.rejects(provider.list({ signal: controller.signal }), /stop-list/)
  await assert.rejects(
    provider.get({ name: 'x', locator: { path: 'nope' } }, { signal: controller.signal }),
    /stop-list/,
  )
})

test('provider.list：README.md 与 MEMORY.md 不注册为技能（issue#1）', async (t) => {
  const root = await makeTempDir(t)
  await mkdir(path.join(root, 'skill-bundle'), { recursive: true })
  await writeFile(path.join(root, 'skill-bundle', 'SKILL.md'), '---\nname: real-skill\ndescription: 真实技能\n---\n\n正文\n', 'utf8')
  await writeFile(path.join(root, 'README.md'), '# Skills index\n\n没有 frontmatter 的索引文件\n', 'utf8')
  await writeFile(path.join(root, 'readme.md'), '小写变体，同样忽略\n', 'utf8')
  await writeFile(path.join(root, 'MEMORY.md'), '记忆文件，忽略\n', 'utf8')

  const provider = makeClaudeSkillsProvider({ roots: [root], maxSkills: 30 })
  const candidates = await provider.list()
  assert.deepEqual(candidates.map((c) => c.name), ['real-skill'], 'README/MEMORY 均被排除')
})

test('provider.list：缺失 name/description frontmatter 的技能文件被跳过（issue#1）', async (t) => {
  const root = await makeTempDir(t)
  await writeFile(path.join(root, 'good.md'), '---\nname: good\ndescription: 有效技能\n---\n\n正文\n', 'utf8')
  await writeFile(path.join(root, 'no-description.md'), '---\nname: no-description\n---\n\n有名字没描述\n', 'utf8')
  await writeFile(path.join(root, 'empty-description.md'), '---\nname: empty\ndescription: "  "\n---\n\n空描述\n', 'utf8')
  await mkdir(path.join(root, 'no-frontmatter'), { recursive: true })
  await writeFile(path.join(root, 'no-frontmatter', 'SKILL.md'), '# 无 frontmatter\n\n正文\n', 'utf8')

  const provider = makeClaudeSkillsProvider({ roots: [root], maxSkills: 30 })
  const candidates = await provider.list()
  assert.deepEqual(candidates.map((c) => c.name), ['good'], '非法候选全部跳过，绝不产出空描述技能')
  assert.ok(candidates.every((c) => typeof c.description === 'string' && c.description.length > 0),
    '每个候选 description 非空（DSH 硬性契约）')
})
