// SPDX-License-Identifier: Apache-2.0
// lib/imports-store.mjs — imports.json 的并发安全存取与源文件级 in-flight 锁（零 DSH 依赖）。
//
// 导入可以由模型工具（import_claude）、命令（claude-import-all）与面板 job
// 并发触发；imports.json 是单一文件，读-改-写必须串行化，同一源文件并发
// 导入必须互斥（后者等待前者落盘后按幂等路径复用结果，避免 create duplicate
// 与映射互相覆盖）。写走 discovery 的原子写（tmp + rename），并发读方不会
// 读到半截 JSON。

import { loadImports, saveImports, resolveCacheDir } from './discovery.mjs'

/**
 * imports.json 的串行读-改-写存取器 + 源文件级互斥锁。
 * @returns `{ update, exclusive }`。
 */
export function createImportsStore() {
  let writeChain = Promise.resolve()
  const sourceLocks = new Map()

  return {
    /**
     * 串行执行「读取 → mutator 就地修改 → 原子写回」。多个并发调用按提交
     * 顺序依次落地，绝不互相覆盖；单次失败不影响后续写入。
     * @param mutator - `(imports) => result`，就地修改 imports 并返回结果。
     * @returns 拒绝时抛出该次错误（调用方决定处理）；链上后续写不受影响。
     */
    update(mutator) {
      const next = writeChain.then(async () => {
        const imports = await loadImports(resolveCacheDir())
        const result = await mutator(imports)
        await saveImports(resolveCacheDir(), imports)
        return result
      })
      // 队列吞掉失败：单次失败不阻塞/毒化后续写入（错误已随 next 抛给本次调用方）。
      writeChain = next.catch(() => {})
      return next
    },

    /**
     * 同一源文件互斥：并发调用同一 key 时按到达顺序排队，后到者等待先行者
     * （含失败）完成后重新执行 fn——此时 imports.json 已含先行者记录，fn
     * 内部按幂等路径处理。排队期间的新到达者挂在最新任务后，绝不并行。
     * @param key - 互斥键（源 transcript 绝对路径）。
     * @param fn - 独占执行的任务。
     * @returns fn 的结果。
     */
    async exclusive(key, fn) {
      const prev = sourceLocks.get(key)
      const task = (async () => {
        if (prev !== undefined) await prev.catch(() => {})
        return fn()
      })()
      sourceLocks.set(key, task)
      try {
        return await task
      } finally {
        if (sourceLocks.get(key) === task) sourceLocks.delete(key)
      }
    },
  }
}

/** 插件进程内的默认实例（index.mjs 与测试可各持实例，互不影响）。 */
export const importsStore = createImportsStore()
