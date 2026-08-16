// agmd-section.test.mjs — AGENTS.md 管理段：追加/幂等/原位替换/冲突 diff/合并。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  defaultAgentsMdPath,
  renderSection,
  sectionInner,
  parseSections,
  planSection,
  mergedSection,
  lineDiff,
} from '../lib/agmd-section.mjs'

test('defaultAgentsMdPath 跟随 DSH_HOME', () => {
  assert.equal(defaultAgentsMdPath({ DSH_HOME: 'D:\\dsh' }), path.join('D:\\dsh', 'AGENTS.md'))
})

test('planSection：空文件 → new（追加渲染段）', () => {
  const plan = planSection('', 'hermes:memory:MEMORY.md', '记忆内容', '~/.hermes/memories/MEMORY.md')
  assert.equal(plan.status, 'new')
  assert.match(plan.text, /dsh-move:managed:start hermes:memory:MEMORY\.md/)
  assert.match(plan.text, /记忆内容/)
  assert.match(plan.text, /dsh-move:managed:end hermes:memory:MEMORY\.md/)
})

test('planSection：既有非管理内容一字不动', () => {
  const current = '# My Rules\n\nalways test\n'
  const plan = planSection(current, 'codex:instruction:CODEX.md', 'codex rules', '~/.codex/CODEX.md')
  assert.equal(plan.status, 'new')
  assert.ok(plan.text.startsWith(current.trimEnd()))
  assert.match(plan.text, /codex rules/)
})

test('planSection：同摘要重跑 → unchanged，不产生新段', () => {
  const first = planSection('', 'k', 'A', 'src')
  const second = planSection(first.text, 'k', 'A', 'src')
  assert.equal(second.status, 'unchanged')
  assert.equal((second.text ?? first.text).match(/managed:start k/g).length, 1)
})

test('planSection：内容变化 → replace，原位替换且其它段保留', () => {
  const t1 = planSection('', 'a', 'alpha', 'srcA').text
  const t2 = planSection(t1, 'b', 'beta', 'srcB').text
  const plan = planSection(t2, 'a', 'gamma', 'srcA')
  assert.equal(plan.status, 'replace')
  assert.match(plan.text, /gamma/)
  assert.doesNotMatch(plan.text, /\balpha\b/)
  assert.match(plan.text, /managed:start b/)
  assert.match(plan.text, /\bbeta\b/)
  assert.equal((plan.text.match(/managed:start a/g) ?? []).length, 1)
  assert.ok(Array.isArray(plan.diff))
})

test('planSection：不同段互不干扰，顺序稳定', () => {
  const t = planSection(planSection('', 'a', 'A1', 'sa').text, 'b', 'B1', 'sb').text
  const { sections, ordered } = parseSections(t)
  assert.deepEqual(ordered, ['a', 'b'])
  assert.equal(sections.get('a').raw, sectionInner('A1', 'sa'))
  assert.equal(sections.get('b').raw, sectionInner('B1', 'sb'))
})

test('mergedSection：旧内容后追加新内容（merge 解法）', () => {
  const t1 = planSection('', 'm', 'entry-1', 's').text
  const plan = mergedSection(t1, 'm', 'entry-2', 's')
  assert.equal(plan.status, 'replace')
  assert.match(plan.text, /entry-1[\s\S]*entry-2/)
})

test('lineDiff：行级差异', () => {
  assert.deepEqual(lineDiff('a\nb', 'a\nc'), ['- b', '+ c'])
  assert.deepEqual(lineDiff('a', 'a\nb'), ['+ b'])
})
