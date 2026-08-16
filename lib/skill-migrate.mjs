// SPDX-License-Identifier: Apache-2.0
// lib/skill-migrate.mjs — 四源技能 → DSH 技能目录的兼容判定与转换（零 DSH 依赖）。
//
// DSH 技能落盘约定（$DSH_HOME/skills，官方 skill-filesystem 契约）：
//   - 目录束 `<name>/SKILL.md` 或扁平 `<name>.md`；
//   - SKILL.md 必须有 YAML frontmatter，且 name 与 description 均非空，
//     否则该文件被跳过（甚至拖垮整目录加载，见 issue#1）；
//   - 技能名 kebab-case（[a-z0-9]+(-[a-z0-9]+)*）。
//
// 迁移规则：源 SKILL.md frontmatter 含非空 name+description → 兼容，内容直拷
// （只改落点目录名）；否则合成最小 frontmatter 转换（name 取 frontmatter/目录名
// kebab 化，description 取 frontmatter 或正文首个标题/首行，截断），正文原样保留。
// README.md / MEMORY.md / 隐藏目录（.system/.hub/.git）一律跳过。

import path from 'node:path'
import { parseFrontmatter } from './frontmatter.mjs'

/** DSH 技能名 kebab-case 模式（与官方契约一致）。 */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 非技能文档/内部目录（发现与复制都跳过）。 */
export const SKIP_DIR_RE = /^\./            // .system/.hub/.git 等隐藏目录
export const SKIP_FILE_RE = /^(readme|memory)\.md$/i

/** 技能描述默认上限（合成时截断）。 */
export const DESCRIPTION_MAX = 200

/**
 * 归一化为 kebab-case 技能名。
 * @param raw - 原始名称。
 * @param fallback - 归一化结果为空时使用。
 * @returns kebab-case 名称。
 */
export function kebabName(raw, fallback = 'skill') {
  const slug = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
  return SKILL_NAME_RE.test(slug) ? slug : fallback
}

/**
 * 判定一个技能文件是否与 DSH 契约兼容（可直拷）。
 * @param content - 文件原文。
 * @returns `{ compatible, name, description }`；解析失败时 compatible=false。
 */
export function classifySkill(content) {
  let meta = {}
  let body = String(content ?? '')
  try {
    const parsed = parseFrontmatter(body)
    if (parsed) {
      meta = parsed.meta ?? {}
      body = parsed.body ?? ''
    }
  } catch {
    // 畸形 frontmatter：按不兼容处理（走转换路径补合成 frontmatter）。
    return { compatible: false, name: '', description: '', body }
  }
  const name = String(meta.name ?? '').trim()
  const description = String(meta.description ?? '').trim()
  return {
    compatible: name.length > 0 && description.length > 0,
    name,
    description,
    body,
  }
}

/**
 * 从正文猜测描述：优先首个 markdown 标题，其次首个非空行。
 * @param body - 正文（不含 frontmatter）。
 * @returns 截断后的描述。
 */
export function guessDescription(body) {
  const lines = String(body ?? '').split(/\r?\n/)
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    const heading = t.match(/^#{1,6}\s+(.+)$/)
    const text = heading ? heading[1].trim() : t
    if (text.length === 0) continue
    return text.length <= DESCRIPTION_MAX ? text : text.slice(0, DESCRIPTION_MAX - 3).trimEnd() + '...'
  }
  return ''
}

/**
 * 渲染一个 DSH 技能文件（SKILL.md 全文）。
 * @param content - 源文件原文。
 * @param fallbackName - frontmatter 缺 name 时的兜底名（目录名/文件名 stem）。
 * @returns `{ content, name, description, converted }`；converted=true 表示补过 frontmatter。
 */
export function renderSkill(content, fallbackName = 'skill') {
  const raw = String(content ?? '')
  const { compatible, name, description, body } = classifySkill(raw)
  if (compatible) {
    // 兼容直拷：内容原样保留（frontmatter + 正文）。
    return { content: raw, name: kebabName(name), description, converted: false }
  }
  const finalName = kebabName(name || fallbackName)
  const finalDescription = description || guessDescription(body) || `Migrated skill ${finalName}`
  const rendered = `---\nname: ${finalName}\ndescription: ${finalDescription}\n---\n\n${body.trim()}\n`
  return { content: rendered, name: finalName, description: finalDescription, converted: true }
}

/**
 * 目标技能目录路径：`$DSH_HOME/skills/<kebab-name>/SKILL.md`。
 * @param skillsDir - DSH 技能根目录。
 * @param name - kebab 技能名。
 * @returns SKILL.md 绝对路径。
 */
export function skillTargetPath(skillsDir, name) {
  return path.join(skillsDir, name, 'SKILL.md')
}

/**
 * 技能发现守卫：跳过非技能文档与隐藏目录（.system/.hub/.git 等）。
 * @param entryName - 目录条目名。
 * @returns 是否应跳过。
 */
export function skipSkillEntry(entryName) {
  const s = String(entryName ?? '')
  if (SKIP_DIR_RE.test(s)) return true
  if (SKIP_FILE_RE.test(s)) return true
  return false
}
