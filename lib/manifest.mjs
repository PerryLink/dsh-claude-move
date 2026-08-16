// SPDX-License-Identifier: Apache-2.0
// lib/manifest.mjs — move.json 迁移清单的并发安全存取（零 DSH 依赖）。
//
// 幂等基础：每个已执行计划记录 { digest, target, appliedAt, action }，
// 重跑时摘要未变即跳过；force 重应用。写入串行化 + 原子写（tmp + rename），
// 与 imports.json（会话级幂等）并存：会话走一期 imports 机制，文件类走本清单。

import path from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolveCacheDir } from './discovery.mjs'

/** 清单文件路径（与一期缓存同目录，`$DSH_HOME/claude-move/move.json`）。 */
export function manifestPath(cacheDir = resolveCacheDir()) {
  return path.join(cacheDir, 'move.json')
}

/** 原子写 JSON（tmp + rename；目录缺失先建）。 */
export async function atomicWriteJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await rename(tmp, file)
}

/**
 * 读取清单；缺失/损坏返回空对象（损坏不抛，重跑按全新清单处理）。
 * @param cacheDir - 缓存目录。
 * @returns 记录映射 `{ key: { digest, target, appliedAt, action } }`。
 */
export async function loadManifest(cacheDir = resolveCacheDir()) {
  try {
    const raw = await readFile(manifestPath(cacheDir), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    // 缺失/损坏：空清单。
  }
  return {}
}

/**
 * 清单串行读-改-写存取器（与 imports-store 同构）。
 * `cacheDir` 每次操作时惰性解析（默认值在调用时求值）：进程级单例
 * 不得在 import 时绑定 DSH_HOME，否则测试/临时 profile 的覆盖会写进默认家目录。
 * @param cacheDir - 缓存目录；缺省时每次调用经 resolveCacheDir() 惰性解析。
 * @returns `{ update, load }`。
 */
export function createManifestStore(cacheDir) {
  let writeChain = Promise.resolve()
  return {
    load: () => loadManifest(cacheDir ?? resolveCacheDir()),
    /** 串行「读取 → mutator 就地修改 → 原子写回」；单次失败不毒化后续写入。 */
    update(mutator) {
      const dir = cacheDir ?? resolveCacheDir()
      const next = writeChain.then(async () => {
        const manifest = await loadManifest(dir)
        const result = await mutator(manifest)
        await atomicWriteJson(manifestPath(dir), manifest)
        return result
      })
      writeChain = next.catch(() => {})
      return next
    },
  }
}

/** 记录一条已执行计划。 */
export function recordEntry(manifest, key, record) {
  manifest[key] = { appliedAt: new Date().toISOString(), ...record }
}

/** 默认进程内实例（index.mjs 与测试可各持实例）。 */
export const manifestStore = createManifestStore()
