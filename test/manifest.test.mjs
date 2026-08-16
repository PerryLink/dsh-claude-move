// manifest.test.mjs — move.json：缺失/损坏容错、串行写、记录追加。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createManifestStore, loadManifest, recordEntry, manifestPath } from '../lib/manifest.mjs'

test('loadManifest：缺失/损坏 → 空对象', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'move-manifest-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.deepEqual(await loadManifest(dir), {})
  const { writeFile } = await import('node:fs/promises')
  await writeFile(manifestPath(dir), 'not-json{', 'utf8')
  assert.deepEqual(await loadManifest(dir), {})
})

test('manifestStore.update：串行读改写，记录可见', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'move-manifest-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = createManifestStore(dir)
  await store.update((m) => recordEntry(m, 'codex:skill:a', { digest: 'd1', target: 'D:\\dsh\\skills\\a\\SKILL.md', action: 'copy' }))
  await store.update((m) => recordEntry(m, 'codex:skill:b', { digest: 'd2', target: 'x', action: 'convert-copy' }))
  const manifest = await loadManifest(dir)
  assert.equal(manifest['codex:skill:a'].digest, 'd1')
  assert.equal(manifest['codex:skill:b'].action, 'convert-copy')
  assert.ok(manifest['codex:skill:a'].appliedAt)
})

test('manifestStore.update：并发更新互不覆盖', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'move-manifest-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = createManifestStore(dir)
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    store.update((m) => recordEntry(m, 'k' + i, { digest: 'd' + i, target: 't', action: 'copy' }))))
  const manifest = await loadManifest(dir)
  assert.equal(Object.keys(manifest).length, 20)
})
