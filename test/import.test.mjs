// import.test.mjs — 导入集成测试：mock ctx（fs / sessionPersistence / workspaceRegistry），
// 走真实 apply → register → execute 路径，校验幂等、批量、force 重建、行号报错、
// 密钥告警、大小防护与输出 schema。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply, resolveImportTarget, mintForceSessionId, importDirectory } from '../index.mjs'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

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

// 跨平台假路径：树键与工具参数用同一构造，Windows 得 D:\...，其它平台得
// <cwd>/D:\...（反斜杠只是文件名里的字符），mock 与 code 的 path.resolve 结果恒一致。
const P = (...segs) => path.resolve('D:\\demo\\proj', ...segs)
const PC = (...segs) => path.resolve('D:\\claude', ...segs)

const simple = [
  claudeLine('user', { message: { content: '问题一' } }),
  claudeLine('assistant', { message: { content: [{ type: 'text', text: '回答' }] } }),
].join('\n') + '\n'

const withSecrets = claudeLine('user', { message: { content: 'key: ghp_abcdefghijklmnopqrstuvwxyz0123456789AB' } }) + '\n'

// 内存态会话库：create/append/list，模拟 sessionPersistence。
function makePersistence() {
  const sessions = new Map()
  return {
    sessions,
    async list() { return [...sessions.values()].map((s) => s.meta) },
    async create(meta) {
      if (sessions.has(meta.id)) throw new Error('duplicate session ' + meta.id)
      sessions.set(meta.id, { meta, events: [] })
    },
    async append(id, events) {
      const s = sessions.get(id)
      if (!s) throw new Error('unknown session ' + id)
      s.events.push(...events)
    },
  }
}

function makeCtx(tree, overrides = {}) {
  const persistence = makePersistence()
  const attached = []
  const archived = []
  const workspaces = new Map()
  const registered = []
  const entriesCache = new Map()

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
      if (!entriesCache.has(target.targetKey)) {
        const entries = []
        const prefix = target.targetKey.endsWith(path.sep) ? target.targetKey : target.targetKey + path.sep
        for (const [p, v] of Object.entries(tree)) {
          if (p.startsWith(prefix) && p !== prefix) {
            const rest = p.slice(prefix.length)
            if (!rest.includes(path.sep)) {
              entries.push({
                name: rest,
                type: v === 'dir' ? 'directory' : 'file',
                target: { targetKey: p, displayPath: p },
                version: 1,
              })
            }
          }
        }
        entriesCache.set(target.targetKey, entries.sort((a, b) => a.name.localeCompare(b.name)))
      }
      return entriesCache.get(target.targetKey)
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
    async archiveSession(id) { archived.push(id) },
  }

  const ctx = {
    fs,
    sessionPersistence: persistence,
    on: () => () => {},
    get(service) {
      if (service === 'workspaceRegistry') return workspaceRegistry
      if (service === 'sessionPersistence') return persistence
      if (service === 'fs') return fs
      return undefined
    },
    tools: {
      register(def) { registered.push(def); return () => {} },
    },
    ...overrides,
  }
  return { ctx, persistence, attached, archived, registered }
}

async function withTempDshHome(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-move-import-'))
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  t.after(async () => {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

test('apply 注册 claude_scan 与 import_claude', () => {
  const { ctx, registered } = makeCtx({})
  apply(ctx)
  assert.deepEqual(registered.map((d) => d.name), ['claude_scan', 'import_claude'])
})

test('resolveImportTarget：all 映射到 projects 目录', () => {
  const home = path.join('C:', 'Users', 'u', '.claude')
  assert.equal(resolveImportTarget('all', home), path.join(home, 'projects'))
  assert.throws(() => resolveImportTarget('', home), /path 必填/)
})

test('mintForceSessionId：取现有后缀最大值 +1', () => {
  const persisted = new Set(['import-sess-1', 'import-sess-1-1', 'import-sess-1-2', 'other'])
  assert.equal(mintForceSessionId(persisted, 'import-sess-1'), 'import-sess-1-3')
  assert.equal(mintForceSessionId(new Set(), 'import-sess-1'), 'import-sess-1-1')
})

test('单文件导入：落盘、归组、来源映射、输出 schema 校验', async (t) => {
  await withTempDshHome(t)
  const { ctx, persistence, attached, registered } = makeCtx({ [P('sess-1.jsonl')]: simple })
  apply(ctx)
  const def = registered.find((d) => d.name === 'import_claude')
  const value = await def.execute({ path: P('sess-1.jsonl') })

  assert.equal(value.mode, 'single')
  assert.equal(value.status, 'imported')
  assert.equal(value.sessionId, 'import-sess-1')
  assert.equal(value.turns, 1)
  assert.equal(value.alreadyImported, undefined)
  assert.deepEqual(validateJsonSchemaValue(def.output.schema, value), [])

  const saved = persistence.sessions.get('import-sess-1')
  assert.ok(saved)
  assert.equal(saved.meta.cwd, 'D:\\demo\\proj')
  assert.equal(saved.events.at(-1).type, 'turn/end')
  assert.ok(saved.events.every((e, i) => e.seq === i))
  assert.deepEqual(attached, [{ ws: 'D:\\demo\\proj', id: 'import-sess-1' }])
  assert.deepEqual(value.workspace, { attached: true, path: 'D:\\demo\\proj' })
})

test('无 cwd 的 transcript：正常导入但不挂接工作区（F9）', async (t) => {
  await withTempDshHome(t)
  const noCwd = JSON.stringify({
    type: 'user', timestamp: '2026-08-01T10:00:00.000Z', sessionId: 'sess-nocwd',
    message: { content: '无目录的会话' },
  }) + '\n'
  const { ctx, registered } = makeCtx({ [P('nocwd.jsonl')]: noCwd })
  apply(ctx)
  const def = registered.find((d) => d.name === 'import_claude')
  const value = await def.execute({ path: P('nocwd.jsonl') })
  assert.equal(value.status, 'imported')
  assert.deepEqual(value.workspace, { attached: false, reason: 'no-cwd' })
})

test('幂等：重复导入 already-imported 且不重复落盘（F7）', async (t) => {
  await withTempDshHome(t)
  const { ctx, persistence, registered } = makeCtx({ [P('sess-1.jsonl')]: simple })
  apply(ctx)
  const def = registered.find((d) => d.name === 'import_claude')
  const first = await def.execute({ path: P('sess-1.jsonl') })
  const second = await def.execute({ path: P('sess-1.jsonl') })
  assert.equal(first.status, 'imported')
  assert.equal(second.status, 'already-imported')
  assert.equal(second.alreadyImported, true)
  assert.equal(persistence.sessions.size, 1)
})

test('force 副本：旧导入原样保留，以 import-<src>-1 新 id 另存一份完整副本（复制式）', async (t) => {
  await withTempDshHome(t)
  const { ctx, persistence, archived, registered } = makeCtx({ [P('sess-1.jsonl')]: simple })
  apply(ctx)
  const def = registered.find((d) => d.name === 'import_claude')
  await def.execute({ path: P('sess-1.jsonl') })
  const forced = await def.execute({ path: P('sess-1.jsonl'), force: true })

  assert.equal(forced.status, 'imported')
  assert.deepEqual(archived, [], '绝不归档任何会话（复制式迁移）')
  assert.equal(forced.sessionId, 'import-sess-1-1')
  assert.deepEqual(forced.forceImported, { previous: 'import-sess-1', current: 'import-sess-1-1', archived: false })
  assert.ok(persistence.sessions.has('import-sess-1'), '旧副本保留')
  assert.ok(persistence.sessions.has('import-sess-1-1'), '新副本落盘')
  assert.equal(persistence.sessions.size, 2)
})

test('增量续写：源文件新增轮次后重导，同一会话只 append 新事件', async (t) => {
  await withTempDshHome(t)
  const file = P('sess-1.jsonl')
  const tree = { [file]: simple }
  const { ctx, persistence, registered } = makeCtx(tree)
  apply(ctx)
  const def = registered.find((d) => d.name === 'import_claude')
  const first = await def.execute({ path: file })
  assert.equal(first.status, 'imported')
  assert.equal(first.turns, 1)
  const savedFirst = [...persistence.sessions.get('import-sess-1').events]
  assert.equal(savedFirst.length, 6)

  // Claude 侧继续追加第二轮（同一源文件增长）。
  tree[file] = simple.trimEnd() + '\n' + [
    claudeLine('user', { message: { content: '问题二' } }),
    claudeLine('assistant', { message: { content: [{ type: 'text', text: '回答二' }] } }),
  ].join('\n') + '\n'
  const second = await def.execute({ path: file })
  assert.equal(second.status, 'appended')
  assert.equal(second.sessionId, 'import-sess-1', '续写到同一 DSH 会话')
  assert.equal(second.appendedTurns, 1)
  assert.equal(second.turns, 2)
  const saved = persistence.sessions.get('import-sess-1')
  assert.equal(saved.events.length, 12)
  assert.ok(saved.events.every((e, i) => e.seq === i), 'seq 连续')
  assert.deepEqual(saved.events.slice(0, 6), savedFirst, '旧事件一个字节不动')
  assert.equal(saved.events[6].type, 'turn/start')
  assert.equal(saved.events[6].data.turn, 2, '新轮次从第 2 轮开始')

  // 未变化时幂等跳过。
  const third = await def.execute({ path: file })
  assert.equal(third.status, 'already-imported')
  assert.equal(persistence.sessions.get('import-sess-1').events.length, 12)
})

test('轮次内变化：保留已导入快照（changedInPlace），新轮完成后自动续写', async (t) => {
  await withTempDshHome(t)
  const file = P('sess-1.jsonl')
  const tree = { [file]: claudeLine('user', { message: { content: '问题一' } }) + '\n' }
  const { ctx, persistence, registered } = makeCtx(tree)
  apply(ctx)
  const def = registered.find((d) => d.name === 'import_claude')

  // 首次导入：该轮只有提问、尚无回答。
  const first = await def.execute({ path: file })
  assert.equal(first.status, 'imported')
  assert.equal(first.turns, 1)
  assert.equal(persistence.sessions.get('import-sess-1').events.length, 3)

  // 同一轮内补上回答：不能改写已落盘轮次，保守保留快照。
  tree[file] += claudeLine('assistant', { message: { content: [{ type: 'text', text: '回答一' }] } }) + '\n'
  const mid = await def.execute({ path: file })
  assert.equal(mid.status, 'already-imported')
  assert.equal(mid.changedInPlace, true)
  assert.equal(persistence.sessions.get('import-sess-1').events.length, 3, '不动已导入日志')

  // 新的一轮完成后：整轮续写。
  tree[file] += claudeLine('user', { message: { content: '问题二' } }) + '\n'
    + claudeLine('assistant', { message: { content: [{ type: 'text', text: '回答二' }] } }) + '\n'
  const next = await def.execute({ path: file })
  assert.equal(next.status, 'appended')
  assert.equal(next.appendedTurns, 1)
  const saved = persistence.sessions.get('import-sess-1')
  assert.equal(saved.events.length, 9)
  assert.ok(saved.events.every((e, i) => e.seq === i), 'seq 连续')
  assert.equal(saved.events[3].type, 'turn/start')
  assert.equal(saved.events[3].data.turn, 2)
})

test('复制式迁移：导入前后源文件内容不变（绝不删除/改写 Claude 数据）', async (t) => {
  await withTempDshHome(t)
  const file = P('sess-1.jsonl')
  const tree = { [file]: simple }
  const { ctx, registered } = makeCtx(tree)
  apply(ctx)
  const before = tree[file]
  const def = registered.find((d) => d.name === 'import_claude')
  await def.execute({ path: file })
  assert.equal(tree[file], before, '源文件字节不变')
  await def.execute({ path: file, force: true })
  assert.equal(tree[file], before, 'force 也不动源文件')
})

test('工作区镜像：不同 cwd 的会话各自挂接到对应工作区（参考 Claude 项目布局）', async (t) => {
  await withTempDshHome(t)
  const tree = {
    [PC('projects')]: 'dir',
    [PC('projects', 'p1')]: 'dir',
    [PC('projects', 'p1', 'a.jsonl')]: claudeLine('user', { sessionId: 'sess-a', cwd: 'D:\\repo\\one', message: { content: 'q1' } }) + '\n',
    [PC('projects', 'p2')]: 'dir',
    [PC('projects', 'p2', 'b.jsonl')]: claudeLine('user', { sessionId: 'sess-b', cwd: 'D:\\repo\\two', message: { content: 'q2' } }) + '\n',
  }
  const { ctx, attached, registered } = makeCtx(tree)
  apply(ctx)
  const def = registered.find((d) => d.name === 'import_claude')
  const batch = await def.execute({ path: PC('projects'), recursive: true })
  assert.equal(batch.imported, 2)
  assert.equal(batch.failed, 0)
  assert.ok(attached.some((a) => a.ws === 'D:\\repo\\one' && a.id === 'import-sess-a'), '会话 A 挂到 cwd 对应工作区')
  assert.ok(attached.some((a) => a.ws === 'D:\\repo\\two' && a.id === 'import-sess-b'), '会话 B 挂到 cwd 对应工作区')
})

test('畸形行行号上报 + 密钥只报位置（F10/S4）', async (t) => {
  await withTempDshHome(t)
  const raw = [
    claudeLine('user', { message: { content: 'q1' } }),
    '{ broken',
    claudeLine('assistant', { message: { content: [{ type: 'text', text: 'a1' }] } }),
  ].join('\n') + '\n' + withSecrets
  const { ctx, registered } = makeCtx({ [P('sess-1.jsonl')]: raw })
  apply(ctx)
  const def = registered.find((d) => d.name === 'import_claude')
  const value = await def.execute({ path: P('sess-1.jsonl') })

  assert.equal(value.skipped, 1)
  assert.equal(value.skippedLines[0].line, 2)
  assert.equal(value.secrets.total, 1)
  assert.equal(value.secrets.hits[0].kind, 'github-token')
  assert.equal(JSON.stringify(value).includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789AB'), false, '不展示凭据内容')
})

test('批量导入：目录 + already-imported + skipped + 失败，逐文件汇总（F8）', async (t) => {
  await withTempDshHome(t)
  const tree = {
    [PC('projects')]: 'dir',
    [PC('projects', 'demo-a')]: 'dir',
    [PC('projects', 'demo-a', 'a1.jsonl')]: simple,
    [PC('projects', 'demo-a', 'a2.jsonl')]: claudeLine('user', { sessionId: 'sess-2', message: { content: '第二个' } }) + '\n',
    [PC('projects', 'demo-a', 'empty.jsonl')]: '{ no user turns\n',
    [PC('projects', 'demo-a', 'unreadable.jsonl')]: undefined,
  }
  const { ctx, registered } = makeCtx(tree)
  apply(ctx)
  const def = registered.find((d) => d.name === 'import_claude')
  const first = await def.execute({ path: PC('projects'), recursive: true })
  assert.equal(first.mode, 'batch')
  assert.equal(first.total, 4)
  assert.equal(first.imported, 2)
  assert.equal(first.skipped, 1, '无用户轮次的文件跳过')
  assert.equal(first.failed, 1)
  const failedResult = first.results.find((r) => r.status === 'failed')
  assert.ok(failedResult.error)
  assert.deepEqual(validateJsonSchemaValue(def.output.schema, first), [])

  const second = await def.execute({ path: PC('projects') })
  assert.equal(second.imported, 0)
  assert.equal(second.alreadyImported, 2)
})

test('同源 sessionId 冲突：两个文件都导入，第二个后缀避让（不丢历史）', async (t) => {
  await withTempDshHome(t)
  const sameId = (prompt) => JSON.stringify({
    type: 'user', timestamp: '2026-08-01T10:00:00.000Z', sessionId: 'sess-shared',
    cwd: 'D:\\demo\\proj', message: { content: prompt },
  }) + '\n'
  const tree = {
    [P('a.jsonl')]: sameId('文件A的历史'),
    [P('b.jsonl')]: sameId('文件B的历史'),
  }
  const { ctx, persistence, registered } = makeCtx(tree)
  apply(ctx)
  const def = registered.find((d) => d.name === 'import_claude')

  const first = await def.execute({ path: P('a.jsonl') })
  const second = await def.execute({ path: P('b.jsonl') })
  assert.equal(first.status, 'imported')
  assert.equal(first.sessionId, 'import-sess-shared')
  assert.equal(second.status, 'imported', '同 sessionId 的第二文件不静默跳过')
  assert.equal(second.sessionId, 'import-sess-shared-1', '目标 id 冲突后缀避让')
  assert.equal(persistence.sessions.size, 2)

  // 各自幂等
  const again = await def.execute({ path: P('b.jsonl') })
  assert.equal(again.status, 'already-imported')
  assert.equal(again.sessionId, 'import-sess-shared-1')
  assert.equal(persistence.sessions.size, 2)
})

test('源 sessionId 缺失：目标 id 由文件名决定，重复导入幂等', async (t) => {
  await withTempDshHome(t)
  const noId = JSON.stringify({
    type: 'user', timestamp: '2026-08-01T10:00:00.000Z', cwd: 'D:\\demo\\proj', message: { content: '无 id 的会话' },
  }) + '\n'
  const tree = { [P('no-id.jsonl')]: noId }
  const { ctx, persistence, registered } = makeCtx(tree)
  apply(ctx)
  const def = registered.find((d) => d.name === 'import_claude')

  const first = await def.execute({ path: P('no-id.jsonl') })
  assert.equal(first.status, 'imported')
  assert.equal(first.sessionId, 'import-no-id', '文件名 slug 作为稳定目标 id')
  const second = await def.execute({ path: P('no-id.jsonl') })
  assert.equal(second.status, 'already-imported')
  assert.equal(persistence.sessions.size, 1)
})

test('大小防护：超过 maxTranscriptBytes 响亮失败（S2）', async (t) => {
  await withTempDshHome(t)
  const big = claudeLine('user', { message: { content: 'x'.repeat(5000) } }) + '\n'
  const { ctx, registered } = makeCtx({ [P('big.jsonl')]: big })
  apply(ctx, { maxTranscriptBytes: 100 })
  const def = registered.find((d) => d.name === 'import_claude')
  await assert.rejects(
    () => def.execute({ path: P('big.jsonl') }),
    /transcript 过大/,
  )
})

test('exec.signal 已中止：导入立即拒绝且不落盘（工具契约）', async (t) => {
  await withTempDshHome(t)
  const { ctx, persistence, registered } = makeCtx({ [P('sess-1.jsonl')]: simple })
  apply(ctx)
  const def = registered.find((d) => d.name === 'import_claude')
  const controller = new AbortController()
  controller.abort(new Error('cancelled by test'))
  await assert.rejects(
    () => def.execute({ path: P('sess-1.jsonl') }, { signal: controller.signal }),
    /cancelled by test/,
  )
  assert.equal(persistence.sessions.size, 0, '中止时不落盘')
})

test('exec.signal 在途中止：importDirectory 整体抛出 signal.reason', async (t) => {
  await withTempDshHome(t)
  const tree = {
    [PC('projects')]: 'dir',
    [PC('projects', 'p1')]: 'dir',
    [PC('projects', 'p1', 'a.jsonl')]: claudeLine('user', { sessionId: 's-a', message: { content: 'q1' } }) + '\n',
    [PC('projects', 'p1', 'b.jsonl')]: claudeLine('user', { sessionId: 's-b', message: { content: 'q2' } }) + '\n',
    [PC('projects', 'p1', 'c.jsonl')]: claudeLine('user', { sessionId: 's-c', message: { content: 'q3' } }) + '\n',
  }
  const { ctx } = makeCtx(tree)
  apply(ctx)
  const controller = new AbortController()
  const fs = ctx.get('fs')
  const baseRead = fs.readText.bind(fs)
  let reads = 0
  fs.readText = async (target) => {
    reads += 1
    if (reads === 2) controller.abort(new Error('stop mid-batch'))
    return baseRead(target)
  }
  await assert.rejects(
    () => importDirectory(ctx, { targetKey: PC('projects'), displayPath: PC('projects') },
      { recursive: true }, 64 * 1024 * 1024, undefined, 2, controller.signal),
    /stop mid-batch/,
  )
})

test('importConcurrency：并发读取转换保持结果顺序与 id 分配确定性', async (t) => {
  await withTempDshHome(t)
  const file = (name, sid) => JSON.stringify({
    type: 'user', timestamp: '2026-08-01T10:00:00.000Z', sessionId: sid, cwd: 'D:\\demo\\proj',
    message: { content: 'q' + name },
  }) + '\n'
  const tree = {
    [PC('projects')]: 'dir',
    [PC('projects', 'p1')]: 'dir',
    [PC('projects', 'p1', 'a.jsonl')]: file('a', 's-1'),
    [PC('projects', 'p1', 'b.jsonl')]: file('b', 's-2'),
    [PC('projects', 'p1', 'c.jsonl')]: file('c', 's-3'),
    [PC('projects', 'p1', 'd.jsonl')]: file('d', 's-4'),
  }
  const { ctx, persistence, registered } = makeCtx(tree)
  apply(ctx)
  const def = registered.find((d) => d.name === 'import_claude')
  const batch = await def.execute({ path: PC('projects'), recursive: true },
    { signal: new AbortController().signal })
  assert.equal(batch.imported, 4)
  assert.equal(batch.failed, 0)
  assert.deepEqual(
    batch.results.map((r) => r.sessionId),
    ['import-s-1', 'import-s-2', 'import-s-3', 'import-s-4'],
    '文件名序稳定、id 顺序确定',
  )
  assert.deepEqual(batch.results.map((r) => r.status), ['imported', 'imported', 'imported', 'imported'])
  assert.equal(persistence.sessions.size, 4)
})
