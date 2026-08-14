// imports-store.test.mjs — imports.json 并发安全存取（A4）：update 读-改-写串行、
// exclusive 同源互斥/异源并行、原子写不留半截文件。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createImportsStore } from '../lib/imports-store.mjs'
import { loadImports, resolveCacheDir } from '../lib/discovery.mjs'

async function withTempDshHome(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-move-store-'))
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  t.after(async () => {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

test('update：并发读-改-写串行落地，互不覆盖', async (t) => {
  await withTempDshHome(t)
  const store = createImportsStore()
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.update((imports) => {
    imports[`key-${i}`] = { dshId: `import-${i}` }
  })))
  const imports = await loadImports(resolveCacheDir())
  assert.equal(Object.keys(imports).length, 20, '20 次并发写全部落地')
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(imports[`key-${i}`], { dshId: `import-${i}` })
  }
  assert.equal(
    await readFile(path.join(resolveCacheDir(), 'imports.json.tmp')).catch(() => null),
    null,
    '临时文件已被 rename 走',
  )
})

test('update：单次失败不毒化后续写入', async (t) => {
  await withTempDshHome(t)
  const store = createImportsStore()
  await assert.rejects(store.update(() => { throw new Error('boom') }), /boom/)
  await store.update((imports) => { imports.a = { dshId: 'import-a' } })
  const imports = await loadImports(resolveCacheDir())
  assert.deepEqual(imports, { a: { dshId: 'import-a' } })
})

test('exclusive：同 key 互斥、异 key 并行', async (t) => {
  await withTempDshHome(t)
  const store = createImportsStore()
  const state = { running: 0, maxRunning: 0 }
  const run = async () => {
    state.running++
    state.maxRunning = Math.max(state.maxRunning, state.running)
    await new Promise((resolve) => setTimeout(resolve, 20))
    state.running--
  }
  await Promise.all([store.exclusive('same', run), store.exclusive('same', run), store.exclusive('same', run)])
  assert.equal(state.maxRunning, 1, '同 key 串行')

  let overlap = false
  const p1 = store.exclusive('a', async () => { await new Promise((r) => setTimeout(r, 20)); if (state.running > 0) overlap = true; state.running++; await new Promise((r) => setTimeout(r, 20)); state.running-- })
  const p2 = store.exclusive('b', async () => { await new Promise((r) => setTimeout(r, 20)); if (state.running > 0) overlap = true; state.running++; await new Promise((r) => setTimeout(r, 20)); state.running-- })
  await Promise.all([p1, p2])
  assert.equal(overlap, true, '异 key 并行')
})

test('exclusive：先行者失败后，后到者重新执行而非复用失败', async (t) => {
  await withTempDshHome(t)
  const store = createImportsStore()
  let attempts = 0
  const fail = () => { attempts++; return Promise.reject(new Error('first boom')) }
  await assert.rejects(store.exclusive('k', fail), /first boom/)
  assert.equal(attempts, 1)
  const value = await store.exclusive('k', async () => {
    attempts++
    return 'second-ok'
  })
  assert.equal(value, 'second-ok')
  assert.equal(attempts, 2)
})

test('原子写：损坏的旧文件不阻断 update，且读者看不到半截 JSON', async (t) => {
  await withTempDshHome(t)
  const cacheDir = resolveCacheDir()
  await mkdir(cacheDir, { recursive: true })
  await writeFile(path.join(cacheDir, 'imports.json'), '{"half":', 'utf8')
  const store = createImportsStore()
  // 损坏文件按空映射处理，update 后文件恢复完整。
  await store.update((imports) => { imports.x = { dshId: 'import-x' } })
  const parsed = JSON.parse(await readFile(path.join(cacheDir, 'imports.json'), 'utf8'))
  assert.deepEqual(parsed, { x: { dshId: 'import-x' } })
})
