// persistence-handle.test.mjs — sessionPersistence 双基线 handle 路径回归（0.4.0）：
// mock 为 checkout HEAD（0.1.3-alpha.1）的 handle 形状——create 返回 SessionHandle
// （read/append/flush/close，close 释放单写所有权）、open(id, access)、list()/stat()
// 返回快照对象（{ header, revision, eventCount }），服务级 append/readFrom/listSnapshots
// 一律不存在。钉住：append 后必须 flush（耐久屏障）且成对 close（单写所有权）、
// 单写冲突响亮失败、失败路径不泄漏句柄、list() 快照的导入标注与 cleanStale
// 守卫（header.id 解析失败时绝不误清 imports.json）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { importTranscript, runExport, runScan, persistConverted } from '../index.mjs'
import { convertClaudeJsonl } from '../lib/convert.mjs'

function claudeLine(type, extra = {}) {
  return JSON.stringify({
    type,
    timestamp: '2026-08-01T10:00:00.000Z',
    sessionId: 'sess-1',
    cwd: 'D:\\demo\\proj',
    message: { model: 'claude-sonnet-4-5' },
    ...extra,
  })
}

const P = (...segs) => path.resolve('D:\\demo\\proj', ...segs)
const PC = (...segs) => path.resolve('D:\\claude', ...segs)

const oneTurn = [
  claudeLine('user', { message: { content: '问题一' } }),
  claudeLine('assistant', { message: { content: [{ type: 'text', text: '回答' }] } }),
].join('\n') + '\n'

const twoTurns = [
  claudeLine('user', { message: { content: '问题一' } }),
  claudeLine('assistant', { message: { content: [{ type: 'text', text: '回答' }] } }),
  claudeLine('user', { message: { content: '问题二' } }),
  claudeLine('assistant', { message: { content: [{ type: 'text', text: '回答二' }] } }),
].join('\n') + '\n'

/**
 * 内存态 handle 形状 sessionPersistence mock：
 * - create(meta) → 写句柄（openHandles/writers 记账，模拟单写所有权）；
 * - open(id, 'write') 在他人持有时抛 SessionAlreadyOwnedError；
 * - ops 审计每条 create/open/append/flush/close，供顺序与成对断言。
 */
function makeHandlePersistence() {
  const sessions = new Map()
  const openHandles = new Set()
  const writers = new Set()
  const ops = []
  const state = { failNextAppend: false, failNextFlush: false }

  const makeHandle = (id, meta, access) => {
    const handle = {
      id,
      access,
      header: meta,
      inheritedEventCount: 0,
      closed: false,
      async read(offset = 0) {
        if (handle.closed) throw new Error('SessionHandleClosedError')
        return sessions.get(id).events.slice(offset)
      },
      async append(batch) {
        if (handle.closed) throw new Error('SessionHandleClosedError')
        if (access !== 'write') throw new Error('SessionReadOnlyError')
        if (state.failNextAppend) {
          state.failNextAppend = false
          throw new Error('append failure (simulated)')
        }
        const s = sessions.get(id)
        for (let i = 0; i < batch.length; i++) {
          if (batch[i].seq !== s.events.length + i) {
            throw new Error(`append seq mismatch: got ${batch[i].seq}, expected ${s.events.length + i}`)
          }
        }
        s.events.push(...batch)
        ops.push({ kind: 'append', id, access })
      },
      async flush() {
        if (handle.closed) throw new Error('SessionHandleClosedError')
        if (access !== 'write') throw new Error('SessionReadOnlyError')
        if (state.failNextFlush) {
          state.failNextFlush = false
          throw new Error('flush failure (simulated)')
        }
        ops.push({ kind: 'flush', id, access })
      },
      async close() {
        if (handle.closed) return
        handle.closed = true
        openHandles.delete(handle)
        if (access === 'write') writers.delete(id)
        ops.push({ kind: 'close', id, access })
      },
    }
    openHandles.add(handle)
    return handle
  }

  return {
    sessions,
    openHandles,
    writers,
    ops,
    state,
    generationFormat: { currentVersion: 2 },
    async create(meta) {
      if (sessions.has(meta.id)) {
        const err = new Error(`SessionAlreadyExistsError: ${meta.id}`)
        err.name = 'SessionAlreadyExistsError'
        throw err
      }
      sessions.set(meta.id, { meta, events: [] })
      writers.add(meta.id)
      ops.push({ kind: 'create', id: meta.id, access: 'write' })
      return makeHandle(meta.id, meta, 'write')
    },
    async open(id, access) {
      if (!sessions.has(id)) {
        const err = new Error(`SessionPersistenceNotFoundError: ${id}`)
        err.name = 'SessionPersistenceNotFoundError'
        throw err
      }
      if (access === 'write' && writers.has(id)) {
        const err = new Error(`SessionAlreadyOwnedError: ${id} is already owned by another write handle`)
        err.name = 'SessionAlreadyOwnedError'
        throw err
      }
      if (access === 'write') writers.add(id)
      ops.push({ kind: 'open', id, access })
      return makeHandle(id, sessions.get(id).meta, access)
    },
    async stat(id) {
      const s = sessions.get(id)
      return s ? { header: s.meta, revision: `r${s.events.length}`, eventCount: s.events.length } : undefined
    },
    async list() {
      return [...sessions.values()].map((s) => ({
        header: s.meta,
        revision: `r${s.events.length}`,
        eventCount: s.events.length,
      }))
    },
  }
}

function makeCtx(tree, persistence) {
  const attached = []
  const workspaces = new Map()
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
    async *streamText(target) {
      const v = tree[target.targetKey]
      for (let i = 0; i < v.length; i += 7) yield v.slice(i, i + 7)
    },
    async listDir(target) {
      const prefix = target.targetKey.endsWith(path.sep) ? target.targetKey : target.targetKey + path.sep
      const entries = []
      for (const [p, v] of Object.entries(tree)) {
        if (p.startsWith(prefix) && p !== prefix && !p.slice(prefix.length).includes(path.sep)) {
          entries.push({ name: p.slice(prefix.length), type: v === 'dir' ? 'directory' : 'file', target: { targetKey: p, displayPath: p } })
        }
      }
      return entries
    },
    processPath(target) { return target.targetKey },
  }
  const workspaceRegistry = {
    async resolveByPath(p) { return workspaces.get(p) ?? null },
    async create(p) {
      const ws = { path: p, attachSession: async (id) => attached.push({ ws: p, id }) }
      workspaces.set(p, ws)
      return ws
    },
  }
  const ctx = {
    fs,
    sessionPersistence: persistence,
    on: () => () => {},
    get(service) {
      if (service === 'sessionPersistence') return persistence
      if (service === 'workspaceRegistry') return workspaceRegistry
      if (service === 'fs') return fs
      return undefined
    },
    tools: { register: () => () => {} },
  }
  return { ctx, attached }
}

async function withTempDshHome(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-move-handle-'))
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  t.after(async () => {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

async function withSourceFile(t, text) {
  const home = await mkdtemp(path.join(tmpdir(), 'claude-move-handle-src-'))
  const projDir = path.join(home, 'projects', 'demo')
  await mkdir(projDir, { recursive: true })
  const file = path.join(projDir, 'sess-1.jsonl')
  await writeFile(file, text, 'utf8')
  t.after(() => rm(home, { recursive: true, force: true }))
  return { file, home }
}

function persistedIdsOf(persistence) {
  return new Set([...persistence.sessions.keys()])
}

test('handle 基线首次导入：create → append → flush → close 成对且零句柄泄漏', async (t) => {
  await withTempDshHome(t)
  const { file } = await withSourceFile(t, oneTurn)
  const persistence = makeHandlePersistence()
  const { ctx } = makeCtx({ [file]: oneTurn }, persistence)

  const result = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence))
  assert.equal(result.status, 'imported')
  assert.equal(result.sessionId, 'import-sess-1')

  const kinds = persistence.ops.map((op) => op.kind)
  assert.deepEqual(kinds, ['create', 'append', 'flush', 'close'], 'append 后必须 flush（耐久屏障）且 create 句柄成对 close')
  assert.equal(persistence.writers.size, 0, '导入完成后无残留写所有权')
  assert.equal(persistence.openHandles.size, 0, '导入完成后无未关闭句柄（close 泄漏回归）')

  const stored = persistence.sessions.get(result.sessionId)
  assert.equal(stored.meta.version, 2, 'handle 基线 header 盖后端当前格式版本（generationFormat.currentVersion）')
  assert.equal(stored.meta.isSeeded, false, 'handle 基线 header 显式补 isSeeded:false（后端序列化不丢 undefined）')
  assert.equal(stored.events.length, result.events ?? stored.events.length)
  assert.ok(stored.events.every((e, i) => e.seq === i), '落盘 seq 从 0 连续')
})

test('handle 基线 model source 规范化：缺失 model 的 assistant 回退 provider 字符串', async (t) => {
  await withTempDshHome(t)
  // assistant 行不带 message.model：转换器产出 source.model=null，v2 语义要求非空。
  const noModel = [
    claudeLine('user', { message: { content: '问题一' } }),
    claudeLine('assistant', { message: { content: [{ type: 'text', text: '回答' }] } }),
  ].join('\n') + '\n'
  const { file } = await withSourceFile(t, noModel)
  const persistence = makeHandlePersistence()
  const { ctx } = makeCtx({ [file]: noModel }, persistence)

  const result = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence))
  assert.equal(result.status, 'imported')
  const stored = persistence.sessions.get(result.sessionId)
  const assistant = stored.events.find((e) => e.type === 'assistant/message')
  assert.equal(assistant.data.message.source.model, 'claude-code', '缺 model 时回退 provider，避免无法读取的会话')
  assert.equal(persistence.writers.size, 0)
  assert.equal(persistence.openHandles.size, 0)
})

test('handle 基线幂等重导入：already-imported 且不再触碰句柄', async (t) => {
  await withTempDshHome(t)
  const { file } = await withSourceFile(t, oneTurn)
  const persistence = makeHandlePersistence()
  const { ctx } = makeCtx({ [file]: oneTurn }, persistence)

  const first = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence))
  const opsAfterFirst = persistence.ops.length
  const second = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence))
  assert.equal(second.status, 'already-imported')
  assert.equal(second.sessionId, first.sessionId)
  assert.equal(persistence.ops.length, opsAfterFirst, '幂等跳过不再 create/open/append')
  assert.equal(persistence.writers.size, 0)
  assert.equal(persistence.openHandles.size, 0)
})

test('handle 基线增量续写：open(write) → append → flush → close，不另建会话', async (t) => {
  await withTempDshHome(t)
  const { file } = await withSourceFile(t, oneTurn)
  const tree = { [file]: oneTurn }
  const persistence = makeHandlePersistence()
  const { ctx } = makeCtx(tree, persistence)

  const first = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence))
  const eventsAfterFirst = persistence.sessions.get(first.sessionId).events.length

  tree[file] = twoTurns
  const second = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence))
  assert.equal(second.status, 'appended')
  assert.equal(second.sessionId, first.sessionId)
  assert.equal(second.appendedTurns, 1)

  const kinds = persistence.ops.slice(4).map((op) => op.kind)
  assert.deepEqual(kinds, ['open', 'append', 'flush', 'close'], '增量续写走 open(write) 且 append→flush→close 成对')
  assert.equal(persistence.ops.filter((op) => op.kind === 'create').length, 1, '增量不另建会话')
  const stored = persistence.sessions.get(first.sessionId)
  assert.ok(stored.events.length > eventsAfterFirst, '事件已续写')
  assert.ok(stored.events.every((e, i) => e.seq === i), '续写后 seq 仍连续')
  assert.equal(persistence.writers.size, 0)
  assert.equal(persistence.openHandles.size, 0)
})

test('handle 基线 force 重导入：新 id 完整副本，旧副本原样保留', async (t) => {
  await withTempDshHome(t)
  const { file } = await withSourceFile(t, oneTurn)
  const persistence = makeHandlePersistence()
  const { ctx } = makeCtx({ [file]: oneTurn }, persistence)

  const first = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence))
  const eventsBefore = persistence.sessions.get(first.sessionId).events.length
  const forced = await importTranscript(ctx, { targetKey: file, displayPath: file }, { force: true }, 1 << 20, persistedIdsOf(persistence))
  assert.equal(forced.status, 'imported')
  assert.notEqual(forced.sessionId, first.sessionId)
  assert.equal(persistence.sessions.get(first.sessionId).events.length, eventsBefore, '旧副本一个字节不动')
  assert.equal(persistence.writers.size, 0)
  assert.equal(persistence.openHandles.size, 0)
})

test('handle 基线单写冲突：他人持写所有权时响亮失败，释放后恢复', async (t) => {
  await withTempDshHome(t)
  const { file } = await withSourceFile(t, oneTurn)
  const tree = { [file]: oneTurn }
  const persistence = makeHandlePersistence()
  const { ctx } = makeCtx(tree, persistence)

  const first = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence))
  const holder = await persistence.open(first.sessionId, 'write')
  const eventsBefore = persistence.sessions.get(first.sessionId).events.length

  tree[file] = twoTurns
  await assert.rejects(
    () => importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence)),
    /SessionAlreadyOwnedError/,
    '单写冲突必须响亮失败，绝不静默跳过或覆盖',
  )
  assert.equal(persistence.sessions.get(first.sessionId).events.length, eventsBefore, '冲突失败不写入任何事件')
  assert.ok(persistence.writers.has(first.sessionId), '持有人所有权未被破坏')

  await holder.close()
  const retry = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence))
  assert.equal(retry.status, 'appended', '冲突方释放所有权后重试成功')
  assert.equal(persistence.writers.size, 0)
  assert.equal(persistence.openHandles.size, 0)
})

test('handle 基线失败路径不泄漏句柄：append 抛错仍成对 close（finally 释放）', async (t) => {
  await withTempDshHome(t)
  const { file } = await withSourceFile(t, oneTurn)
  const persistence = makeHandlePersistence()
  const { ctx } = makeCtx({ [file]: oneTurn }, persistence)

  persistence.state.failNextAppend = true
  await assert.rejects(
    () => importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence)),
    /append failure/,
  )
  assert.equal(persistence.writers.size, 0, '失败路径必须释放写所有权')
  assert.equal(persistence.openHandles.size, 0, '失败路径必须关闭句柄（close 泄漏回归）')

  // 半建残留恢复：同名空会话被复用补全，不另建副本。
  const retry = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence))
  assert.equal(retry.status, 'imported')
  assert.equal(retry.recoveredHalfCreated, true)
  assert.equal(persistence.sessions.size, 1, '恢复复用原 id，不产生重复会话')
  assert.equal(persistence.writers.size, 0)
  assert.equal(persistence.openHandles.size, 0)
})

test('handle 基线流式导入：空事件 create 只 flush 物化，后续批次 open(write) 续写', async (t) => {
  await withTempDshHome(t)
  const { file } = await withSourceFile(t, twoTurns)
  const persistence = makeHandlePersistence()
  const { ctx } = makeCtx({ [file]: twoTurns }, persistence)

  // maxBytes 设小，强制走 streamText 分块导入（首个 create 批次事件为空）。
  const result = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 16, persistedIdsOf(persistence))
  assert.equal(result.status, 'imported')
  const kinds = persistence.ops.map((op) => op.kind)
  assert.deepEqual(kinds, ['create', 'flush', 'close', 'open', 'append', 'flush', 'close'],
    '空批次只 flush 物化；事件批次经 open(write) 后 append→flush→close')
  assert.ok(persistence.sessions.get(result.sessionId).events.length > 0)
  assert.equal(persistence.writers.size, 0)
  assert.equal(persistence.openHandles.size, 0)
})

test('handle 基线 annotateImports：list() 快照标注导入状态 + cleanStale 清理', async (t) => {
  const dshHome = await withTempDshHome(t)
  const { file, home } = await withSourceFile(t, oneTurn)
  const persistence = makeHandlePersistence()
  // 预置一个已导入会话（快照路径的导入标注目标）。
  const header = { version: 0, id: 'import-sess-1', createdAt: Date.now(), cwd: P() }
  persistence.sessions.set('import-sess-1', { meta: header, events: [] })

  await mkdir(path.join(dshHome, 'claude-move'), { recursive: true })
  const importsPath = path.join(dshHome, 'claude-move', 'imports.json')
  await writeFile(importsPath, JSON.stringify({
    [file]: { dshId: 'import-sess-1', turns: 1, events: 3 },
    [PC('gone.jsonl')]: { dshId: 'import-gone', turns: 1, events: 3 },
  }), 'utf8')

  const { ctx } = makeCtx({ [file]: oneTurn }, persistence)
  const index = await runScan(ctx, { claudeHome: home, scanGit: false }, {})
  const session = index.projects[0].sessions[0]
  assert.equal(session.import.status, 'imported', '快照对象经 header.id 正确解析')
  assert.equal(session.import.dshSessionId, 'import-sess-1')
  assert.equal(index.importsCleaned, 1, '失效映射清理并报告条数')
  const imports = JSON.parse(await readFile(importsPath, 'utf8'))
  assert.deepEqual(Object.keys(imports), [file], '映射文件只保留有效记录')
})

test('handle 基线误清空守卫：list() 元素解析不出 header.id → 响亮拒绝且映射原样', async (t) => {
  const dshHome = await withTempDshHome(t)
  const { file, home } = await withSourceFile(t, oneTurn)
  await mkdir(path.join(dshHome, 'claude-move'), { recursive: true })
  const importsPath = path.join(dshHome, 'claude-move', 'imports.json')
  const original = JSON.stringify({ [file]: { dshId: 'import-sess-1', turns: 1, events: 3 } })
  await writeFile(importsPath, original, 'utf8')

  // 形状无法识别的列表元素（既无 header.id 也无 id）——正是 checkout HEAD 上
  // 旧代码把快照当 SessionHeader 读 id 的误清空场景。
  const bogusPersistence = { list: async () => [{ revision: 'r1' }] }
  const { ctx } = makeCtx({ [file]: oneTurn }, bogusPersistence)
  await assert.rejects(
    () => runScan(ctx, { claudeHome: home, scanGit: false }, {}),
    /header\.id/,
    '解析失败必须响亮抛出',
  )
  assert.equal(await readFile(importsPath, 'utf8'), original, 'imports.json 一个字节不改（绝不静默清空）')
})

test('handle 基线 runExport：open(read) 读日志回迁，句柄成对关闭', async (t) => {
  const dshHome = await withTempDshHome(t)
  const { file } = await withSourceFile(t, oneTurn)
  const persistence = makeHandlePersistence()
  const { ctx } = makeCtx({ [file]: oneTurn }, persistence)

  const imported = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence))
  const opsBefore = persistence.ops.length
  const value = await runExport(ctx, {}, { sessionId: imported.sessionId })
  assert.equal(value.sessionId, imported.sessionId)
  assert.equal(value.turns, 1)

  const kinds = persistence.ops.slice(opsBefore).map((op) => op.kind)
  assert.deepEqual(kinds, ['open', 'close'], '导出走 open(read) 且句柄成对关闭')
  const readOp = persistence.ops[opsBefore]
  assert.equal(readOp.access, 'read', '导出绝不动用写所有权')
  assert.equal(persistence.writers.size, 0)

  const raw = await readFile(value.path, 'utf8')
  for (const line of raw.trim().split('\n')) assert.doesNotThrow(() => JSON.parse(line))
})
