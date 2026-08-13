// index.test.mjs — 插件级集成测试：mock ctx（tools），走真实 apply → register →
// execute 路径，校验 claude_scan 返回符合输出 schema、导入状态标注、缓存落盘
// 与 path 收窄。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply, runScan, resolveScanTarget } from '../index.mjs'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

async function makeTempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-move-index-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  return dir
}

function claudeLine(type, extra = {}) {
  return JSON.stringify({
    type,
    timestamp: '2026-08-01T10:00:00.000Z',
    sessionId: 'sess-1',
    cwd: path.join('C:', 'work', 'demo'),
    message: { model: 'claude-sonnet-4-5' },
    ...extra,
  })
}

// 内存态持久化 mock：list 返回已导入会话头。
function makeCtx(persistedIds) {
  const registered = []
  const ctx = {
    tools: {
      register(def) { registered.push(def); return () => {} },
    },
    on: () => () => {},
    get(service) {
      if (service === 'sessionPersistence') {
        return { list: async () => persistedIds.map((id) => ({ id })) }
      }
      return undefined
    },
  }
  ctx.registered = registered
  return ctx
}

test('apply 注册 claude_scan 工具且输出 schema 为结构化索引', () => {
  const ctx = makeCtx([])
  apply(ctx)
  assert.deepEqual(ctx.registered.map((d) => d.name), ['claude_scan', 'import_claude'])
  const def = ctx.registered[0]
  assert.equal(def.name, 'claude_scan')
  assert.ok(def.output.schema.properties.projects)
  assert.ok(def.output.schema.properties.claudeHome)
})

test('resolveScanTarget：all/文件/目录收窄', () => {
  const home = path.resolve(path.join('C:', 'Users', 'u', '.claude'))
  assert.deepEqual(resolveScanTarget(undefined, home), { kind: 'all' })
  assert.deepEqual(resolveScanTarget('all', home), { kind: 'all' })
  assert.deepEqual(resolveScanTarget(path.join(home, 'projects'), home), { kind: 'all' })
  assert.deepEqual(resolveScanTarget(path.join(home, 'projects', 'demo', 's.jsonl'), home), {
    kind: 'file', target: path.resolve(path.join(home, 'projects', 'demo', 's.jsonl')),
  })
  assert.deepEqual(resolveScanTarget(path.join(home, 'projects', 'demo'), home), {
    kind: 'dir', target: path.resolve(path.join(home, 'projects', 'demo')),
  })
})

test('runScan 全量：扫描、导入状态标注、缓存落盘、输出通过 schema 校验', async (t) => {
  const home = await makeTempDir(t)
  const dshHome = await makeTempDir(t)
  const prevDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  t.after(() => { if (prevDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevDshHome })

  const projects = path.join(home, 'projects')
  await mkdir(path.join(projects, 'demo-a'), { recursive: true })
  await writeFile(path.join(projects, 'demo-a', 'sess-1.jsonl'), claudeLine('user', {
    sessionId: 'sess-1', message: { content: '问题一' },
  }) + '\n' + claudeLine('assistant', { message: { content: [{ type: 'text', text: '回答' }] } }) + '\n', 'utf8')
  await writeFile(path.join(projects, 'demo-a', 'sess-2.jsonl'), claudeLine('user', {
    sessionId: 'sess-2', message: { content: '问题二' },
  }) + '\n', 'utf8')

  const ctx = makeCtx(['import-sess-1'])
  const value = await runScan(ctx, { claudeHome: home }, {})
  assert.equal(value.projects.length, 1)
  const byId = Object.fromEntries(value.projects[0].sessions.map((s) => [s.sessionId, s]))
  assert.equal(byId['sess-1'].import.status, 'none')
  assert.equal(byId['sess-2'].import.status, 'none')

  // 写入导入映射后重扫：标注 imported
  const cacheDir = path.join(dshHome, 'claude-move')
  const { saveImports } = await import('../lib/discovery.mjs')
  await saveImports(cacheDir, { 'sess-1': 'import-sess-1' })
  const second = await runScan(ctx, { claudeHome: home }, {})
  const byId2 = Object.fromEntries(second.projects[0].sessions.map((s) => [s.sessionId, s]))
  assert.deepEqual(byId2['sess-1'].import, { status: 'imported', dshSessionId: 'import-sess-1' })
  assert.equal(byId2['sess-2'].import.status, 'none')

  // 输出 schema 校验
  const registered = []
  const captureCtx = {
    ...ctx,
    tools: { register: (d) => { registered.push(d); return () => {} } },
  }
  apply(captureCtx)
  const violations = validateJsonSchemaValue(registered[0].output.schema, second)
  assert.deepEqual(violations, [])

  // 增量缓存已落盘（第二次扫描可复用）
  const { loadCache } = await import('../lib/discovery.mjs')
  const cache = await loadCache(cacheDir)
  assert.ok(cache)
  assert.equal(Object.keys(cache.files).length, 2)
})

test('runScan path 收窄到单个 .jsonl：只含该会话', async (t) => {
  const home = await makeTempDir(t)
  const dshHome = await makeTempDir(t)
  const prevDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  t.after(() => { if (prevDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevDshHome })

  const projects = path.join(home, 'projects')
  await mkdir(path.join(projects, 'demo-a'), { recursive: true })
  const file = path.join(projects, 'demo-a', 'sess-1.jsonl')
  await writeFile(file, claudeLine('user', { sessionId: 'sess-1', message: { content: '问题一' } }) + '\n', 'utf8')
  await writeFile(path.join(projects, 'demo-a', 'sess-2.jsonl'), claudeLine('user', {
    sessionId: 'sess-2', message: { content: '问题二' },
  }) + '\n', 'utf8')

  const ctx = makeCtx([])
  const value = await runScan(ctx, { claudeHome: home }, { path: file })
  assert.equal(value.projects.length, 1)
  assert.equal(value.projects[0].sessions.length, 1)
  assert.equal(value.projects[0].sessions[0].sessionId, 'sess-1')
  assert.equal(value.personal, null)
})

test('runScan：claudeHome 不存在时标记 claudeHomeExists=false 而不抛错', async (t) => {
  const dshHome = await makeTempDir(t)
  const prevDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  t.after(() => { if (prevDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevDshHome })

  const missing = path.join(tmpdir(), 'definitely-not-a-claude-home')
  const ctx = makeCtx([])
  const value = await runScan(ctx, { claudeHome: missing }, {})
  assert.equal(value.claudeHomeExists, false)
  assert.deepEqual(value.projects, [])
})

test('runScan：exec.signal 中止时抛出 signal.reason（不再继续扫描）', async (t) => {
  const home = await makeTempDir(t)
  const dshHome = await makeTempDir(t)
  const prevDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  t.after(() => { if (prevDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevDshHome })

  const projects = path.join(home, 'projects')
  await mkdir(path.join(projects, 'demo-a'), { recursive: true })
  await writeFile(path.join(projects, 'demo-a', 'sess-1.jsonl'), claudeLine('user', { sessionId: 'sess-1', message: { content: 'q' } }) + '\n', 'utf8')

  const ctx = makeCtx([])
  const controller = new AbortController()
  controller.abort(new Error('scan aborted by test'))
  await assert.rejects(
    () => runScan(ctx, { claudeHome: home }, {}, controller.signal),
    /scan aborted by test/,
  )
})
