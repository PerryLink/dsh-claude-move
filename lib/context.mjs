// lib/context.mjs — memory 与 CLAUDE.md 的同步注入核心（F11/F13，零 DSH 依赖）。
//
// rc.6 的 systemPrompt 提供者是同步签名且组装不 await（实测），因此本模块
// 只使用 statSync/readFileSync + mtime 缓存：每次请求按 mtime 重读变化文件，
// 新记忆即时生效且不阻塞事件循环超过毫秒级。注入思路沿用
// YYTbit/dsh-plugin-claude-bridge（MIT，见 THIRD_PARTY_NOTICES.md）。

import { statSync, readFileSync, existsSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { parseFrontmatter, extractMetadataType } from './frontmatter.mjs'

/** memory 类型优先级（F11）：feedback > project > reference > user。 */
export const MEMORY_TYPE_PRIORITY = Object.freeze({
  feedback: 0,
  project: 1,
  reference: 2,
  user: 3,
})

/** 默认 memory 注入字节上限（F11）。 */
export const DEFAULT_MEMORY_MAX_BYTES = 8192

/**
 * 同步文件缓存：path → { mtimeMs, size, text }。text 只在 mtime/size 变化时重读。
 * @returns `{ read(file) }`；文件不存在/不可读返回 null。
 */
export function makeFileCache() {
  const cache = new Map()
  return {
    read(file) {
      try {
        const st = statSync(file)
        if (!st.isFile()) return null
        const prev = cache.get(file)
        if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) return prev.text
        const text = readFileSync(file, 'utf8')
        cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, text })
        return text
      } catch {
        // 缺失/不可读：按不存在处理，不抛（注入层容错）。
        return null
      }
    },
  }
}

/**
 * 同步读取一个 memory 目录的全部条目（frontmatter 解析、空体跳过）。
 * @param dir - `~/.claude/projects/<slug>/memory`。
 * @param cache - makeFileCache 实例。
 * @returns `[{ name, type, content, path }]`；目录缺失返回空数组。
 */
export function readMemoriesSync(dir, cache) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const memories = []
  for (const file of entries) {
    if (!file.endsWith('.md') || file === 'MEMORY.md') continue
    const filePath = path.join(dir, file)
    const content = cache.read(filePath)
    if (content === null) continue
    const { meta, body } = parseFrontmatter(content)
    if (body.trim().length === 0) continue
    memories.push({
      name: meta.name || file.replace(/\.md$/, ''),
      type: extractMetadataType(meta),
      content: body,
      path: filePath,
    })
  }
  return memories
}

/**
 * 渲染记忆上下文段（F11）：按类型优先级排序，字节上限内保留完整条目。
 * @param memories - readMemoriesSync 输出。
 * @param maxBytes - 默认 DEFAULT_MEMORY_MAX_BYTES。
 * @returns 渲染文本；无记忆返回 ''。
 */
export function renderMemories(memories, maxBytes = DEFAULT_MEMORY_MAX_BYTES) {
  if (memories.length === 0) return ''
  const sorted = [...memories].sort((a, b) => (
    (MEMORY_TYPE_PRIORITY[a.type] ?? 99) - (MEMORY_TYPE_PRIORITY[b.type] ?? 99)
  ))
  const lines = ['# Agent Memory (from Claude Code)', '']
  let bytes = 0
  for (const memory of sorted) {
    const block = [
      `## ${memory.name} (${memory.type})`,
      '',
      memory.content,
      '',
    ].join('\n')
    if (bytes + Buffer.byteLength(block, 'utf8') > maxBytes) break
    lines.push(...block.split('\n'))
    bytes += Buffer.byteLength(block, 'utf8')
  }
  return lines.join('\n').trimEnd()
}

/**
 * 渲染 CLAUDE.md 指令段（F13）：项目级在前（当前项目优先），全局在后。
 * @param projectText - 项目 `.claude/CLAUDE.md` 文本（可为 null）。
 * @param globalText - 全局 `~/.claude/CLAUDE.md` 文本（可为 null）。
 * @returns 渲染文本；两者皆空返回 ''。
 */
export function renderClaudeMd(projectText, globalText) {
  const parts = []
  if (projectText && projectText.trim().length > 0) {
    parts.push('# Project Instructions (from Claude Code)\n\n' + projectText.trim())
  }
  if (globalText && globalText.trim().length > 0) {
    parts.push('# Global Instructions (from Claude Code)\n\n' + globalText.trim())
  }
  return parts.join('\n\n')
}

/**
 * 判断一个路径是否存在（同步，供提供者内联判断）。
 * @param file - 绝对路径。
 * @returns boolean。
 */
export function fileExists(file) {
  return typeof file === 'string' && file.length > 0 && existsSync(file)
}
