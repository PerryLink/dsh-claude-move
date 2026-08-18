/**
 * Client panel pure-function suite (U3): loads the shipped browser bundle
 * (client/client.js) inside a Node VM with only the module-loader handshake
 * stubbed, then calls the exposed pure helpers directly with args — no DOM,
 * I/O, clock, or randomness. The panel's own contract (id/factory/plugin
 * namespace) and the zh/en string-table parity are asserted too.
 * @module dsh-claude-move/test/client-panel.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'client.js'), 'utf8')

/** Load the client bundle with a stubbed module loader; returns the captured module. */
function loadClient(language) {
  const captured = []
  const context = vm.createContext({
    window: {
      __ModuleLoader__: {
        load: (module) => { captured.push(module) },
      },
    },
    navigator: language === undefined ? undefined : { language },
    document: { getElementById: () => null },
  })
  vm.runInContext(source, context, { filename: 'client/client.js' })
  assert.equal(captured.length, 1)
  return captured[0]
}

test('the bundle registers the panel through the module-loader handshake', () => {
  const module = loadClient()
  assert.equal(module.id, 'dsh-claude-move')
  assert.equal(typeof module.factory, 'function')
  const plugin = module.factory()
  assert.equal(plugin.name, 'claude-move-panel')
  // VM-realm arrays fail cross-realm deepStrictEqual; re-materialize first.
  assert.deepEqual(Array.from(plugin.inject), [])
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(typeof plugin.helpers, 'object')
})

test('esc escapes every HTML-significant character deterministically', () => {
  const { esc } = loadClient().factory().helpers
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;')
  assert.equal(esc('plain'), 'plain')
  assert.equal(esc(null), '')
  assert.equal(esc(undefined), '')
  assert.equal(esc(0), '0')
  assert.equal(esc('<b>'), esc('<b>'), 'no hidden state between calls')
})

test('panelText substitutes placeholders in both languages and falls back to the key', () => {
  const zh = loadClient('zh-CN').factory().helpers
  const en = loadClient('en-US').factory().helpers
  assert.equal(zh.panelText('scanned', 3, 5), '已扫描：3 个项目 / 5 个会话')
  assert.equal(en.panelText('scanned', 3, 5), 'Scanned: 3 projects / 5 sessions')
  assert.equal(zh.panelText('scanned'), '已扫描：{0} 个项目 / {1} 个会话', 'placeholders stay when args are missing')
  assert.equal(en.panelText('no-such-key-xyz'), 'no-such-key-xyz')
  // Determinism: repeated calls agree.
  assert.equal(en.panelText('messagesTools', 4, 2), en.panelText('messagesTools', 4, 2))
})

test('zh and en string tables carry the same keys', () => {
  const { strings } = loadClient().factory().helpers
  const zhKeys = Object.keys(strings.zh).sort()
  const enKeys = Object.keys(strings.en).sort()
  assert.deepEqual(zhKeys, enKeys)
  assert.ok(zhKeys.length >= 20, 'a real vocabulary, not an empty table')
})

test('safeService probes optional client services without throwing', () => {
  const { safeService } = loadClient().factory().helpers
  const service = { refresh: () => 'x' }
  const ctx = { get: (name) => (name === 'sessions' ? service : undefined) }
  assert.equal(safeService(ctx, 'sessions'), service)
  assert.equal(safeService(ctx, 'workspaces'), undefined)
  assert.equal(safeService(null, 'sessions'), undefined)
  assert.equal(safeService({}, 'sessions'), undefined)
  assert.equal(safeService({ get: () => { throw new Error('boom') } }, 'sessions'), undefined)
})
