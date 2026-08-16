// commands-migrate.test.mjs — 命令分类/迁移计划与钩子不支持清单。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyCommand, commandPlan, hookUnsupportedPlan, toDshCommandName } from '../lib/commands-migrate.mjs'
import { digestText } from '../lib/sources/contract.mjs'

test('classifyCommand：纯提示词 → promptOnly', () => {
  const c = classifyCommand('Refactor this diff: $ARGUMENTS', 'Refactor Diff')
  assert.equal(c.promptOnly, true)
  assert.equal(c.name, 'refactor-diff')
})

test('classifyCommand：OpenCode ```! 围栏 → 含 shell', () => {
  const c = classifyCommand('Run tests.\n```!command\nnpm test\n```', 'test')
  assert.equal(c.hasShell, true)
  assert.equal(c.promptOnly, false)
})

test('classifyCommand：shebang → 含 shell', () => {
  assert.equal(classifyCommand('#!/bin/sh\nnpm test\n', 'run').promptOnly, false)
})

test('commandPlan：纯提示词 → register-command 计划', () => {
  const plan = commandPlan('codex', 'command', '/hooks/commit/command.md', {
    file: '/hooks/commit/command.md',
    promptOnly: true,
    prompt: 'Write a commit message',
    name: 'commit',
    digest: digestText('Write a commit message'),
  })
  assert.equal(plan.action, 'register-command')
  assert.equal(plan.target.commandName, 'commit')
  assert.equal(plan.key, 'codex:command:/hooks/commit/command.md')
})

test('commandPlan：含 shell → unsupported（绝不注册可执行命令）', () => {
  const plan = commandPlan('opencode', 'command', 'test', {
    file: '~/.config/opencode/command/test.md',
    promptOnly: false,
    prompt: 'npm test',
    name: 'test',
    digest: digestText('npm test'),
  })
  assert.equal(plan.action, 'unsupported')
  assert.match(plan.reason, /shell/)
})

test('hookUnsupportedPlan：钩子进不支持清单并附建议', () => {
  const plan = hookUnsupportedPlan('claude', 'settings-hooks', '~/.claude/settings.json')
  assert.equal(plan.action, 'unsupported')
  assert.equal(plan.kind, 'hook')
  assert.match(plan.reason, /tools\/post-execute/)
})

test('toDshCommandName：kebab 化', () => {
  assert.equal(toDshCommandName('Refactor Diff'), 'refactor-diff')
})
