// test/composition.test.mjs — 真实 Loader composition 套件（社区五层模型 4–5 层）：
// 独立进程挂载 Loader + Include builtin，读 cordis.yml（真实 service 行 + 插件行 +
// config），证明模块解包、inject 解析、config 应用与注册表贡献。同时携带两类负例：
// 非法 config 按预期原因响亮失败（U4），default 导出以 missing-inject 失败（C2）。
// @module dsh-claude-move/test/composition.test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runner = join(repositoryRoot, 'scripts', 'loader-runner.mjs')
const entry = join(repositoryRoot, 'index.mjs')

/** One cordis.yml: real service rows, then the plugin row with config. */
function configFor(pluginRow, claudeHome, configLines = []) {
  return [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-commands'",
    `- name: ${JSON.stringify(pluginRow)}`,
    '  config:',
    `    claudeHome: ${JSON.stringify(claudeHome)}`,
    ...configLines.map(line => `    ${line}`),
    '',
  ].join('\n')
}

function runRunner(configPath, expected) {
  const result = spawnSync(process.execPath, [runner, configPath, expected], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 120_000,
  })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const temporaryRoot = mkdtempSync(join(tmpdir(), 'dsh-claude-move-loader-'))
const claudeHome = join(temporaryRoot, 'claude')
mkdirSync(claudeHome, { recursive: true })

test('Loader composition mounts the plugin and applies its default config', () => {
  const configPath = join(temporaryRoot, 'valid.yml')
  writeFileSync(configPath, configFor(pathToFileURL(entry).href, claudeHome, ['scanGit: false']))
  const evidence = runRunner(configPath, 'move')
  assert.equal(evidence.status, 0, `stdout:\n${evidence.stdout}\nstderr:\n${evidence.stderr}`)
  const marker = evidence.stdout.match(/DSH_LOADER_RESULT (.+)$/mu)
  const summary = JSON.parse(marker[1])
  assert.ok(summary.tools.includes('claude_scan'))
  assert.ok(summary.tools.includes('import_claude'))
  assert.equal(summary.moveTools, true)
  assert.ok(summary.commands.includes('move'))
  assert.ok(Number.isInteger(summary.scanProjects), 'claude_scan returned a structured index')
})

test('Loader composition applies the special config value (enableMove: false)', () => {
  const configPath = join(temporaryRoot, 'no-move.yml')
  writeFileSync(configPath, configFor(pathToFileURL(entry).href, claudeHome, [
    'scanGit: false',
    'enableMove: false',
  ]))
  const evidence = runRunner(configPath, 'no-move')
  assert.equal(evidence.status, 0, `stdout:\n${evidence.stdout}\nstderr:\n${evidence.stderr}`)
  const marker = evidence.stdout.match(/DSH_LOADER_RESULT (.+)$/mu)
  const summary = JSON.parse(marker[1])
  assert.equal(summary.moveTools, false)
  assert.ok(!summary.commands.includes('move'), '/move stays unregistered when enableMove: false')
  assert.ok(summary.tools.includes('claude_scan'), 'claude_scan stays registered when only the move wizard is disabled')
})

test('invalid config fails loud through the Loader for the expected reason', () => {
  const cases = [
    { lines: ["enableMove: 'yes'"], reason: /expected boolean/u },
    { lines: ['scanGit: 42'], reason: /scanGit/u },
    { lines: ["memoryScope: 'bogus'"], reason: /memoryScope/u },
  ]
  const entryUrl = pathToFileURL(entry).href
  for (const entryCase of cases) {
    const configPath = join(temporaryRoot, 'invalid.yml')
    writeFileSync(configPath, configFor(entryUrl, claudeHome, entryCase.lines))
    const evidence = runRunner(configPath, 'move')
    assert.notEqual(evidence.status, 0, `invalid config unexpectedly mounted:\n${entryCase.lines.join('\n')}`)
    assert.match(evidence.stderr, entryCase.reason, `failed for the wrong reason:\n${evidence.stderr}`)
  }
})

test('a default export fails through the Loader with the missing-inject reason', () => {
  const wrapper = join(temporaryRoot, 'default-export.mjs')
  const builtUrl = pathToFileURL(entry).href
  writeFileSync(wrapper, [
    `export { name, inject, Config, apply } from ${JSON.stringify(builtUrl)}`,
    `export { apply as default } from ${JSON.stringify(builtUrl)}`,
    '',
  ].join('\n'))
  const configPath = join(temporaryRoot, 'invalid-default.yml')
  writeFileSync(configPath, configFor(pathToFileURL(wrapper).href, claudeHome))
  const evidence = runRunner(configPath, 'move')
  assert.notEqual(evidence.status, 0, 'default-export wrapper unexpectedly mounted')
  assert.match(evidence.stderr, /without inject/u, `failed for the wrong reason:\n${evidence.stderr}`)
})

test.after(() => {
  rmSync(temporaryRoot, { recursive: true, force: true })
})
