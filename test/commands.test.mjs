// commands.test.mjs — 命令集成测试：注册、claude-import-all、resume-claude（latest/多候选/未命中）、
// 上下文注入与引用解析。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply, resolveResumeTarget, resolveResumeFast, injectContext } from '../index.mjs'

async function makeTempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-move-cmd-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  return dir
}

async function withTempDshHome(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-move-cmd-dsh-'))
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  t.after(async () => {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

function claudeLine(type, extra = {}) {
  return JSON.stringify({
    type,
    timestamp: '2026-08-01T10:00:00.000Z',
    sessionId: 'sess-1',
    cwd: 'C:\\work\\demo',
    ...extra,
  })
}

// 构造带 commands/fs/sessionPersistence/workspaceRegistry 的 mock ctx。
function makeCtx(tree, { persistedIds = [] } = {}) {
  const commandDefs = []
  const injected = []
  const reads = []
  const persistence = {
    sessions: new Map(),
    async list() { return [...persistence.sessions.values()].map((s) => s.meta) },
    async create(meta) {
      if (persistence.sessions.has(meta.id)) throw new Error('duplicate session ' + meta.id)
      persistence.sessions.set(meta.id, { meta, events: [] })
    },
    async append(id, events) {
      const s = persistence.sessions.get(id)
      if (!s) throw new Error('unknown session ' + id)
      s.events.push(...events)
    },
    async readFrom(id, fromSeq) {
      const s = persistence.sessions.get(id)
      if (!s) throw new Error('unknown session ' + id)
      return { meta: s.meta, events: s.events.slice(fromSeq) }
    },
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
      reads.push(target.targetKey)
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
    async create(p) {
      return { path: p, attachSession: async () => {} }
    },
    async archiveSession() {},
  }
  const agent = {
    inject(message) { injected.push(message) },
  }
  const ctx = {
    fs,
    sessionPersistence: persistence,
    tools: { register: () => () => {} },
    on: () => () => {},
    get(service) {
      if (service === 'commands') return { register: (def) => { commandDefs.push(def); return () => {} } }
      if (service === 'workspaceRegistry') return workspaceRegistry
      if (service === 'sessionPersistence') return persistence
      if (service === 'fs') return fs
      return undefined
    },
  }
  return { ctx, commandDefs, injected, persistence, agent, reads }
}

const simpleTranscript = [
  claudeLine('user', { message: { content: '修复登录页' } }),
  claudeLine('assistant', { message: { content: [{ type: 'text', text: '已修改登录代码。' }] } }),
].join('\n') + '\n'

test('apply 注册 claude-import-all / resume-claude / claude-move-reset 命令（及四合一 /move）', () => {
  const { ctx, commandDefs } = makeCtx({})
  apply(ctx)
  assert.deepEqual(commandDefs.map((d) => d.name), ['claude-import-all', 'resume-claude', 'claude-move-reset', 'move'])
  assert.equal(commandDefs[1].input.hint, 'latest | 会话ID | 标题关键词')
})

test('claude-move-reset：清除缓存文件、保留已导入会话（D5）', async (t) => {
  const dshHome = await withTempDshHome(t)
  const cacheDir = path.join(dshHome, 'claude-move')
  await mkdir(cacheDir, { recursive: true })
  await writeFile(path.join(cacheDir, 'index.json'), '{"version":1}', 'utf8')
  await writeFile(path.join(cacheDir, 'imports.json'), '{"a":{"dshId":"import-a"}}', 'utf8')

  const { ctx, commandDefs, persistence, agent } = makeCtx({})
  apply(ctx, {})
  const def = commandDefs.find((d) => d.name === 'claude-move-reset')
  const result = await def.handler({ agent, rawInput: '', signal: new AbortController().signal })
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('已重置'))
  assert.equal(await readFile(path.join(cacheDir, 'index.json')).catch(() => null), null, '书签已清除')
  assert.equal(await readFile(path.join(cacheDir, 'imports.json')).catch(() => null), null, '映射已清除')
  assert.equal(persistence.sessions.size, 0, '重置不触碰 DSH 会话库')
})

test('claude-import-all：批量导入 + 注入报告（F15）', async (t) => {
  await withTempDshHome(t)
  const home = await makeTempDir(t)
  const projectsDir = path.join(home, 'projects')
  const projectDir = path.join(projectsDir, 'demo-a')
  await mkdir(projectDir, { recursive: true })
  const file = path.join(projectDir, 'sess-1.jsonl')
  await writeFile(file, simpleTranscript, 'utf8')

  const { ctx, commandDefs, injected, persistence, agent } = makeCtx({
    [path.join(home, 'projects')]: 'dir',
    [projectDir]: 'dir',
    [file]: simpleTranscript,
  })
  apply(ctx, { claudeHome: home })
  const def = commandDefs.find((d) => d.name === 'claude-import-all')

  const result = await def.handler({ agent, rawInput: '', signal: new AbortController().signal })
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('全量迁移完成'))
  assert.ok(result.text.includes('新增 1'))
  assert.ok(result.text.includes('无需重启 dsh'), '明确告知导入即时生效、无需重启')
  assert.ok(result.text.includes('刷新'), '明确告知已打开的 Web 页面刷新一次会话列表')
  assert.equal(persistence.sessions.size, 1)
  assert.equal(injected.length, 1)
  assert.equal(injected[0].source.kind, 'plugin')
  assert.equal(injected[0].source.plugin, 'claude-move')
  assert.equal(injected[0].role, 'user')
})

test('claude-import-all：projects 目录缺失返回 error', async (t) => {
  await withTempDshHome(t)
  const home = await makeTempDir(t)
  const { ctx, commandDefs, agent } = makeCtx({})
  apply(ctx, { claudeHome: home })
  const def = commandDefs.find((d) => d.name === 'claude-import-all')
  const result = await def.handler({ agent, rawInput: '', signal: new AbortController().signal })
  assert.equal(result.kind, 'error')
  assert.ok(result.text.includes('未找到 Claude projects 目录'))
})

test('resume-claude latest：未导入先导入 + 交接摘要注入（F17）', async (t) => {
  await withTempDshHome(t)
  const home = await makeTempDir(t)
  const projectsDir = path.join(home, 'projects')
  const projectDir = path.join(projectsDir, 'demo-a')
  await mkdir(projectDir, { recursive: true })
  const file = path.join(projectDir, 'sess-1.jsonl')
  await writeFile(file, simpleTranscript, 'utf8')

  const { ctx, commandDefs, injected, persistence, agent } = makeCtx({
    [path.join(home, 'projects')]: 'dir',
    [file]: simpleTranscript,
  })
  apply(ctx, { claudeHome: home, scanGit: false })
  const def = commandDefs.find((d) => d.name === 'resume-claude')

  const result = await def.handler({ agent, rawInput: ' latest ', signal: new AbortController().signal })
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('静态历史'))
  assert.ok(result.text.includes('修复登录页'))
  assert.ok(result.text.includes('import-sess-1'))
  assert.equal(persistence.sessions.size, 1, '未导入先导入')
  assert.equal(injected.length, 1)
  assert.ok(injected[0].content[0].text.includes('静态历史'))
})

test('resume-claude 关键词多候选：列出候选不导入不猜测（F17）', async (t) => {
  await withTempDshHome(t)
  const home = await makeTempDir(t)
  const projectsDir = path.join(home, 'projects')
  await mkdir(path.join(projectsDir, 'a'), { recursive: true })
  await mkdir(path.join(projectsDir, 'b'), { recursive: true })
  const f1 = path.join(projectsDir, 'a', 'sess-1.jsonl')
  const f2 = path.join(projectsDir, 'b', 'sess-2.jsonl')
  const t1 = claudeLine('ai-title', { sessionId: 'sess-1', aiTitle: '修复登录页一' }) + '\n' + claudeLine('user', { sessionId: 'sess-1', message: { content: 'q1' } }) + '\n'
  const t2 = claudeLine('ai-title', { sessionId: 'sess-2', aiTitle: '修复登录页二' }) + '\n' + claudeLine('user', { sessionId: 'sess-2', message: { content: 'q2' } }) + '\n'
  await writeFile(f1, t1, 'utf8')
  await writeFile(f2, t2, 'utf8')

  const { ctx, commandDefs, persistence, agent } = makeCtx({
    [path.join(home, 'projects')]: 'dir',
    [f1]: t1,
    [f2]: t2,
  })
  apply(ctx, { claudeHome: home, scanGit: false })
  const def = commandDefs.find((d) => d.name === 'resume-claude')

  const result = await def.handler({ agent, rawInput: ' 修复登录页 ', signal: new AbortController().signal })
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('匹配到多个会话'))
  assert.ok(result.text.includes('sess-1'))
  assert.ok(result.text.includes('sess-2'))
  assert.equal(persistence.sessions.size, 0, '多候选不导入')
})

test('resume-claude 精确 id 走快路径且只读一次原文（A6）', async (t) => {
  const dshHome = await withTempDshHome(t)
  const home = await makeTempDir(t)
  const projectsDir = path.join(home, 'projects')
  const projectDir = path.join(projectsDir, 'demo-a')
  await mkdir(projectDir, { recursive: true })
  const file = path.join(projectDir, 'sess-1.jsonl')
  await writeFile(file, simpleTranscript, 'utf8')

  // 预置索引书签：快路径应直接用书签定位，无需扫描 claudeHome（树里不提供 projects 目录条目）。
  await mkdir(path.join(dshHome, 'claude-move'), { recursive: true })
  await writeFile(path.join(dshHome, 'claude-move', 'index.json'), JSON.stringify({
    version: 1, claudeHome: home,
    files: { [file]: { file, sessionId: 'sess-1', title: '修复登录页', lastActivity: 1 } },
  }), 'utf8')

  const { ctx, commandDefs, injected, persistence, agent, reads } = makeCtx({
    [file]: simpleTranscript,
  })
  apply(ctx, { claudeHome: home, scanGit: false })
  const def = commandDefs.find((d) => d.name === 'resume-claude')

  const result = await def.handler({ agent, rawInput: 'sess-1', signal: new AbortController().signal })
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('import-sess-1'))
  assert.ok(result.text.includes('静态历史'))
  assert.equal(persistence.sessions.size, 1, '未导入先导入')
  assert.equal(reads.filter((p) => p === file).length, 1, '同一 transcript 只读一次')
  assert.equal(injected.length, 1)
})

test('resolveResumeFast：imports 映射与书签定位 / latest 与未命中回退 null', async (t) => {
  const dshHome = await withTempDshHome(t)
  const cacheDir = path.join(dshHome, 'claude-move')
  await mkdir(cacheDir, { recursive: true })
  const file = path.resolve('C:\\claude\\projects\\demo-a\\sess-1.jsonl')
  const cache = {
    version: 1, claudeHome: path.resolve('C:\\claude'),
    files: {
      [file]: { file, sessionId: 'sess-1', title: '修复登录页', lastActivity: 1 },
    },
  }
  await writeFile(path.join(cacheDir, 'index.json'), JSON.stringify(cache), 'utf8')

  const ctx = { get: () => undefined }
  assert.equal(await resolveResumeFast(ctx, 'latest'), null, 'latest 不走快路径')
  assert.equal(await resolveResumeFast(ctx, ''), null)
  assert.deepEqual(await resolveResumeFast(ctx, 'sess-1'), { session: cache.files[file] })

  // imports.json 里的 dshId 反向定位源会话。
  await writeFile(path.join(cacheDir, 'imports.json'), JSON.stringify({
    [file]: { dshId: 'import-sess-1', turns: 2, events: 8 },
  }), 'utf8')
  assert.deepEqual(await resolveResumeFast(ctx, 'import-sess-1'), { session: cache.files[file] })
  assert.equal(await resolveResumeFast(ctx, 'sess-999'), null, '缓存未命中返回 null（回退全量扫描）')
})

test('resume-claude 未命中返回 error', async (t) => {
  await withTempDshHome(t)
  const home = await makeTempDir(t)
  const { ctx, commandDefs, agent } = makeCtx({})
  apply(ctx, { claudeHome: home })
  const def = commandDefs.find((d) => d.name === 'resume-claude')
  const result = await def.handler({ agent, rawInput: '不存在的东西', signal: new AbortController().signal })
  assert.equal(result.kind, 'error')
  assert.ok(result.text.includes('未找到匹配'))
})

test('resume-claude：resumeMode=agents 经 ctx.agents.resume 打开导入会话（D2）', async (t) => {
  await withTempDshHome(t)
  const home = await makeTempDir(t)
  const projectsDir = path.join(home, 'projects')
  const projectDir = path.join(projectsDir, 'demo-a')
  await mkdir(projectDir, { recursive: true })
  const file = path.join(projectDir, 'sess-1.jsonl')
  await writeFile(file, simpleTranscript, 'utf8')

  const resumed = []
  const { ctx, commandDefs, injected, agent } = makeCtx({ [file]: simpleTranscript })
  const originalGet = ctx.get.bind(ctx)
  ctx.get = (service) => {
    if (service === 'agents') return { resume: async (options) => { resumed.push(options); return {} } }
    return originalGet(service)
  }
  apply(ctx, { claudeHome: home, scanGit: false, resumeMode: 'agents' })
  const def = commandDefs.find((d) => d.name === 'resume-claude')

  const result = await def.handler({ agent, rawInput: 'sess-1', signal: new AbortController().signal })
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('已恢复 DSH 会话'))
  assert.deepEqual(resumed, [{ resumeSessionId: 'import-sess-1' }])
  assert.equal(injected.length, 0, 'agents 模式不注入交接摘要')
})

test('resume-claude：resumeMode=agents 但服务缺失时回退注入（D2 回退）', async (t) => {
  await withTempDshHome(t)
  const home = await makeTempDir(t)
  const projectsDir = path.join(home, 'projects')
  const projectDir = path.join(projectsDir, 'demo-a')
  await mkdir(projectDir, { recursive: true })
  const file = path.join(projectDir, 'sess-1.jsonl')
  await writeFile(file, simpleTranscript, 'utf8')

  const { ctx, commandDefs, injected, agent } = makeCtx({ [file]: simpleTranscript })
  apply(ctx, { claudeHome: home, scanGit: false, resumeMode: 'agents' })
  const def = commandDefs.find((d) => d.name === 'resume-claude')

  const result = await def.handler({ agent, rawInput: 'sess-1', signal: new AbortController().signal })
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('静态历史'))
  assert.equal(injected.length, 1, 'agents 服务缺失回退交接摘要注入')
})

test('resolveResumeTarget：latest/精确 id/import id/多候选/未命中', () => {
  const index = {
    projects: [
      {
        slug: 'a',
        sessions: [
          { sessionId: 's1', title: '修复登录页', lastActivity: 100, import: { status: 'imported', dshSessionId: 'import-s1' } },
          { sessionId: 's2', title: '写测试', lastActivity: 200 },
        ],
      },
    ],
  }
  assert.deepEqual(resolveResumeTarget(index, 'latest'), { kind: 'one', session: index.projects[0].sessions[1] })
  assert.deepEqual(resolveResumeTarget(index, 'import-s1'), { kind: 'one', session: index.projects[0].sessions[0] })
  const many = resolveResumeTarget({ projects: [{ sessions: [{ sessionId: 'a', title: '登录', lastActivity: 1 }, { sessionId: 'b', title: '登录页', lastActivity: 2 }] }] }, '登录')
  assert.equal(many.kind, 'many')
  assert.equal(many.candidates.length, 2)
  assert.equal(resolveResumeTarget(index, 'zzz').kind, 'none')
  assert.equal(resolveResumeTarget({ projects: [] }, 'latest').kind, 'none')
})

test('injectContext：agent 无 inject 返回 false；注入消息形状正确', () => {
  assert.equal(injectContext({}, 'x'), false)
  const messages = []
  const agent = { inject: (m) => messages.push(m) }
  assert.equal(injectContext(agent, 'hello'), true)
  assert.equal(messages[0].role, 'user')
  assert.equal(messages[0].content[0].text, 'hello')
  assert.deepEqual(messages[0].source, { kind: 'plugin', plugin: 'claude-move' })
  assert.ok(messages[0].id.startsWith('claude-move:'))
})
