// SPDX-License-Identifier: Apache-2.0
// export.test.mjs — DSH 会话事件 → Claude JSONL 反向折叠纯函数测试（无宿主依赖）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { convertClaudeJsonl } from '../lib/convert.mjs'
import { eventsToClaudeJsonl } from '../lib/export.mjs'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const load = (name) => readFileSync(join(fixtures, name), 'utf8')

test('eventsToClaudeJsonl: 简单问答回迁为 user/assistant 记录', () => {
  const converted = convertClaudeJsonl(load('simple.jsonl'))
  const out = eventsToClaudeJsonl({
    events: converted.events,
    sessionId: converted.meta.id,
    cwd: converted.meta.cwd,
  })
  assert.equal(out.title, null)
  assert.deepEqual(out.records.map((r) => r.type), ['user', 'assistant'])
  assert.equal(out.counts.turns, 1)
  assert.equal(out.counts.user, 1)
  assert.equal(out.counts.assistant, 1)
  assert.equal(out.records[0].message.content, '你好，帮我看看这个项目')
  assert.equal(out.records[1].message.content[0].type, 'text')
  // 每条行都是合法 JSON（Claude 可逐行解析）。
  for (const line of out.lines) assert.doesNotThrow(() => JSON.parse(line))
})

test('eventsToClaudeJsonl: 工具轮次回迁 tool_use/tool_result 配对', () => {
  const converted = convertClaudeJsonl(load('tool.jsonl'))
  const out = eventsToClaudeJsonl({
    events: converted.events,
    sessionId: converted.meta.id,
    cwd: converted.meta.cwd,
  })
  assert.deepEqual(out.records.map((r) => r.type), ['user', 'assistant', 'user', 'assistant'])
  const assistant = out.records.find((r) => r.type === 'assistant')
  assert.deepEqual(assistant.message.content.map((b) => b.type), ['thinking', 'text', 'tool_use'])
  assert.equal(assistant.message.content[2].name, 'Bash')
  assert.deepEqual(assistant.message.content[2].input, { command: 'ls -la' })
  const result = out.records.find((r) => r.type === 'user'
    && Array.isArray(r.message.content)
    && r.message.content.some((b) => b.type === 'tool_result'))
  assert.ok(result)
  assert.equal(result.message.content[0].tool_use_id, 'toolu_01')
  assert.equal(result.message.content[0].is_error, false)
  assert.equal(out.counts.toolCalls, 1)
  assert.equal(out.counts.toolResults, 1)
})

test('eventsToClaudeJsonl: ai-title 回迁为 custom-title 记录', () => {
  const converted = convertClaudeJsonl(load('title.jsonl'))
  const out = eventsToClaudeJsonl({
    events: converted.events,
    sessionId: converted.meta.id,
    cwd: converted.meta.cwd,
  })
  assert.equal(out.title, '项目问题讨论')
  assert.equal(out.records[0].type, 'custom-title')
  assert.equal(out.records[0].customTitle, '项目问题讨论')
})

test('eventsToClaudeJsonl: 空事件数组输出零记录', () => {
  const out = eventsToClaudeJsonl({ events: [], sessionId: 'empty', cwd: null })
  assert.equal(out.lines.length, 0)
  assert.deepEqual(out.counts, { turns: 0, user: 0, assistant: 0, toolCalls: 0, toolResults: 0 })
})
