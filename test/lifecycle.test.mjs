// test/lifecycle.test.mjs — HMR-safety（C1）与导出契约（C2）套件。
//
// C1：真实 Cordis + 真实 SystemPrompt/ToolRuntime/CommandRuntime 组装；保存贡献
// fiber，释放后重查权威注册表，断言 claude_scan/import_claude/move_* 工具与
// /claude-import-all//resume-claude//move 命令随 fiber 撤销消失。
// C2：模块命名空间无 default 导出，且 Loader.unwrapExports 往返返回同一命名空间。
// @module dsh-claude-move/test/lifecycle.test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as plugin from '../index.mjs'

function makeAgent(session) {
  return {
    id: session.id,
    options: { provider: 'deepseek', model: 'demo-model' },
    session,
    inbox: {},
    status: 'idle',
    ctx: new Context(),
    cancel: () => undefined,
    whenIdle: async () => undefined,
    runMaintenance: async (task) => task(new AbortController().signal),
    send: () => undefined,
    followup: () => undefined,
    steer: () => undefined,
    inject: () => undefined,
  }
}

/** 组装真实 Cordis 上下文（真实 systemPrompt/tools/commands 注册表）。 */
async function mountHarness(config = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  const session = { id: 's1', header: {}, events: [], append() {} }
  const agent = /** @type {any} */ (makeAgent(session))
  const pluginFiber = await ctx.plugin(plugin, config)
  return { ctx, agent, pluginFiber }
}

// ---------------------------------------------------------------------------
// C2：函数插件命名空间必须经 Loader 解包往返
// ---------------------------------------------------------------------------

test('module carries no default export and Loader unwrap round-trips the namespace', () => {
  assert.equal('default' in plugin, false)
  const loader = Object.create(Loader.prototype)
  const unwrapped = loader.unwrapExports(plugin)
  assert.equal(unwrapped, plugin)
  assert.equal(unwrapped.name, 'claude-move')
  assert.deepEqual(unwrapped.inject, ['tools'])
  assert.ok(unwrapped.Config !== undefined)
  assert.equal(typeof unwrapped.apply, 'function')
})

// ---------------------------------------------------------------------------
// C1：释放贡献 fiber 后，工具与命令从权威注册表消失
// ---------------------------------------------------------------------------

test('disposing the contributing fiber removes the move tools and commands', async () => {
  const harness = await mountHarness()
  try {
    const toolNames = () => harness.ctx.tools.schemas().map((schema) => schema.name)
    const commandNames = () => harness.ctx.commands.list(harness.agent).map((entry) => entry.name)
    for (const name of ['claude_scan', 'import_claude', 'move_detect', 'move_preview', 'move_run']) {
      assert.ok(toolNames().includes(name), `${name} tool should be registered`)
    }
    for (const name of ['claude-import-all', 'resume-claude', 'move']) {
      assert.ok(commandNames().includes(name), `/${name} command should be registered`)
    }

    await harness.pluginFiber.dispose()

    for (const name of ['claude_scan', 'import_claude', 'move_detect', 'move_preview', 'move_run']) {
      assert.equal(toolNames().includes(name), false, `${name} tool should disappear after fiber dispose`)
    }
    for (const name of ['claude-import-all', 'resume-claude', 'move']) {
      assert.equal(commandNames().includes(name), false, `/${name} command should disappear after fiber dispose`)
    }
  } finally {
    await harness.ctx.fiber.dispose()
  }
})
