// skill-migrate.test.mjs — 技能兼容判定/转换/kebab 命名/目标路径/跳过守卫。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  kebabName,
  classifySkill,
  renderSkill,
  skillTargetPath,
  skipSkillEntry,
} from '../lib/skill-migrate.mjs'

const compatible = '---\nname: pdf-helper\ndescription: Extract and merge PDFs\n---\n\n# Body\nSteps here.\n'
const noDesc = '---\nname: pdf-helper\n---\n\n# Body\nSteps here.\n'
const noFrontmatter = '# My Skill\n\nDo things.\n'

test('classifySkill：name+description 齐 → 兼容直拷', () => {
  const c = classifySkill(compatible)
  assert.equal(c.compatible, true)
  assert.equal(c.name, 'pdf-helper')
  assert.equal(c.description, 'Extract and merge PDFs')
})

test('classifySkill：缺 description → 不兼容', () => {
  assert.equal(classifySkill(noDesc).compatible, false)
  assert.equal(classifySkill(noFrontmatter).compatible, false)
})

test('renderSkill：兼容文件内容原样保留', () => {
  const r = renderSkill(compatible, 'x')
  assert.equal(r.content, compatible)
  assert.equal(r.converted, false)
  assert.equal(r.name, 'pdf-helper')
})

test('renderSkill：缺 description → 合成 frontmatter（标题作描述）', () => {
  const r = renderSkill(noDesc, 'pdf-helper')
  assert.equal(r.converted, true)
  assert.match(r.content, /^---\nname: pdf-helper\ndescription: Body\n---/)
  assert.match(r.content, /Steps here/)
})

test('renderSkill：无 frontmatter → 用目录名 kebab + 首行描述', () => {
  const r = renderSkill(noFrontmatter, 'My Skill')
  assert.equal(r.name, 'my-skill')
  assert.equal(r.description, 'My Skill')
  assert.match(r.content, /^---\nname: my-skill\n/)
})

test('kebabName：非法字符折叠，空名兜底', () => {
  assert.equal(kebabName('My_Skill v2!'), 'my-skill-v2')
  assert.equal(kebabName('   '), 'skill')
  assert.equal(kebabName('already-kebab'), 'already-kebab')
})

test('skillTargetPath：目录束 SKILL.md', () => {
  assert.equal(skillTargetPath('D:\\dsh\\skills', 'pdf-helper'), path.join('D:\\dsh\\skills', 'pdf-helper', 'SKILL.md'))
})

test('skipSkillEntry：跳过 README/MEMORY/隐藏目录', () => {
  assert.equal(skipSkillEntry('README.md'), true)
  assert.equal(skipSkillEntry('memory.md'), true)
  assert.equal(skipSkillEntry('.system'), true)
  assert.equal(skipSkillEntry('.hub'), true)
  assert.equal(skipSkillEntry('pdf-helper'), false)
  assert.equal(skipSkillEntry('notes.md'), false)
})
