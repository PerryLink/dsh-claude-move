// compat-v3.test.mjs — L6 升级/降级兼容实测：导入日志的「落盘形状」必须能通过
// 宿主真实的 V3 恢复边界（`@deepseek-ai/dsh-session` 的 Session.fromRestore，
// packages/core/session/src/index.ts 的 assertAssistantSettlementShape 要求
// assistant/message 的 data.stream 是数组）。本文件直接 import 宿主 devDep
// （与 import.test.mjs 使用 @deepseek-ai/dsh-tools 同一口径），因此断言的是
// 真宿主行为而不是本地镜像：
//   1. 新日志（handle 路径，格式版本 3）可 resume；
//   2. 修复前的形状（缺 stream）被恢复边界响亮拒绝——本次修复的回归钉；
//   3. 旧日志（legacy 路径，header.version 0、无 stream）仍可读回并导出，且
//      stream 有无不影响导出结果（读取方与格式版本无关）；
//   4. 降级方向由宿主语义决定（V3 日志不可被 ≤0.1.2-rc.1 读取），本文件只钉
//      本仓的写入形状与读取宽容度，不模拟宿主迁移链（v0→v1→v2→v3 由宿主
//      session-format-catalog 拥有，本仓 devDeps 不含该包）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { importTranscript, runExport } from '../index.mjs'

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

const oneTurn = [
  claudeLine('user', { message: { content: '问题一' } }),
  claudeLine('assistant', { message: { content: [{ type: 'text', text: '回答' }] } }),
].join('\n') + '\n'

const twoTurns = oneTurn + [
  claudeLine('user', { message: { content: '问题二' } }),
  claudeLine('assistant', { message: { content: [{ type: 'text', text: '回答二' }] } }),
].join('\n') + '\n'

/**
 * handle 形状 sessionPersistence mock（真实 0.1.5-alpha.1 后端的公开形状）：
 * create(meta) → SessionHandle，open(id, access)，list()/stat() 返回快照。
 * currentVersion 可调，用于验证 stream 只在格式版本 >= 2 时注入。
 */
function makeHandlePersistence(currentVersion = SESSION_FORMAT_VERSION) {
  const sessions = new Map()
  const writers = new Set()
  const makeHandle = (id, access) => ({
    id,
    access,
    header: sessions.get(id).meta,
    async read(offset = 0) { return sessions.get(id).events.slice(offset) },
    async append(batch) {
      const s = sessions.get(id)
      for (let i = 0; i < batch.length; i++) {
        if (batch[i].seq !== s.events.length + i) {
          throw new Error(`append seq mismatch: got ${batch[i].seq}, expected ${s.events.length + i}`)
        }
      }
      s.events.push(...batch)
    },
    async flush() {},
    async close() { if (access === 'write') writers.delete(id) },
  })
  return {
    sessions,
    writers,
    generationFormat: { currentVersion },
    async create(meta) {
      if (sessions.has(meta.id)) throw new Error('SessionAlreadyExistsError: ' + meta.id)
      sessions.set(meta.id, { meta, events: [] })
      writers.add(meta.id)
      return makeHandle(meta.id, 'write')
    },
    async open(id, access) {
      if (!sessions.has(id)) throw new Error('SessionPersistenceNotFoundError: ' + id)
      if (access === 'write' && writers.has(id)) throw new Error('SessionAlreadyOwnedError: ' + id)
      if (access === 'write') writers.add(id)
      return makeHandle(id, access)
    },
    async stat(id) {
      const s = sessions.get(id)
      return s ? { header: s.meta, revision: `r${s.events.length}`, eventCount: s.events.length } : undefined
    },
    async list() {
      return [...sessions.values()].map((s) => ({
        header: s.meta, revision: `r${s.events.length}`, eventCount: s.events.length,
      }))
    },
  }
}

/** legacy 形状（≤0.1.2-rc.1）：服务级 create/append/readFrom，无 handle 面。 */
function makeLegacyPersistence() {
  const sessions = new Map()
  return {
    sessions,
    async create(meta) { sessions.set(meta.id, { meta, events: [] }) },
    async append(id, events) { sessions.get(id).events.push(...events) },
    async readFrom(id, fromSeq) {
      const s = sessions.get(id)
      return { meta: s.meta, events: s.events.slice(fromSeq) }
    },
  }
}

function makeCtx(tree, persistence) {
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
    async *streamText(target) { yield tree[target.targetKey] },
    async listDir() { return [] },
    processPath(target) { return target.targetKey },
  }
  const workspaceRegistry = {
    async resolveByPath() { return null },
    async create(p) { return { path: p, attachSession: async () => {} } },
  }
  const ctx = {
    fs,
    on: () => () => {},
    get(service) {
      if (service === 'sessionPersistence') return persistence
      if (service === 'workspaceRegistry') return workspaceRegistry
      if (service === 'fs') return fs
      return undefined
    },
    tools: { register: () => () => {} },
  }
  return ctx
}

async function withTempDshHome(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-move-compat-v3-'))
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
  const home = await mkdtemp(path.join(tmpdir(), 'claude-move-compat-v3-src-'))
  const projDir = path.join(home, 'projects', 'demo')
  await mkdir(projDir, { recursive: true })
  const file = path.join(projDir, 'sess-1.jsonl')
  await writeFile(file, text, 'utf8')
  t.after(() => rm(home, { recursive: true, force: true }))
  return file
}

const persistedIdsOf = (persistence) => new Set(persistence.sessions.keys())

const assistantsOf = (events) => events.filter((e) => e.type === 'assistant/message')

test('L6 新日志可 resume：handle 路径落盘事件满足宿主 V3 恢复边界', async (t) => {
  await withTempDshHome(t)
  const file = await withSourceFile(t, twoTurns)
  const persistence = makeHandlePersistence()
  const ctx = makeCtx({ [file]: twoTurns }, persistence)

  const imported = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence))
  assert.equal(imported.status, 'imported')
  const stored = persistence.sessions.get(imported.sessionId)
  assert.equal(stored.meta.version, SESSION_FORMAT_VERSION, 'handle 路径 header 盖上后端当前格式版本')
  assert.equal(SESSION_FORMAT_VERSION, 3, '宿主基线必须是 V3（本测试的语义前提）')

  const assistants = assistantsOf(stored.events)
  assert.ok(assistants.length > 0)
  for (const event of assistants) {
    assert.ok(Array.isArray(event.data.stream), 'V3 要求 assistant/message.data.stream 是数组')
    assert.deepEqual(event.data.stream, [], '导入的历史回合没有可重放的流，补空数组（与宿主迁移产物一致）')
  }

  // 真正的恢复边界：宿主 Session.fromRestore 必须接受这份日志。
  const restored = Session.fromRestore(
    imported.sessionId, stored.events, stored.meta, 0, 'detached',
  )
  assert.equal(restored.header.id, imported.sessionId)
  assert.equal(restored.header.version, SESSION_FORMAT_VERSION)
  assert.deepEqual(
    restored.log.slice(0, stored.events.length).map((e) => e.type),
    stored.events.map((e) => e.type),
    '恢复出的日志前缀就是种子事件本身',
  )
})

test('L6 回归钉：修复前形状（缺 stream）被宿主恢复边界响亮拒绝', async (t) => {
  await withTempDshHome(t)
  const file = await withSourceFile(t, oneTurn)
  const persistence = makeHandlePersistence()
  const ctx = makeCtx({ [file]: oneTurn }, persistence)
  const imported = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence))
  const stored = persistence.sessions.get(imported.sessionId)

  // 复刻 0.4.4 在 handle 基线下的产物：同一批事件，assistant/message 无 stream。
  const preFix = stored.events.map((event) => {
    if (event.type !== 'assistant/message') return event
    const { stream, ...data } = event.data
    void stream
    return { ...event, data }
  })
  assert.throws(
    () => Session.fromRestore(imported.sessionId, preFix, stored.meta, 0, 'detached'),
    /assistant\/message at index \d+ has invalid settlement fields/,
    '缺 stream 的日志能写入、能读回，但不可续聊——正是 0.4.5 修复的缺口',
  )
})

test('L6 旧日志往返：legacy 形状（header.version 0、无 stream）可读回可导出，且 stream 有无不影响导出', async (t) => {
  await withTempDshHome(t)
  const file = await withSourceFile(t, oneTurn)

  // 旧线（≤0.1.2-rc.1）真实产物形状：服务级 create/append，header.version 0。
  const legacy = makeLegacyPersistence()
  const legacyCtx = makeCtx({ [file]: oneTurn }, legacy)
  const oldImport = await importTranscript(legacyCtx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(legacy))
  const oldEvents = legacy.sessions.get(oldImport.sessionId).events
  assert.equal(legacy.sessions.get(oldImport.sessionId).meta.version, 0, 'legacy 路径 header 版本不动')
  for (const event of assistantsOf(oldEvents)) {
    assert.equal('stream' in event.data, false, 'legacy 路径绝不注入 stream（v0 冻结清单不接受该字段）')
    assert.deepEqual(Object.keys(event.data).sort(), ['message', 'step', 'turn'])
  }

  // 旧日志仍可导出（读取方与 stream 无关）。
  const oldExport = await runExport(legacyCtx, {}, { sessionId: oldImport.sessionId })
  const oldText = await readFile(oldExport.path, 'utf8')
  assert.ok(oldText.trim().length > 0)
  const oldLines = oldText.trim().split('\n').map((line) => JSON.parse(line))
  assert.ok(oldLines.some((record) => record.type === 'assistant' && JSON.stringify(record).includes('回答')))

  // 同一批新线事件：带 stream 与剥掉 stream 的导出必须逐字节一致。
  const handle = makeHandlePersistence()
  const handleCtx = makeCtx({ [file]: oneTurn }, handle)
  const newImport = await importTranscript(handleCtx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(handle))
  const newExport = await runExport(handleCtx, {}, { sessionId: newImport.sessionId })
  const withStreamText = await readFile(newExport.path, 'utf8')

  const storedNew = handle.sessions.get(newImport.sessionId)
  storedNew.events = storedNew.events.map((event) => {
    if (event.type !== 'assistant/message') return event
    const { stream, ...data } = event.data
    void stream
    return { ...event, data }
  })
  const strippedExport = await runExport(handleCtx, {}, { sessionId: newImport.sessionId })
  const withoutStreamText = await readFile(strippedExport.path, 'utf8')
  // 导出每行带随机 uuid（lib/export.mjs 的 randomUUID），比较时归一化掉。
  const normalize = (text) => text.trim().split('\n').map((line) => {
    const record = JSON.parse(line)
    delete record.uuid
    delete record.parentUuid
    if (record.message !== undefined) delete record.message.id
    return record
  })
  assert.deepEqual(normalize(withoutStreamText), normalize(withStreamText), '导出只依赖事件语义，不依赖 stream 字段')
})

test('L6 格式版本门控：后端当前格式 < 2 时不注入 stream（旧冻结清单逐字节不变）', async (t) => {
  await withTempDshHome(t)
  const file = await withSourceFile(t, oneTurn)
  const persistence = makeHandlePersistence(1)
  const ctx = makeCtx({ [file]: oneTurn }, persistence)

  const imported = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence))
  const stored = persistence.sessions.get(imported.sessionId)
  assert.equal(stored.meta.version, 1)
  for (const event of assistantsOf(stored.events)) {
    assert.equal('stream' in event.data, false, '格式 v0/v1 不接受 stream，必须保持旧形状')
  }
})

test('L6 增量续写后可 resume：open(write) 追加的事件同样带 stream', async (t) => {
  await withTempDshHome(t)
  const file = await withSourceFile(t, oneTurn)
  const tree = { [file]: oneTurn }
  const persistence = makeHandlePersistence()
  const ctx = makeCtx(tree, persistence)

  const first = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence))
  tree[file] = twoTurns
  const second = await importTranscript(ctx, { targetKey: file, displayPath: file }, {}, 1 << 20, persistedIdsOf(persistence))
  assert.equal(second.status, 'appended')

  const stored = persistence.sessions.get(first.sessionId)
  assert.equal(stored.events.length, 12)
  for (const event of assistantsOf(stored.events)) {
    assert.ok(Array.isArray(event.data.stream), '续写批次也必须带 stream（两个落盘点都要规范化）')
  }
  const restored = Session.fromRestore(first.sessionId, stored.events, stored.meta, 0, 'detached')
  assert.equal(restored.header.id, first.sessionId)
})
