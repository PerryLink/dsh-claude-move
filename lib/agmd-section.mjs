// SPDX-License-Identifier: Apache-2.0
// lib/agmd-section.mjs — $DSH_HOME/AGENTS.md 管理段读写（零 DSH 依赖）。
//
// 迁移记忆/指令文件到 DSH 全局 AGENTS.md：每个条目一个带标记注释的管理段，
// 追加写、幂等替换、冲突 diff。绝不重写管理段之外的既有内容。
//
// 段格式：
//   <!-- dsh-move:managed:start <key> -->
//   <content>
//   <!-- source: <sourceFile> -->
//   <!-- dsh-move:managed:end <key> -->

import path from 'node:path'
import { homedir } from 'node:os'
import { digestText } from './sources/contract.mjs'

/**
 * DSH 全局 AGENTS.md 默认路径：$DSH_HOME/AGENTS.md，DSH_HOME 缺失时 ~/.dsh/AGENTS.md。
 * @param env - 环境对象，缺省 process.env。
 * @returns 绝对路径。
 */
export function defaultAgentsMdPath(env = process.env) {
  const base = env.DSH_HOME || path.join(homedir(), '.dsh')
  return path.join(base, 'AGENTS.md')
}

/** 段渲染：内容 + 来源行 + 首尾标记（行间无多余空行，摘要比较稳定）。 */
export function renderSection(key, content, sourceFile) {
  const src = sourceFile ? `<!-- source: ${sourceFile} -->\n` : ''
  return `<!-- dsh-move:managed:start ${key} -->\n${String(content ?? '').trim()}\n${src}<!-- dsh-move:managed:end ${key} -->`
}

/** 段内文本（与 renderSection 的标记间内容一致，供摘要比较）。 */
export function sectionInner(content, sourceFile) {
  return String(content ?? '').trim() + (sourceFile ? `\n<!-- source: ${sourceFile} -->` : '')
}

/**
 * 解析现有 AGENTS.md：定位全部管理段（含未闭合段容错）。
 * @param text - 全文。
 * @returns `{ sections: Map<key, {startLine, endLine, raw}>, ordered: string[] }`。
 */
export function parseSections(text) {
  const raw = String(text ?? '')
  const lines = raw.split(/\r?\n/)
  const sections = new Map()
  const ordered = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^<!--\s*dsh-move:managed:start\s+(\S+?)\s*-->$/)
    if (!m) continue
    const key = m[1]
    const startLine = i
    let endLine = -1
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === `<!-- dsh-move:managed:end ${key} -->`) {
        endLine = j
        break
      }
    }
    if (endLine < 0) continue // 未闭合：按普通文本处理，不吞掉。
    sections.set(key, { startLine, endLine, raw: lines.slice(startLine + 1, endLine).join('\n') })
    ordered.push(key)
    i = endLine
  }
  return { sections, ordered, lines }
}

/**
 * 计算把某段写入 AGENTS.md 的计划。
 * @param current - 现有全文（可为空）。
 * @param key - 段 key。
 * @param content - 新段内容。
 * @param sourceFile - 来源文件（渲染进段内）。
 * @returns 无既有段 → `{ status: 'new', text }`；同摘要 → `{ status: 'unchanged' }`；
 *          有既有段且不同 → `{ status: 'replace', text, oldContent, newContent, diff }`。
 */
export function planSection(current, key, content, sourceFile) {
  const rendered = renderSection(key, content, sourceFile)
  const { sections, lines } = parseSections(current)
  const existing = sections.get(key)
  if (!existing) {
    const base = current && current.trim().length > 0
      ? current.replace(/\s+$/, '') + '\n\n'
      : ''
    return { status: 'new', text: base + rendered + '\n' }
  }
  if (digestText(existing.raw) === digestText(sectionInner(content, sourceFile))) {
    return { status: 'unchanged' }
  }
  const rebuilt = []
  for (let i = 0; i < lines.length; i++) {
    const hit = [...sections.values()].find((s) => s.startLine === i)
    if (hit) {
      rebuilt.push(hit.startLine === existing.startLine && hit.endLine === existing.endLine
        ? rendered
        : lines.slice(hit.startLine, hit.endLine + 1).join('\n'))
      i = hit.endLine
      continue
    }
    rebuilt.push(lines[i])
  }
  const text = rebuilt.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n'
  return {
    status: 'replace',
    text,
    oldContent: existing.raw,
    newContent: content.trim(),
    diff: lineDiff(existing.raw, rendered),
  }
}

/** 段合并（merge 冲突解法）：旧段内容后接新内容（记忆条目追加语义）。 */
export function mergedSection(current, key, content, sourceFile) {
  const { sections } = parseSections(current)
  const existing = sections.get(key)
  const merged = existing
    ? existing.raw.replace(/<!-- source: .* -->\s*$/, '').trimEnd() + '\n\n' + String(content ?? '').trim()
    : String(content ?? '').trim()
  return planSection(current, key, merged, sourceFile)
}

/**
 * 计算两个文本的简化行级 diff（预览用，不含上下文行）。
 * @param oldText - 旧内容。
 * @param newText - 新内容。
 * @returns `- 旧行` / `+ 新行` 数组（上限 200 行）。
 */
export function lineDiff(oldText, newText, cap = 200) {
  const a = String(oldText ?? '').split(/\r?\n/)
  const b = String(newText ?? '').split(/\r?\n/)
  const diff = []
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len && diff.length < cap; i++) {
    if (i >= a.length) {
      diff.push('+ ' + b[i])
    } else if (i >= b.length) {
      diff.push('- ' + a[i])
    } else if (a[i] !== b[i]) {
      diff.push('- ' + a[i])
      if (diff.length < cap) diff.push('+ ' + b[i])
    }
  }
  return diff
}
