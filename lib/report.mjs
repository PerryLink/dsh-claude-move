// SPDX-License-Identifier: Apache-2.0
// lib/report.mjs — 导入报告辅助（零 DSH 依赖）。
//
// S4：疑似密钥/凭据只报告「文件:行:类型」，绝不展示匹配内容本身。

/** 疑似凭据片段模式：kind 标签 + 匹配规则。顺序敏感：更具体的前缀在前，避免重叠计数。 */
export const SECRET_PATTERNS = Object.freeze([
  { kind: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'github-token', pattern: /\bgh[pousr]_[0-9A-Za-z]{36,255}\b|\bgithub_pat_[0-9A-Za-z_]{22,255}\b/g },
  { kind: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { kind: 'anthropic-key', pattern: /\bsk-ant-[0-9A-Za-z\-_]{20,}\b/g },
  { kind: 'openai-key', pattern: /\bsk-(?!ant-)[0-9A-Za-z\-_]{20,}\b/g },
  { kind: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { kind: 'slack-token', pattern: /\bxox[baprs]-[0-9A-Za-z\-]{10,}\b/g },
  { kind: 'generic-bearer', pattern: /(?:"|')?bearer\s+[0-9A-Za-z\-._~+/]{20,}(?:"|')?/gi },
])

/**
 * 扫描原始文本中的疑似凭据片段（S4）。
 * @param text - 原始文本（如 transcript 全文）。
 * @param maxHits - 上报上限，超出截断（完整计数仍保留在 total）。
 * @returns `{ total, hits: [{ line, kind }] }`；无命中返回 `{ total: 0, hits: [] }`。
 */
export function scanSecrets(text, maxHits = 50) {
  const lines = String(text).split('\n')
  const hits = []
  let total = 0
  for (let i = 0; i < lines.length; i++) {
    for (const { kind, pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0
      if (pattern.test(lines[i])) {
        total++
        if (hits.length < maxHits) hits.push({ line: i + 1, kind })
      }
    }
  }
  return { total, hits }
}

/** 权限类记录（S5）：默认不导入，只在报告中统计。 */
export const PERMISSION_RECORD_TYPES = Object.freeze([
  'permission',
  'permission-mode',
  'queue-operation',
])

/**
 * 从 convert 的 typeCounts 汇总权限类记录数量（S5）。
 * @param typeCounts - convert 输出里的 typeCounts。
 * @returns `{ byType, total }`。
 */
export function summarizePermissions(typeCounts) {
  const byType = {}
  let total = 0
  for (const type of PERMISSION_RECORD_TYPES) {
    const count = typeCounts?.[type] ?? 0
    if (count > 0) {
      byType[type] = count
      total += count
    }
  }
  return { byType, total }
}
