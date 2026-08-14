// handoff.test.mjs — 交接摘要单测：内容提取、reasoning 排除、截断、未知类型警告。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildHandoff, oneLine, textOfStep, fileArgOf, DEFAULT_HANDOFF_MAX_CHARS } from '../lib/handoff.mjs'

function step(content, toolCalls = []) {
  return { content, toolCalls, toolResults: [] }
}

const converted = {
  meta: { id: 'import-x', createdAt: Date.now() },
  turns: [
    {
      prompt: '帮我修复登录页的 bug',
      steps: [
        step([
          { type: 'text', text: '先看一下登录页代码。' },
          { type: 'reasoning', text: '这是思考过程，不应出现在摘要里。' },
          { type: 'tool-call', id: 'c1', name: 'Read', arguments: JSON.stringify({ file_path: 'src/login.ts' }) },
        ], [{ id: 'c1', name: 'Read', arguments: JSON.stringify({ file_path: 'src/login.ts' }) }]),
      ],
    },
    {
      prompt: '把报错信息也改掉',
      steps: [
        step([
          { type: 'text', text: '已修改 login.ts 与 error.ts。' },
          { type: 'tool-call', id: 'c2', name: 'Edit', arguments: JSON.stringify({ file_path: 'src/error.ts' }) },
        ], [{ id: 'c2', name: 'Edit', arguments: JSON.stringify({ file_path: 'src/error.ts' }) }]),
      ],
    },
  ],
  messages: 4,
  toolCalls: 2,
  skipped: 1,
  typeCounts: { user: 2, assistant: 2, 'future-type': 3 },
}

test('buildHandoff：目标、最后请求、文件引用、规模、停止点、警告齐全', () => {
  const handoff = buildHandoff(converted, { title: '修复登录页' })
  assert.ok(handoff.includes('修复登录页'))
  assert.ok(handoff.includes('帮我修复登录页的 bug'))
  assert.ok(handoff.includes('把报错信息也改掉'))
  assert.ok(handoff.includes('src/login.ts'))
  assert.ok(handoff.includes('src/error.ts'))
  assert.ok(handoff.includes('2 轮'))
  assert.ok(handoff.includes('已修改 login.ts 与 error.ts。'))
  assert.ok(handoff.includes('1 行畸形记录被跳过'))
  assert.ok(handoff.includes('future-type×3'))
  assert.ok(!handoff.includes('这是思考过程'), 'reasoning 内容不进摘要')
})

test('buildHandoff：maxChars 截断且不超限', () => {
  const handoff = buildHandoff(converted, { maxChars: 120 })
  assert.ok(handoff.length <= 120)
  assert.ok(handoff.endsWith('…'))
})

test('buildHandoff：空会话输出最小骨架', () => {
  const handoff = buildHandoff({ turns: [] })
  assert.ok(handoff.includes('静态历史'))
  assert.ok(handoff.includes('0 轮'))
})

test('buildHandoff：summary 记录提示未映射为压缩节点（D1）', () => {
  const handoff = buildHandoff({ turns: [{ prompt: 'q', steps: [] }], typeCounts: { summary: 2, user: 1 } })
  assert.ok(handoff.includes('2 条 summary'), '提示摘要记录数量')
  assert.ok(handoff.includes('未映射为压缩节点'), '说明不合成 compaction 节点')
})

test('textOfStep / fileArgOf / oneLine：纯函数行为', () => {
  const stepObj = step([
    { type: 'text', text: ' a\nb ' },
    { type: 'reasoning', text: 'hidden' },
    { type: 'tool-call', id: 'x', name: 'Read', arguments: '{}' },
  ])
  assert.equal(textOfStep(stepObj), 'a\nb')
  assert.equal(fileArgOf({ name: 'Read', arguments: JSON.stringify({ file_path: 'x.ts' }) }), 'x.ts')
  assert.equal(fileArgOf({ name: 'UnknownTool', arguments: '{"file_path":"y"}' }), null)
  assert.equal(oneLine(' 多\n行 文本 ', 4), '多 行')
  assert.equal(DEFAULT_HANDOFF_MAX_CHARS, 2048)
})
