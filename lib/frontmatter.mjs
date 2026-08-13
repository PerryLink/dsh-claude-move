// SPDX-License-Identifier: Apache-2.0
// lib/frontmatter.mjs — Claude Code Markdown frontmatter 解析。
//
// Parser shape vendored from YYTbit/dsh-plugin-claude-bridge (MIT, see
// THIRD_PARTY_NOTICES.md): key: value top-level fields plus indented
// continuation lines; `metadata:\n  type: …` flattened into `metadata` text.

/**
 * 解析 `---\n…\n---` 形式的 YAML frontmatter。
 * @param content - Markdown 全文。
 * @returns `{ meta, body }`；无 frontmatter 时 meta 为空对象、body 为原文。
 */
export function parseFrontmatter(content) {
  const match = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/)
  if (!match) return { meta: {}, body: content }

  const meta = {}
  let currentKey = ''
  let currentValue = ''

  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (kv) {
      if (currentKey) meta[currentKey] = currentValue.trim()
      currentKey = kv[1]
      currentValue = kv[2]
    } else if (line.match(/^\s+/) && currentKey) {
      // 缩进续行（简化多行值）。
      currentValue += ' ' + line.trim()
    }
  }
  if (currentKey) meta[currentKey] = currentValue.trim()

  return { meta, body: match[2].trim() }
}

/**
 * 提取 memory 元数据类型：优先直接 `type` 字段，其次扁平化后的
 * `metadata: type: xxx` 文本。
 * @param meta - `parseFrontmatter` 返回的 meta。
 * @returns `feedback` | `project` | `reference` | `user` | `unknown`。
 */
export function extractMetadataType(meta) {
  if (meta.type) return meta.type
  if (meta.metadata) {
    const typeMatch = meta.metadata.match(/type:\s*(\w+)/)
    if (typeMatch) return typeMatch[1]
  }
  return 'unknown'
}
