// SPDX-License-Identifier: Apache-2.0
// lib/skills-provider.mjs — Claude Code 技能 → DSH SkillProvider（F12，零 DSH 依赖）。
//
// DSH 技能名必须是 kebab-case，Claude 技能名不做此保证，这里做归一化
// （小写、非 [a-z0-9-] 折叠为 '-'、冲突加 -2/-3 后缀）。候选只含名称与描述，
// 完整正文在 get() 时按需读取（与 DSH 技能契约一致）。发现约定沿用
// YYTbit/dsh-plugin-claude-bridge（MIT，见 THIRD_PARTY_NOTICES.md）。
//
// 对齐当前 DSH 技能契约：list(options)/get(candidate, options) 接收
// `{ cwd, signal }`；options.cwd 命中项目时把该项目 `<cwd>/.claude/skills`
// 一并暴露（Claude Code 项目级技能）；candidate 携带 `path` 与 `metadata`
// 字段；list 尊重 signal 中止。

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseFrontmatter } from './frontmatter.mjs'

/** Claude 技能提供者的固定 provider 名（技能目录里可辨识）。 */
export const CLAUDE_SKILLS_PROVIDER = 'claude-move'

/** 归一化后的技能名必须满足的 DSH kebab-case 模式。 */
export const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 全局技能 rank（更低者赢得同名冲突：全局优先于项目级）。 */
export const GLOBAL_SKILL_RANK = 260

/** 项目级技能 rank（高于全局：同名时全局技能胜出）。 */
export const PROJECT_SKILL_RANK = 280

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
 * 读取一个技能文件（SKILL.md 或扁平 .md）。DSH 技能系统要求每个技能必须有
 * 非空 name 与 description（空 description 会直接抛错并使整个技能目录加载
 * 失败，见 issue#1）；缺失或为空时跳过该文件（与官方 dsh-skill-filesystem
 * 的「warn + ignore」行为一致），绝不产出非法候选。
 * @param file - 绝对路径。
 * @returns `{ name, description, argumentHint?, level?, content, path, meta }` 或 null。
 */
async function readSkillFile(file) {
  try {
    const content = await readFile(file, 'utf8')
    const { meta, body } = parseFrontmatter(content)
    if (body.trim().length === 0) return null
    const name = (meta.name ?? path.basename(file).replace(/\.md$/, '')).trim()
    const description = (meta.description ?? '').trim()
    if (name.length === 0 || description.length === 0) return null
    const level = meta.level ? Number.parseInt(meta.level, 10) : undefined
    return {
      name,
      description,
      ...(meta['argument-hint'] ? { argumentHint: meta['argument-hint'] } : {}),
      ...(Number.isFinite(level) ? { level } : {}),
      content: body,
      path: file,
      meta,
    }
  } catch {
    return null
  }
}

/**
 * 发现一个技能根目录下的全部技能文件：`<root>/<name>/SKILL.md` 与 `<root>/<name>.md`。
 * 显式排除非技能文档：MEMORY.md 与 README.md（Claude skills 目录惯用的
 * 索引/说明文件，无 name/description frontmatter，误注册会令 DSH 技能加载
 * 整体失败，issue#1）。排除文件名匹配大小写不敏感。
 * @param root - 技能根目录。
 * @param signal - 可选 AbortSignal；中止时抛出 signal.reason。
 * @returns 技能文件绝对路径数组；目录缺失返回空数组。
 */
async function discoverSkillFiles(root, signal) {
  let entries
  try {
    signal?.throwIfAborted()
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const NON_SKILL_FILES = /^(memory|readme)\.md$/i
  const files = []
  for (const entry of entries) {
    signal?.throwIfAborted()
    if (entry.isDirectory()) {
      files.push(path.join(root, entry.name, 'SKILL.md'))
    } else if (entry.isFile() && entry.name.endsWith('.md') && !NON_SKILL_FILES.test(entry.name)) {
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
 * 项目级技能（`<cwd>/.claude/skills`）按 options.cwd 动态并入，rank 低于
 * 全局（同名冲突全局胜出）；跨 cwd 的候选对象身份隔离（切换目录后旧候选
 * 归属被回收，get 返回 undefined，由注册表按需失效）。
 * @param options - `{ roots: string[], maxSkills: number }`。
 * @returns `{ name, list, get }`；candidate.locator 为 `{ path }`。
 */
export function makeClaudeSkillsProvider({ roots, maxSkills = 30 }) {
  // path → { candidate, assignedName, rank }：跨 list() 调用保持候选对象身份稳定。
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
    async list(options = {}) {
      const signal = options?.signal
      signal?.throwIfAborted()

      const allRoots = [...roots]
      let projectRootIndex = -1
      // 项目级技能：options.cwd 命中项目时并入（Claude Code 项目技能布局）。
      if (typeof options?.cwd === 'string' && options.cwd.length > 0) {
        projectRootIndex = allRoots.length
        allRoots.push(path.join(options.cwd, '.claude', 'skills'))
      }

      // 按发现来源标记项目级文件（同一文件树里既有目录束也有扁平文件，不能用路径形态判断）。
      const files = []
      for (let i = 0; i < allRoots.length; i++) {
        signal?.throwIfAborted()
        const discovered = await discoverSkillFiles(allRoots[i], signal)
        for (const file of discovered) files.push({ file, project: i === projectRootIndex })
      }
      const skills = []
      for (const entry of files) {
        signal?.throwIfAborted()
        const skill = await readSkillFile(entry.file)
        if (skill) skills.push({ ...skill, project: entry.project })
      }
      const assigned = assignNames(skills)

      const candidates = []
      const seen = new Set()
      for (const skill of skills) {
        signal?.throwIfAborted()
        const finalName = assigned.get(skill.path)
        const rank = skill.project ? PROJECT_SKILL_RANK : GLOBAL_SKILL_RANK
        const prev = owned.get(skill.path)
        if (prev && prev.assignedName === finalName && prev.rank === rank) {
          candidates.push(prev.candidate)
        } else {
          const candidate = {
            name: finalName,
            description: skill.description,
            ...(skill.argumentHint ? { whenToUse: `argument hint: ${skill.argumentHint}` } : {}),
            invocation: { modelInvocable: true, userInvocable: true },
            provider: provider.name,
            source: skill.project ? 'claude-project' : 'claude',
            resourceBase: { kind: 'directory', path: path.dirname(skill.path) },
            rank,
            locator: { path: skill.path },
            path: skill.path,
            metadata: skill.meta,
          }
          owned.set(skill.path, { candidate, assignedName: finalName, rank })
          candidates.push(candidate)
        }
        seen.add(skill.path)
      }
      for (const filePath of [...owned.keys()]) {
        if (!seen.has(filePath)) owned.delete(filePath)
      }
      return candidates.sort((a, b) => a.name.localeCompare(b.name)).slice(0, maxSkills)
    },
    async get(candidate, options = {}) {
      options?.signal?.throwIfAborted()
      const prev = candidate?.locator?.path ? owned.get(candidate.locator.path) : undefined
      if (!prev || prev.candidate !== candidate) return undefined
      const skill = await readSkillFile(candidate.locator.path)
      if (!skill) return undefined
      return {
        name: candidate.name,
        description: candidate.description,
        ...(candidate.whenToUse ? { whenToUse: candidate.whenToUse } : {}),
        invocation: { modelInvocable: true, userInvocable: true },
        provider: provider.name,
        source: candidate.source,
        resourceBase: candidate.resourceBase,
        content: skill.content,
        path: skill.path,
        metadata: skill.meta,
      }
    },
  }
  return provider
}
