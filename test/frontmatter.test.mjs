// frontmatter.test.mjs — Claude Markdown frontmatter 解析单测（含引号解引用）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFrontmatter, extractMetadataType } from '../lib/frontmatter.mjs'

test('parseFrontmatter：基本键值 + body 分离 + 缩进续行', () => {
  const { meta, body } = parseFrontmatter('---\nname: doc-skill\ndescription: 一个技能\nmetadata:\n  type: reference\n---\n\n# 正文\n内容\n')
  assert.equal(meta.name, 'doc-skill')
  assert.equal(meta.description, '一个技能')
  assert.equal(meta.metadata, 'type: reference')
  assert.equal(body, '# 正文\n内容')
})

test('parseFrontmatter：单双引号标量解引用；引号内空白保留原样（调用方 trim 判空）', () => {
  const a = parseFrontmatter('---\nname: "quoted name"\ndescription: \'quoted desc\'\n---\n\nbody\n')
  assert.equal(a.meta.name, 'quoted name')
  assert.equal(a.meta.description, 'quoted desc')
  const b = parseFrontmatter('---\nname: empty\ndescription: "  "\n---\n\nbody\n')
  assert.equal(b.meta.description, '  ', '解引后只剩空白原样返回；技能层按 trim 判空跳过')
})

test('parseFrontmatter：无 frontmatter 时 meta 为空对象、body 为原文', () => {
  const { meta, body } = parseFrontmatter('# 直接正文\n无 frontmatter\n')
  assert.deepEqual(meta, {})
  assert.equal(body, '# 直接正文\n无 frontmatter\n')
})

test('extractMetadataType：直接 type 字段优先，其次 metadata 扁平文本', () => {
  assert.equal(extractMetadataType({ type: 'feedback' }), 'feedback')
  assert.equal(extractMetadataType({ metadata: 'type: project' }), 'project')
  assert.equal(extractMetadataType({}), 'unknown')
})
