// settings.test.mjs — settings.json 翻译单测（F14）：权限规则、模型偏好、无法映射项。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translateSettings, parseClaudeSettings, translatePermissionRule } from '../lib/settings.mjs'

test('parseClaudeSettings：合法 / 坏 JSON / 非对象', () => {
  assert.deepEqual(parseClaudeSettings('{}'), { parsed: {} })
  assert.ok(parseClaudeSettings('{broken').error)
  assert.ok(parseClaudeSettings('[1,2]').error)
})

test('translatePermissionRule：三种动作与无法识别', () => {
  const allow = translatePermissionRule('Read(./docs/**)', 'allow')
  assert.equal(allow.title, '允许 Read(./docs/**)')
  assert.equal(allow.tool, 'Read')
  const deny = translatePermissionRule('Bash(npm run *)', 'deny')
  assert.equal(deny.tool, 'Bash')
  assert.ok(translatePermissionRule('whatever', 'ask').title.includes('无法识别'))
})

test('translateSettings：完整翻译与 unmapped 显式列出', () => {
  const raw = JSON.stringify({
    permissions: {
      allow: ['Read(./public/**)'],
      deny: ['Read(./secrets/**)', 'Bash(rm -rf *)'],
      ask: ['WebFetch(domain:github.com)'],
      additionalDirectories: ['../other'],
    },
    model: 'opus',
    apiKeyHelper: '~/.claude/bin/get-key.sh',
    env: { FOO: 'bar' },
    hooks: { PreToolUse: [] },
    unknownTopLevel: true,
  })
  const result = translateSettings(raw, '~/.claude/settings.json')
  assert.equal(result.error, undefined)
  const kinds = result.suggestions.map((s) => s.kind)
  assert.deepEqual(kinds, [
    'permission', 'permission', 'permission', 'permission', 'additional-directories', 'model', 'api-key-helper',
  ])
  const denyRules = result.suggestions.filter((s) => s.action === 'deny')
  assert.equal(denyRules.length, 2)
  assert.ok(result.unmapped.includes('env（环境变量不自动搬运，请在 DSH 会话里显式设置）'))
  assert.ok(result.unmapped.includes('hooks（Claude hooks 不自动搬运；DSH 对应机制为 hooks 桥接插件）'))
  assert.ok(result.unmapped.includes('unknownTopLevel'))
})

test('translateSettings：坏 JSON 返回 error 且不抛', () => {
  const result = translateSettings('{broken', 'x/settings.json')
  assert.ok(result.error.includes('x/settings.json'))
  assert.deepEqual(result.unmapped, [])
})
