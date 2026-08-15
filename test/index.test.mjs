// index.test.mjs — 插件级集成测试：mock ctx（tools），走真实 apply → register →
// execute 路径，校验 claude_scan 返回符合输出 schema、导入状态标注、缓存落盘
// 与 path 收窄。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply, runScan, resolveScanTarget, trimIndex, workspaceModeOf, resolveClaudecodeDir, applyWorkspaceCwd, sourceCwdSync, makeClaudeState } from '../index.mjs'
import { loadImportsSync, saveImports } from '../lib/discovery.mjs'
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

test('工具描述双语：英文主 + 中文附（D3）', () => {
  const ctx = makeCtx([])
  apply(ctx)
  const scan = ctx.registered.find((d) => d.name === 'claude_scan')
  const importTool = ctx.registered.find((d) => d.name === 'import_claude')
  assert.ok(scan.description.includes('Scan the local Claude Code data'), 'claude_scan 英文主描述')
  assert.ok(scan.description.includes('扫描本机 Claude Code 数据'), 'claude_scan 中文附描述')
  assert.ok(importTool.description.includes('Copy Claude Code JSONL transcripts'), 'import_claude 英文主描述')
  assert.ok(importTool.description.includes('复制导入历史对话'), 'import_claude 中文附描述')
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

test('workspaceModeOf/resolveClaudecodeDir：默认 claudecode，目录取 $DSH_HOME/claudecode（E2）', () => {
  assert.equal(workspaceModeOf({}), 'claudecode')
  assert.equal(workspaceModeOf({ workspaceMode: 'per-project' }), 'per-project')
  assert.equal(workspaceModeOf({ workspaceMode: 'bogus' }), 'claudecode', '未知值保守回退 claudecode')
  const dir = resolveClaudecodeDir({}, { DSH_HOME: 'C:\\home\\.dsh' })
  assert.equal(dir, path.join('C:', 'home', '.dsh', 'claudecode'))
  const custom = resolveClaudecodeDir({ claudecodeDir: 'D:\\my\\cc' }, {})
  assert.equal(custom, path.resolve('D:\\my\\cc'))
  const customEmpty = resolveClaudecodeDir({ claudecodeDir: '   ' }, { DSH_HOME: 'C:\\h\\.dsh' })
  assert.equal(customEmpty, path.join('C:', 'h', '.dsh', 'claudecode'), '空白配置视为未配置')
})

test('applyWorkspaceCwd：claudecode 模式覆写 cwd 并返回源 cwd（E2）', () => {
  const dir = resolveClaudecodeDir({})
  const meta = { id: 'import-x', cwd: 'D:\\repo\\proj' }
  assert.equal(applyWorkspaceCwd(meta, {}), 'D:\\repo\\proj', '返回覆写前的源 cwd')
  assert.equal(meta.cwd, dir, 'cwd 已覆写为工作区目录')
  const meta2 = { id: 'import-y', cwd: 'D:\\repo\\proj' }
  assert.equal(applyWorkspaceCwd(meta2, { workspaceMode: 'per-project' }), 'D:\\repo\\proj')
  assert.equal(meta2.cwd, 'D:\\repo\\proj', 'per-project 模式不改动')
})

test('sourceCwdSync：imports.json 的 sourceCwd 字段直接命中（E2 保真映射）', async (t) => {
  const home = await makeTempDir(t)
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
  })
  await saveImports(path.join(home, 'claude-move'), {
    'D:\\claude\\projects\\p\\s.jsonl': {
      dshId: 'import-sess-1', turns: 2, events: 10, sourceCwd: 'D:\\repo\\one',
    },
  })
  const state = makeClaudeState({})
  assert.equal(sourceCwdSync(state, 'import-sess-1'), 'D:\\repo\\one')
  assert.equal(sourceCwdSync(state, 'unknown-session'), null, '未知会话返回 null')
  assert.equal(sourceCwdSync(makeClaudeState({ workspaceMode: 'per-project' }), 'import-sess-1'), null,
    'per-project 模式恒 null（header.cwd 即源目录）')
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

test('annotateImports：listSnapshots 优先 + 失效映射惰性清理（B4）', async (t) => {
  const home = await makeTempDir(t)
  const dshHome = await makeTempDir(t)
  const prevDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  t.after(() => { if (prevDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevDshHome })

  const projDir = path.join(home, 'projects', 'demo')
  await mkdir(projDir, { recursive: true })
  const file = path.join(projDir, 'sess-1.jsonl')
  await writeFile(file, claudeLine('user', { sessionId: 'sess-1', message: { content: 'q' } }) + '\n', 'utf8')

  // 预置映射：一条有效（会话存在于快照），一条失效（对应 DSH 会话已被删除）。
  await mkdir(path.join(dshHome, 'claude-move'), { recursive: true })
  await writeFile(path.join(dshHome, 'claude-move', 'imports.json'), JSON.stringify({
    [file]: { dshId: 'import-sess-1', turns: 1, events: 3 },
    [path.join(projDir, 'gone.jsonl')]: { dshId: 'import-gone', turns: 1, events: 3 },
  }), 'utf8')

  const ctx = {
    tools: { register: () => () => {} },
    on: () => () => {},
    get(service) {
      if (service === 'sessionPersistence') {
        return { listSnapshots: async () => [{ header: { id: 'import-sess-1' }, revision: 'r1' }] }
      }
      return undefined
    },
  }
  const index = await runScan(ctx, { claudeHome: home, scanGit: false }, {})
  const session = index.projects[0].sessions[0]
  assert.equal(session.import.status, 'imported')
  assert.equal(session.import.dshSessionId, 'import-sess-1')
  assert.equal(index.importsCleaned, 1, '失效映射清理并报告条数')
  const imports = JSON.parse(await readFile(path.join(dshHome, 'claude-move', 'imports.json'), 'utf8'))
  assert.deepEqual(Object.keys(imports), [file], '映射文件只保留有效记录')
})

test('annotateImports：源轮次多于导入记录时打 updatesPending（D4）', async (t) => {
  const home = await makeTempDir(t)
  const dshHome = await makeTempDir(t)
  const prevDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  t.after(() => { if (prevDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevDshHome })

  const projDir = path.join(home, 'projects', 'demo')
  await mkdir(projDir, { recursive: true })
  const file = path.join(projDir, 'sess-1.jsonl')
  // 两轮：源轮次 2 > 已导入记录 1 → 有新增待同步。
  await writeFile(file,
    claudeLine('user', { sessionId: 'sess-1', message: { content: 'q1' } }) + '\n'
    + claudeLine('assistant', { sessionId: 'sess-1', message: { content: [{ type: 'text', text: 'a1' }] } }) + '\n'
    + claudeLine('user', { sessionId: 'sess-1', message: { content: 'q2' } }) + '\n', 'utf8')

  await mkdir(path.join(dshHome, 'claude-move'), { recursive: true })
  await writeFile(path.join(dshHome, 'claude-move', 'imports.json'), JSON.stringify({
    [file]: { dshId: 'import-sess-1', turns: 1, events: 5 },
  }), 'utf8')

  const ctx = {
    tools: { register: () => () => {} },
    on: () => () => {},
    get(service) {
      if (service === 'sessionPersistence') {
        return { listSnapshots: async () => [{ header: { id: 'import-sess-1' }, revision: 'r1' }] }
      }
      return undefined
    },
  }
  const index = await runScan(ctx, { claudeHome: home, scanGit: false }, {})
  const session = index.projects[0].sessions[0]
  assert.equal(session.import.status, 'imported')
  assert.equal(session.import.updatesPending, true, '源有新增轮次未同步')
  assert.equal(session.turns, 2, '扫描头统计轮次数')
})

test('trimIndex：projectsLimit/sessionsLimit/brief 裁剪（C4）', () => {
  const index = {
    projects: [
      {
        slug: 'a',
        sessions: [
          { file: 'f1', sessionId: 's1', title: 't1', lastActivity: 2, messages: 1, toolCalls: 0, typeCounts: { user: 1 }, import: { status: 'none' } },
          { file: 'f2', sessionId: 's2' },
        ],
      },
      { slug: 'b', sessions: [{ file: 'f3', sessionId: 's3' }] },
    ],
  }
  const trimmed = trimIndex(structuredClone(index), { projectsLimit: 1, sessionsLimit: 1, fields: 'brief' })
  assert.equal(trimmed.projects.length, 1)
  assert.equal(trimmed.projectsTruncated, true)
  assert.equal(trimmed.projects[0].sessions.length, 1)
  assert.equal(trimmed.projects[0].sessionsTruncated, true)
  assert.equal(trimmed.projects[0].sessions[0].typeCounts, undefined, 'brief 去掉重型字段')
  assert.deepEqual(trimmed.projects[0].sessions[0].import, { status: 'none' }, '保留导入状态')
  assert.equal(trimIndex(structuredClone(index), {}).projects.length, 2, '默认不裁剪')
})
