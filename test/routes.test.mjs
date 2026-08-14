// routes.test.mjs — 面板路由集成测试：index/import/progress 三路由与进度回调；
// 另含 client bundle 的静态契约检查（零 node 依赖、注册协议正确）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply, requireFs, isTrustedOrigin } from '../index.mjs'

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

function mockReq({ method = 'GET', url = '/api/claude-move/index', body, headers = {} } = {}) {
  const req = {
    method, url, headers,
    on(event, cb) {
      if (event === 'data' && body) cb(Buffer.from(body))
      if (event === 'end') cb()
      return req
    },
    destroy() {},
  }
  return req
}

test('apply 注册面板四路由（webServer 存在时）', () => {
  const { ctx, routes } = makeCtx({})
  apply(ctx)
  assert.deepEqual(routes.map((r) => r.path), [
    '/api/claude-move/index', '/api/claude-move/import', '/api/claude-move/progress', '/api/claude-move/job',
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
    '/api/claude-move/index', '/api/claude-move/import', '/api/claude-move/progress', '/api/claude-move/job',
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

test('client bundle：官方 sessions/workspaces 服务特性探测与回退（B1）', () => {
  const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  // 特性探测：不写进 inject（缺服务会让 boot sweep FAILED），apply 里用 get 探测。
  assert.ok(source.includes("ctx.get(name)"), '经 ctx.get 特性探测服务')
  assert.ok(source.includes("safeService(ctx, 'sessions')"), '探测 sessions 服务')
  assert.ok(source.includes("safeService(ctx, 'workspaces')"), '探测 workspaces 服务')
  assert.ok(source.includes("typeof sessions?.refresh === 'function'"), 'sessions.refresh 能力探测')
  assert.ok(source.includes("typeof sessions?.open === 'function'"), 'sessions.open 能力探测')
  assert.ok(source.includes('sessions.open(dshId)'), '打开已导入会话')
  assert.ok(source.includes('window.location.reload()'), '服务缺失回退整页刷新')
  assert.ok(source.includes("data-act=\"open\""), '详情区提供打开会话按钮')
})

test('client bundle：导入取消按钮与 job 取消面（D4/B5）', () => {
  const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  assert.ok(source.includes("id=\"cm-cancel\""), '取消按钮存在')
  assert.ok(source.includes("'/api/claude-move/job?job='"), 'DELETE 取消路由调用')
  assert.ok(source.includes("method: 'DELETE'"), '取消走 DELETE')
  assert.ok(source.includes('currentJobId'), '跟踪当前 job id')
})

test('isTrustedOrigin：loopback/同源放行、跨源拒绝、无 Origin 放行（D6）', () => {
  assert.equal(isTrustedOrigin({ headers: {} }), true, '非浏览器客户端无 Origin 放行')
  assert.equal(isTrustedOrigin({ headers: { origin: 'http://127.0.0.1:3080' } }), true)
  assert.equal(isTrustedOrigin({ headers: { origin: 'http://localhost:3080' } }), true)
  assert.equal(isTrustedOrigin({ headers: { origin: 'http://myhost:3080', host: 'myhost:3080' } }), true, '同源放行')
  assert.equal(isTrustedOrigin({ headers: { origin: 'http://evil.example', host: 'localhost:3080' } }), false, '跨源拒绝')
  assert.equal(isTrustedOrigin({ headers: { origin: 'not-a-url' } }), false)
})

test('POST import：跨源请求 403（D6 状态变更路由加固）', async (t) => {
  const home = await makeTempDir(t)
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = await makeTempDir(t)
  t.after(() => { if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev })

  const projectsDir = path.join(home, 'projects')
  await mkdir(path.join(projectsDir, 'demo-a'), { recursive: true })
  const file = path.join(projectsDir, 'demo-a', 'sess-1.jsonl')
  await writeFile(file, simple, 'utf8')

  const { ctx, routes } = makeCtx({ [projectsDir]: 'dir', [path.join(projectsDir, 'demo-a')]: 'dir', [file]: simple })
  apply(ctx, { claudeHome: home, scanGit: false })
  const importRoute = routes.find((r) => r.path === '/api/claude-move/import')

  const res = mockRes()
  await importRoute.handler(mockReq({
    method: 'POST', url: '/api/claude-move/import',
    headers: { origin: 'http://evil.example', host: 'localhost:3080' },
    body: JSON.stringify({ path: 'all' }),
  }), res)
  assert.equal(res.status, 403)
})

test('DELETE /api/claude-move/job：取消运行中导入，job 落为 cancelled（D4）', async (t) => {
  const home = await makeTempDir(t)
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = await makeTempDir(t)
  t.after(() => { if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev })

  const projectsDir = path.join(home, 'projects')
  await mkdir(path.join(projectsDir, 'demo-a'), { recursive: true })
  const file = path.join(projectsDir, 'demo-a', 'sess-1.jsonl')
  await writeFile(file, simple, 'utf8')

  // 慢 fs：给 DELETE 留出取消窗口（abort 前 readText 不返回）。
  const { ctx, routes } = makeCtx({ [projectsDir]: 'dir', [path.join(projectsDir, 'demo-a')]: 'dir', [file]: simple })
  const slowRead = ctx.fs.readText.bind(ctx.fs)
  ctx.fs.readText = async (target) => {
    await new Promise((resolve) => setTimeout(resolve, 80))
    return slowRead(target)
  }
  apply(ctx, { claudeHome: home, scanGit: false })

  const importRoute = routes.find((r) => r.path === '/api/claude-move/import')
  const postRes = mockRes()
  await importRoute.handler(mockReq({ method: 'POST', url: '/api/claude-move/import', body: JSON.stringify({ path: 'all' }) }), postRes)
  const { jobId } = JSON.parse(postRes.body)

  const jobRoute = routes.find((r) => r.path === '/api/claude-move/job')
  const delRes = mockRes()
  await jobRoute.handler(mockReq({ method: 'DELETE', url: '/api/claude-move/job?job=' + jobId }), delRes)
  assert.equal(delRes.status, 200)

  const progressRoute = routes.find((r) => r.path === '/api/claude-move/progress')
  let job = null
  for (let i = 0; i < 30 && (!job || job.status === 'running'); i++) {
    const res = mockRes()
    await progressRoute.handler(mockReq({ url: '/api/claude-move/progress?job=' + jobId }), res)
    job = JSON.parse(res.body)
    if (job.status === 'running') await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(job.status, 'cancelled')
  assert.equal(job.controller, undefined, 'progress 不透出进程内句柄')
})

test('面板导入任务接入官方 ctx.jobs：start 与 kill 透传（B5）', async (t) => {
  const home = await makeTempDir(t)
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = await makeTempDir(t)
  t.after(() => { if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev })

  const projectsDir = path.join(home, 'projects')
  await mkdir(path.join(projectsDir, 'demo-a'), { recursive: true })
  const file = path.join(projectsDir, 'demo-a', 'sess-1.jsonl')
  await writeFile(file, simple, 'utf8')

  const started = []
  const killed = []
  const base = makeCtx({ [projectsDir]: 'dir', [path.join(projectsDir, 'demo-a')]: 'dir', [file]: simple })
  const originalGet = base.ctx.get.bind(base.ctx)
  base.ctx.get = (service) => {
    if (service === 'jobs') {
      return {
        start(spec) { started.push(spec); return 'host-job-1' },
        kill(id) { killed.push(id) },
      }
    }
    return originalGet(service)
  }
  apply(base.ctx, { claudeHome: home, scanGit: false })

  const importRoute = base.routes.find((r) => r.path === '/api/claude-move/import')
  const postRes = mockRes()
  await importRoute.handler(mockReq({ method: 'POST', url: '/api/claude-move/import', body: JSON.stringify({ path: 'all' }) }), postRes)
  const { jobId } = JSON.parse(postRes.body)
  assert.ok(jobId)
  assert.equal(started.length, 1, '官方 jobs.start 被调用')
  assert.equal(started[0].kind, 'claude-move-import')

  const jobRoute = base.routes.find((r) => r.path === '/api/claude-move/job')
  const delRes = mockRes()
  await jobRoute.handler(mockReq({ method: 'DELETE', url: '/api/claude-move/job?job=' + jobId }), delRes)
  assert.equal(delRes.status, 200)
  assert.deepEqual(killed, ['host-job-1'], '取消透传官方 jobs.kill')
})
