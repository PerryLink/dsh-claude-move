// context.test.mjs — 同步注入核心单测：文件缓存、记忆排序与字节上限、CLAUDE.md 项目优先。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  makeFileCache, readMemoriesSync, renderMemories, renderClaudeMd, fileExists,
} from '../lib/context.mjs'

async function makeTempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-move-ctx-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  return dir
}

test('makeFileCache：mtime/ctime 未变复用、变化后重读、缺失返回 null', async (t) => {
  const dir = await makeTempDir(t)
  const file = path.join(dir, 'note.md')
  await writeFile(file, 'v1', 'utf8')
  const cache = makeFileCache()
  assert.equal(cache.read(file), 'v1')
  await writeFile(file, 'v1', 'utf8')
  assert.equal(cache.read(file), 'v1')
  // 等尺寸重写需等时间戳前进（同 tick 等尺寸重写超出时间戳缓存的契约，见 lib/context.mjs）。
  await new Promise((resolve) => setTimeout(resolve, 25))
  await writeFile(file, 'v2', 'utf8')
  assert.equal(cache.read(file), 'v2')
  // 尺寸变化即使同 tick 也能检测。
  await writeFile(file, 'v2-longer', 'utf8')
  assert.equal(cache.read(file), 'v2-longer')
  assert.equal(cache.read(path.join(dir, 'missing.md')), null)
})

test('readMemoriesSync + renderMemories：类型优先级与字节上限（完整条目保留）', async (t) => {
  const dir = await makeTempDir(t)
  const memoryDir = path.join(dir, 'memory')
  await mkdir(memoryDir)
  const write = (name, type, body) => writeFile(path.join(memoryDir, name), `---\nmetadata: type: ${type}\n---\n\n${body}\n`, 'utf8')
  await write('a-user.md', 'user', '用户记忆')
  await write('b-feedback.md', 'feedback', '反馈记忆')
  await write('c-project.md', 'project', '项目记忆')
  await write('d-empty.md', 'reference', '')

  const cache = makeFileCache()
  const memories = readMemoriesSync(memoryDir, cache)
  assert.equal(memories.length, 3, '空体条目跳过')
  const rendered = renderMemories(memories, 1024)
  assert.ok(rendered.indexOf('反馈记忆') < rendered.indexOf('项目记忆'), 'feedback 在 project 前')
  assert.ok(rendered.indexOf('项目记忆') < rendered.indexOf('用户记忆'), 'project 在 user 前')

  const tiny = renderMemories(memories, 40)
  assert.ok(tiny.includes('反馈记忆'), '上限内完整条目保留')
  assert.ok(!tiny.includes('用户记忆'), '超限条目整条丢弃')
  assert.equal(renderMemories([], 100), '')
})

test('renderClaudeMd：项目级在前、全局在后、两者皆空返回空串', () => {
  const text = renderClaudeMd('# 项目指令', '# 全局指令')
  assert.ok(text.indexOf('Project Instructions') < text.indexOf('Global Instructions'))
  assert.equal(renderClaudeMd(null, '# 全局指令').includes('Global Instructions'), true)
  assert.equal(renderClaudeMd(null, null), '')
})

test('fileExists：存在与缺失', async (t) => {
  const dir = await makeTempDir(t)
  const file = path.join(dir, 'x')
  await writeFile(file, '', 'utf8')
  assert.equal(fileExists(file), true)
  assert.equal(fileExists(path.join(dir, 'nope')), false)
  assert.equal(fileExists(''), false)
})
