// SPDX-License-Identifier: Apache-2.0
// lib/skills-provider.mjs — Claude Code 技能 → DSH SkillProvider（F12，零 DSH 依赖）。
//
// DSH 技能名必须是 kebab-case，Claude 技能名不做此保证，这里做归一化
// （小写、非 [a-z0-9-] 折叠为 '-'、冲突加 -2/-3 后缀）。候选只含名称与描述，
// 完整正文在 get() 时按需读取（与 DSH 技能契约一致）。发现约定沿用
// YYTbit/dsh-plugin-claude-bridge（MIT，见 THIRD_PARTY_NOTICES.md）。

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseFrontmatter } from './frontmatter.mjs'

/** Claude 技能提供者的固定 provider 名（技能目录里可辨识）。 */
export const CLAUDE_SKILLS_PROVIDER = 'claude-move'

/** 归一化后的技能名必须满足的 DSH kebab-case 模式。 */
export const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 把任意技能名归一化为 kebab-case。
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
  return slug.length > 0 ? slug : fallback
}

/**
 * 读取一个技能文件（SKILL.md 或扁平 .md）。
 * @param file - 绝对路径。
 * @returns `{ name, description, argumentHint?, level?, content, path }` 或 null。
 */
async function readSkillFile(file) {
  try {
    const content = await readFile(file, 'utf8')
    const { meta, body } = parseFrontmatter(content)
    if (body.trim().length === 0) return null
    const level = meta.level ? Number.parseInt(meta.level, 10) : undefined
    return {
      name: meta.name || path.basename(file).replace(/\.md$/, ''),
      description: meta.description ?? '',
      ...(meta['argument-hint'] ? { argumentHint: meta['argument-hint'] } : {}),
      ...(Number.isFinite(level) ? { level } : {}),
      content: body,
      path: file,
    }
  } catch {
    return null
  }
}

/**
 * 发现一个技能根目录下的全部技能文件：`<root>/<name>/SKILL.md` 与 `<root>/<name>.md`。
 * @param root - 技能根目录。
 * @returns 技能文件绝对路径数组；目录缺失返回空数组。
 */
async function discoverSkillFiles(root) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(path.join(root, entry.name, 'SKILL.md'))
    } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'MEMORY.md') {
      files.push(path.join(root, entry.name))
    }
  }
  return files
}

/**
 * 构造 Claude 技能 SkillProvider（F12）。
 *
 * 归属校验采用候选对象身份（与 dsh-resume-plugin 一致）：list() 为同一路径
 * 且同一分配名复用同一候选对象，get() 拒绝任何非该身份的 candidate。
 * @param options - `{ roots: string[], maxSkills: number }`。
 * @returns `{ name, list, get }`；candidate.locator 为 `{ path }`。
 */
export function makeClaudeSkillsProvider({ roots, maxSkills = 30 }) {
  // path → { candidate, assignedName }：跨 list() 调用保持候选对象身份稳定。
  const owned = new Map()

  // 全集上分配 kebab 名：冲突（含字面 dup-2 撞名）追加 -2/-3 后缀。
  const assignNames = (skills) => {
    const assigned = new Map()
    const taken = new Set()
    for (const skill of skills) {
      const base = kebabName(skill.name)
      let finalName = base
      let n = 2
      while (taken.has(finalName)) finalName = `${base}-${n++}`
      taken.add(finalName)
      assigned.set(skill.path, finalName)
    }
    return assigned
  }

  const provider = {
    name: CLAUDE_SKILLS_PROVIDER,
    async list() {
      const files = []
      for (const root of roots) {
        files.push(...await discoverSkillFiles(root))
      }
      const skills = []
      for (const file of files) {
        const skill = await readSkillFile(file)
        if (skill) skills.push(skill)
      }
      const assigned = assignNames(skills)

      const candidates = []
      const seen = new Set()
      for (const skill of skills) {
        const finalName = assigned.get(skill.path)
        const prev = owned.get(skill.path)
        if (prev && prev.assignedName === finalName) {
          candidates.push(prev.candidate)
        } else {
          const candidate = {
            name: finalName,
            description: skill.description,
            ...(skill.argumentHint ? { whenToUse: `argument hint: ${skill.argumentHint}` } : {}),
            invocation: { modelInvocable: true, userInvocable: true },
            provider: provider.name,
            source: 'claude',
            resourceBase: { kind: 'directory', path: path.dirname(skill.path) },
            rank: 260,
            locator: { path: skill.path },
          }
          owned.set(skill.path, { candidate, assignedName: finalName })
          candidates.push(candidate)
        }
        seen.add(skill.path)
      }
      for (const filePath of [...owned.keys()]) {
        if (!seen.has(filePath)) owned.delete(filePath)
      }
      return candidates.sort((a, b) => a.name.localeCompare(b.name)).slice(0, maxSkills)
    },
    async get(candidate) {
      const prev = candidate?.locator?.path ? owned.get(candidate.locator.path) : undefined
      if (!prev || prev.candidate !== candidate) return undefined
      const skill = await readSkillFile(candidate.locator.path)
      if (!skill) return undefined
      return {
        name: candidate.name,
        description: candidate.description,
        invocation: { modelInvocable: true, userInvocable: true },
        provider: provider.name,
        source: 'claude',
        resourceBase: candidate.resourceBase,
        content: skill.content,
        path: skill.path,
      }
    },
  }
  return provider
}
