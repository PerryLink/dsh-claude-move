// scripts/loader-runner.mjs — real Loader composition runner (community
// five-layer model, layer 4). An independent process boots a real Context,
// mounts the vendored Loader with the Include builtin, reads the given
// cordis.yml (service rows + plugin row + config), then asserts the plugin's
// contributions through the authoritative registries and executes one real
// behavior. Config is applied by the Loader, so the expected outcome proves
// the config in the file was honored. The `reload` scenario additionally
// rewrites the cordis.yml twice (enableWebPanel true → false → true) and
// drives the include entry's refresh() — the same transaction the HMR
// watcher triggers — asserting the panel routes unload with the fiber and
// re-register without a duplicate route.
//
// Usage: node scripts/loader-runner.mjs <cordis.yml> move|no-move|reload
// Exit 0 prints DSH_LOADER_RESULT <json>; any assertion or load failure exits
// non-zero with the reason on stderr (used by the invalid-config and
// default-export regression cases).

import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const configArgument = process.argv[2]
const expected = process.argv[3]
if (configArgument === undefined || (expected !== 'move' && expected !== 'no-move' && expected !== 'reload')) {
  console.error('usage: loader-runner.mjs <cordis.yml> move|no-move|reload')
  process.exit(2)
}

const configPath = resolve(configArgument)
const configRequire = createRequire(resolve(import.meta.dirname, '../package.json'))
const scanDir = mkdtempSync(join(tmpdir(), 'dsh-claude-move-loader-'))

const ctx = new Context()
try {
  ctx.baseUrl = `${pathToFileURL(dirname(configPath)).href}/`
  await ctx.plugin(Loader)
  ctx.loader.internal = /** @type {any} */ ({
    version: 'v2',
    /** @param {string} specifier */
    async import(specifier) {
      if (specifier.startsWith('file:')) return import(specifier)
      if (specifier.startsWith('node:')) return import(specifier)
      const absolute = /^([a-zA-Z]:)?[\\/]/u.test(specifier)
      return import(pathToFileURL(absolute ? specifier : configRequire.resolve(specifier)).href)
    },
  })
  ctx.loader.builtins.include = Include
  const includeId = await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()

  if (expected === 'reload') {
    const include = ctx.loader.resolve(includeId)?.subtree
    if (include === undefined || typeof include.refresh !== 'function') {
      throw new Error('reload: the include entry exposes no refresh()')
    }
    const webServer = /** @type {any} */ (ctx.get('webServer'))
    if (webServer === undefined) throw new Error('reload: the mock webServer row did not mount')
    const assertBase = () => {
      const names = ctx.tools.schemas().map((schema) => schema.name)
      for (const name of ['claude_scan', 'import_claude', 'move_detect', 'move_preview', 'move_run']) {
        if (!names.includes(name)) throw new Error(`reload: ${name} tool is missing`)
      }
    }

    // Phase 1: initial mount — the five panel routes are registered.
    assertBase()
    if (webServer.list().length !== 5) throw new Error(`reload: expected 5 routes after mount, got ${webServer.list().length}`)

    // Phase 2: enableWebPanel:false — the routes must unload with the fiber.
    writeFileSync(configPath, readFileSync(configPath, 'utf8').replace('enableWebPanel: true', 'enableWebPanel: false'))
    await include.refresh()
    await ctx.loader.await()
    assertBase()
    if (webServer.list().length !== 0) throw new Error(`reload: expected 0 routes while disabled, got ${webServer.list().length}`)

    // Phase 3: re-enable — remount re-registers without a duplicate route.
    writeFileSync(configPath, readFileSync(configPath, 'utf8').replace('enableWebPanel: false', 'enableWebPanel: true'))
    await include.refresh()
    await ctx.loader.await()
    assertBase()
    if (webServer.list().length !== 5) throw new Error(`reload: expected 5 routes after re-enable, got ${webServer.list().length}`)

    process.stdout.write(`DSH_LOADER_RESULT ${JSON.stringify({ routes: webServer.list().length, cycled: true })}\n`)
  } else {
  // Authoritative registries carry the plugin's contributions.
  const toolNames = ctx.tools.schemas().map((schema) => schema.name)
  for (const name of ['claude_scan', 'import_claude']) {
    if (!toolNames.includes(name)) throw new Error(`Loader composition: ${name} tool is missing`)
  }
  const moveTools = ['move_detect', 'move_preview', 'move_run'].every((name) => toolNames.includes(name))
  if (expected === 'move' && !moveTools) {
    throw new Error('Loader composition: move_* tools are missing (expected registered)')
  }
  if (expected === 'no-move' && moveTools) {
    throw new Error('Loader composition: move_* tools are registered (enableMove: false was not applied)')
  }

  const agent = /** @type {any} */ ({
    id: 'agent-1',
    options: { provider: 'deepseek', model: 'demo-model' },
    session: { id: 's1', header: {}, events: [], append() {} },
    inbox: {},
    status: 'idle',
    ctx,
    cancel: /** @type {() => void} */ (() => undefined),
    whenIdle: /** @type {() => Promise<void>} */ (async () => undefined),
    runMaintenance: /** @type {(task: (signal: AbortSignal) => Promise<unknown>) => Promise<unknown>} */ (async (task) => task(new AbortController().signal)),
    send: /** @type {() => void} */ (() => undefined),
    followup: /** @type {() => void} */ (() => undefined),
    steer: /** @type {() => void} */ (() => undefined),
    inject: /** @type {() => void} */ (() => undefined),
  })
  const commands = ctx.commands.list(agent).map((entry) => entry.name)
  const moveCommand = commands.includes('move')
  if (expected === 'move' && !moveCommand) {
    throw new Error('Loader composition: /move command is missing (expected registered)')
  }
  if (expected === 'no-move' && moveCommand) {
    throw new Error('Loader composition: /move command is registered (enableMove: false was not applied)')
  }

  // Real behavior: claude_scan through the real tools registry over an empty
  // temp dir (no source data → empty index, deterministic).
  // Dual-ruler call id: host master renamed dsh-llm's `CallId` brand to
  // `ToolCallId`; a local identity keeps the runner green on both rulers.
  const CallId = (id) => id
  const result = await ctx.tools.execute({
    callId: CallId('dsh-claude-move-loader-runner'),
    name: 'claude_scan',
    arguments: { path: scanDir, refresh: true },
    agent,
    signal: new AbortController().signal,
  })
  if (result.isError !== false || !Array.isArray(/** @type {any} */ (result.value)?.projects)) {
    throw new Error(`Loader composition: claude_scan returned ${JSON.stringify(result)}`)
  }

  const summary = {
    tools: toolNames,
    commands,
    moveTools,
    scanProjects: /** @type {any} */ (result.value).projects.length,
  }
  process.stdout.write(`DSH_LOADER_RESULT ${JSON.stringify(summary)}\n`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
} finally {
  await ctx.fiber.dispose()
  rmSync(scanDir, { recursive: true, force: true })
}
