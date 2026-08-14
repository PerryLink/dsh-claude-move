// routes.test.mjs — 面板路由集成测试：index/import/progress 三路由与进度回调；
// 另含 client bundle 的静态契约检查（零 node 依赖、注册协议正确）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply, requireFs } from '../index.mjs'

async function makeTempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-move-routes-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  return dir
}

function claudeLine(type, extra = {}) {
  return JSON.stringify({
    type, timestamp: '2026-08-01T10:00:00.000Z', sessionId: 'sess-1', cwd: 'C:\\work\\demo', ...extra,
  })
}

const simple = [
  claudeLine('user', { message: { content: '问题一' } }),
  claudeLine('assistant', { message: { content: [{ type: 'text', text: '回答' }] } }),
].join('\n') + '\n'

// mock ctx：webServer 捕获路由；fs 树；sessionPersistence 内存。
function makeCtx(tree) {
  const routes = []
  const persistence = {
    sessions: new Map(),
    async list() { return [...persistence.sessions.values()].map((s) => s.meta) },
    async create(meta) { persistence.sessions.set(meta.id, { meta, events: [] }) },
    async append(id, events) { persistence.sessions.get(id).events.push(...events) },
  }
  const fs = {
    async resolve(p) { return { targetKey: p, displayPath: p } },
    async stat(target) {
      const v = tree[target.targetKey]
      if (v === undefined) return undefined
      return v === 'dir'
        ? { type: 'directory', version: 1 }
        : { type: 'file', version: 1, size: Buffer.byteLength(v, 'utf8') }
    },
    async readText(target) {
      const v = tree[target.targetKey]
      if (v === undefined || v === 'dir') throw new Error('FS_NOT_FOUND ' + target.targetKey)
      return v
    },
    async listDir(target) {
      const entries = []
      const prefix = target.targetKey.endsWith(path.sep) ? target.targetKey : target.targetKey + path.sep
      for (const [p, v] of Object.entries(tree)) {
        if (p.startsWith(prefix) && p !== prefix) {
          const rest = p.slice(prefix.length)
          if (!rest.includes(path.sep)) {
            entries.push({ name: rest, type: v === 'dir' ? 'directory' : 'file', target: { targetKey: p, displayPath: p } })
          }
        }
      }
      return entries.sort((a, b) => a.name.localeCompare(b.name))
    },
    processPath(target) { return target.targetKey },
  }
  const workspaceRegistry = {
    async resolveByPath() { return null },
    async create(p) { return { path: p, attachSession: async () => {} } },
    async archiveSession() {},
  }
  const webServer = {
    register(route) { routes.push(route); return () => {} },
  }
  const ctx = {
    fs,
    sessionPersistence: persistence,
    tools: { register: () => () => {} },
    on: () => () => {},
    get(service) {
      if (service === 'webServer') return webServer
      if (service === 'workspaceRegistry') return workspaceRegistry
      if (service === 'sessionPersistence') return persistence
      if (service === 'fs') return fs
      return undefined
    },
  }
  return { ctx, routes, persistence }
}

function mockRes() {
  const res = {
    status: 0, body: '', headers: {},
    writeHead(status, headers) { res.status = status; Object.assign(res.headers, headers) },
    end(chunk) { res.body = chunk ?? '' },
  }
  return res
}

function mockReq({ method = 'GET', url = '/api/claude-move/index', body } = {}) {
  const req = {
    method, url,
    on(event, cb) {
      if (event === 'data' && body) cb(Buffer.from(body))
      if (event === 'end') cb()
      return req
    },
    destroy() {},
  }
  return req
}

test('apply 注册面板三路由（webServer 存在时）', () => {
  const { ctx, routes } = makeCtx({})
  apply(ctx)
  assert.deepEqual(routes.map((r) => r.path), [
    '/api/claude-move/index', '/api/claude-move/import', '/api/claude-move/progress',
  ])
  assert.ok(routes.every((r) => r.kind === 'exact'))
})

test('无 webServer 服务时跳过路由注册；enableWebPanel=false 时也跳过', () => {
  const { ctx } = makeCtx({})
  const routes = []
  const ctxNoWeb = {
    ...ctx,
    get: (s) => (s === 'webServer' ? undefined : ctx.get(s)),
  }
  apply(ctxNoWeb)
  assert.equal(ctxNoWeb.tools.register, ctx.tools.register)
  const { ctx: ctx2, routes: routes2 } = makeCtx({})
  apply(ctx2, { enableWebPanel: false })
  assert.equal(routes2.length, 0)
})

test('GET /api/claude-move/index 返回扫描索引', async (t) => {
  const home = await makeTempDir(t)
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = await makeTempDir(t)
  t.after(() => { if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev })

  const projectsDir = path.join(home, 'projects')
  await mkdir(path.join(projectsDir, 'demo-a'), { recursive: true })
  const file = path.join(projectsDir, 'demo-a', 'sess-1.jsonl')
  await writeFile(file, simple, 'utf8')

  const { ctx, routes } = makeCtx({ [projectsDir]: 'dir', [file]: simple })
  apply(ctx, { claudeHome: home, scanGit: false })
  const route = routes.find((r) => r.path === '/api/claude-move/index')

  const res = mockRes()
  await route.handler(mockReq(), res)
  assert.equal(res.status, 200)
  const index = JSON.parse(res.body)
  assert.equal(index.projects.length, 1)
  assert.equal(index.projects[0].sessions[0].import.status, 'none')
})

test('POST import → jobId → progress 轮询到 done（F16 进度条）', async (t) => {
  const home = await makeTempDir(t)
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = await makeTempDir(t)
  t.after(() => { if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev })

  const projectsDir = path.join(home, 'projects')
  await mkdir(path.join(projectsDir, 'demo-a'), { recursive: true })
  const file = path.join(projectsDir, 'demo-a', 'sess-1.jsonl')
  await writeFile(file, simple, 'utf8')

  const { ctx, routes, persistence } = makeCtx({ [projectsDir]: 'dir', [path.join(projectsDir, 'demo-a')]: 'dir', [file]: simple })
  apply(ctx, { claudeHome: home, scanGit: false })

  const importRoute = routes.find((r) => r.path === '/api/claude-move/import')
  const postRes = mockRes()
  await importRoute.handler(mockReq({ method: 'POST', url: '/api/claude-move/import', body: JSON.stringify({ path: 'all' }) }), postRes)
  assert.equal(postRes.status, 200)
  const { jobId } = JSON.parse(postRes.body)
  assert.ok(jobId)

  const progressRoute = routes.find((r) => r.path === '/api/claude-move/progress')
  let job = null
  for (let i = 0; i < 50 && (!job || job.status === 'running'); i++) {
    const res = mockRes()
    await progressRoute.handler(mockReq({ url: '/api/claude-move/progress?job=' + jobId }), res)
    job = JSON.parse(res.body)
    if (job.status === 'running') await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(job.status, 'done')
  assert.equal(job.imported, 1)
  assert.equal(persistence.sessions.size, 1)

  const missingRes = mockRes()
  await progressRoute.handler(mockReq({ url: '/api/claude-move/progress?job=nope' }), missingRes)
  assert.equal(missingRes.status, 404)
})

test('POST import 单文件路径：直接导入该会话（面板「导入并继续」）', async (t) => {
  const home = await makeTempDir(t)
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = await makeTempDir(t)
  t.after(() => { if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev })

  const projectsDir = path.join(home, 'projects')
  await mkdir(path.join(projectsDir, 'demo-a'), { recursive: true })
  const file = path.join(projectsDir, 'demo-a', 'sess-1.jsonl')
  await writeFile(file, simple, 'utf8')

  const { ctx, routes, persistence } = makeCtx({ [projectsDir]: 'dir', [file]: simple })
  apply(ctx, { claudeHome: home, scanGit: false })

  const importRoute = routes.find((r) => r.path === '/api/claude-move/import')
  const postRes = mockRes()
  await importRoute.handler(mockReq({ method: 'POST', url: '/api/claude-move/import', body: JSON.stringify({ path: file }) }), postRes)
  const { jobId } = JSON.parse(postRes.body)

  const progressRoute = routes.find((r) => r.path === '/api/claude-move/progress')
  let job = null
  for (let i = 0; i < 50 && (!job || job.status === 'running'); i++) {
    const res = mockRes()
    await progressRoute.handler(mockReq({ url: '/api/claude-move/progress?job=' + jobId }), res)
    job = JSON.parse(res.body)
    if (job.status === 'running') await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(job.status, 'done')
  assert.equal(job.imported, 1)
  assert.equal(job.results[0].sessionId, 'import-sess-1')
  assert.equal(persistence.sessions.size, 1)
})

test('POST import 非 POST 方法返回 405', async () => {
  const { ctx, routes } = makeCtx({})
  apply(ctx)
  const route = routes.find((r) => r.path === '/api/claude-move/import')
  const res = mockRes()
  await route.handler(mockReq({ method: 'GET', url: '/api/claude-move/import' }), res)
  assert.equal(res.status, 405)
})

test('webServer 后置就绪：经 internal/service 响应式注册路由', () => {
  const services = {}
  const routes = []
  const listeners = {}
  const ctx = {
    tools: { register: () => () => {} },
    get(service) { return services[service] },
    on(event, cb) {
      ;(listeners[event] ??= []).push(cb)
      return () => {}
    },
  }
  apply(ctx)
  assert.equal(routes.length, 0, '服务未就绪时暂不注册')

  services.webServer = { register: (route) => { routes.push(route); return () => {} } }
  for (const cb of listeners['internal/service'] ?? []) cb('webServer')
  assert.deepEqual(routes.map((r) => r.path), [
    '/api/claude-move/index', '/api/claude-move/import', '/api/claude-move/progress',
  ], '服务出现后经 internal/service 注册')
})

test('requireFs：fs 服务缺失时响亮失败（真实 Cordis 禁止未声明属性访问）', () => {
  assert.throws(() => requireFs({ get: () => undefined }), /fs 服务不可用|ctx\.fs/)
  const fs = { resolve: async () => ({}) }
  assert.equal(requireFs({ get: (n) => (n === 'fs' ? fs : undefined) }), fs)
})

test('client bundle：注册协议与零 node 依赖（classic script）', () => {
  const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  assert.ok(source.includes("__ModuleLoader__.load"), '注册走 __ModuleLoader__')
  assert.ok(source.includes("id: 'dsh-claude-move'"), 'id 与包名一致')
  assert.ok(source.includes('name: \'claude-move-panel\''), '导出 Cordis 客户端插件形态')
  assert.ok(source.includes('inject: []'), '零注入依赖')
  assert.ok(!/\bimport\s/.test(source), '无 ES import（classic script）')
  assert.ok(!source.includes('node:'), '无 node 依赖')
})

test('client bundle：面板路由禁用容错与默认收起（A1/A2）', () => {
  const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  // A1：enableWebPanel=false（或 web 服务缺失）时 index 路由 404 → 明确提示并禁用导入。
  assert.ok(source.includes("msg === 'HTTP 404'"), '404 探测分支存在')
  assert.ok(source.includes('enableWebPanel 为 false 或 Web 服务未加载'), '禁用提示文案存在')
  assert.ok(source.includes('disabled = true'), '404 后进入禁用状态')
  assert.ok(source.includes('if (disabled)'), '导入入口检查禁用状态')
  // A2：默认收起——抽屉以 display:none 初始，只显示悬浮按钮。
  assert.ok(source.includes("drawer.style.display = 'none'"), '抽屉默认隐藏')
  assert.ok(!source.includes('show(true)'), '不再启动即自动展开')
})
