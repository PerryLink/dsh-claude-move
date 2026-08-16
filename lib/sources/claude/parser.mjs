// SPDX-License-Identifier: Apache-2.0
// lib/sources/claude/parser.mjs — Claude Code 源解析器（四合一迁移向导）。
//
// 复用一期 discovery.mjs 的扫描能力（projects/*/*.jsonl、memory、skills、
// CLAUDE.md、settings.json），输出向导统一的 Detection 形状。只读白名单：
// projects 目录、skills 目录、CLAUDE.md、settings.json —— 凭据文件
// （~/.claude.json 等）永不读取。git 探测默认关闭（向导只关心条目，不关心
// 仓库状态；scanGit 开启会派生 git 子进程）。

import path from 'node:path'
import { homedir } from 'node:os'
import { readFile } from 'node:fs/promises'
import {
  locateClaudeHome as locateClaudeRoot,
  scanClaudeHome,
} from '../../discovery.mjs'
import { assertAllowedRead, digestText, emptyDetection, errorText, recordError } from '../contract.mjs'

export const source = 'claude'

/** Claude 数据根定位（$CLAUDE_CONFIG_DIR / ~/.claude，与一期一致）。 */
export function locateHome(env = process.env, home = homedir()) {
  return locateClaudeRoot(env, home)
}

/** 只读白名单：仅四类路径（projects/skills/CLAUDE.md/settings.json）。 */
export function whitelist(home) {
  return [
    path.join(home, 'projects'),
    path.join(home, 'skills'),
    path.join(home, 'CLAUDE.md'),
    path.join(home, 'settings.json'),
  ]
}

/**
 * 从 settings.json 提取 hooks（Claude hooks → 不支持清单的输入）。
 * @param file - settings.json 绝对路径。
 * @returns HookItem 数组；无 hooks/解析失败返回空数组（失败记 errors）。
 */
async function scanHooks(file, detection) {
  let raw
  try {
    raw = await readFile(assertAllowedRead(whitelist(detection.home), file), 'utf8')
  } catch (err) {
    recordError(detection, 'settings.json', err)
    return []
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    recordError(detection, 'settings.json', 'JSON 解析失败：' + errorText(err))
    return []
  }
  const hooks = parsed && typeof parsed === 'object' ? parsed.hooks : undefined
  if (!hooks || typeof hooks !== 'object') return []
  const items = []
  for (const [event, defs] of Object.entries(hooks)) {
    if (!Array.isArray(defs)) continue
    for (const def of defs) {
      const matcher = def && typeof def.matcher === 'string' ? def.matcher : undefined
      items.push({
        id: `${event}:${matcher ?? defs.indexOf(def)}`,
        file,
        kind: `claude-hook:${event}`,
        ...(matcher ? { matcher } : {}),
        bytes: Buffer.byteLength(raw, 'utf8'),
        digest: digestText(raw),
      })
    }
  }
  return items
}

/**
 * 扫描 Claude 数据根（复用一期 scanClaudeHome，scanGit 默认关闭）。
 * @param home - 数据根目录。
 * @param opts - `{ signal, scanGit }`。
 * @returns 统一 Detection。
 */
export async function detect(home, { signal, scanGit = false } = {}) {
  const detection = emptyDetection(source, home)
  const { existsSync } = await import('node:fs')
  detection.homeExists = existsSync(home)
  if (!detection.homeExists) return detection

  let index
  try {
    const result = await scanClaudeHome(home, {
      scanGit,
      ...(signal ? { signal } : {}),
    })
    index = result.index
  } catch (err) {
    if (signal?.aborted) throw err
    recordError(detection, 'scan', err)
    return detection
  }

  // sessions：projects/*/*.jsonl → 统一会话条目；项目级 memories 在项目层收集。
  for (const project of index.projects ?? []) {
    for (const session of project.sessions ?? []) {
      if (session.error) {
        recordError(detection, 'session:' + session.file, new Error(session.error))
        continue
      }
      detection.sessions.push({
        id: session.sessionId ?? session.file,
        file: session.file,
        ...(session.title ? { title: session.title } : {}),
        ...(session.cwd ? { cwd: session.cwd } : {}),
        ...(session.createdAt ? { createdAt: session.createdAt } : {}),
        ...(session.lastActivity ? { lastActivity: session.lastActivity } : {}),
        turns: session.turns ?? 0,
        messages: session.messages ?? 0,
        toolCalls: session.toolCalls ?? 0,
        ...(session.malformed ? { malformed: session.malformed } : {}),
        format: 'claude-jsonl',
      })
    }
    // 项目级 memories（memory/*.md）→ 记忆条目（digest 在此计算，正文映射器再读）。
    for (const memory of project.memories ?? []) {
      let content = ''
      try {
        content = await readFile(assertAllowedRead(whitelist(home), memory.path), 'utf8')
      } catch (err) {
        recordError(detection, 'memory:' + memory.path, err)
        continue
      }
      detection.memories.push({
        id: memory.path,
        file: memory.path,
        kind: `claude-memory:${memory.type ?? 'unknown'}`,
        bytes: Buffer.byteLength(content, 'utf8'),
        digest: digestText(content),
      })
    }
  }

  // skills：~/.claude/skills/** → 技能条目（一期 scanSkills 已过滤无描述文件）。
  for (const skill of index.personal?.skills ?? []) {
    let content = ''
    try {
      content = await readFile(assertAllowedRead(whitelist(home), skill.path), 'utf8')
    } catch (err) {
      recordError(detection, 'skill:' + skill.path, err)
      continue
    }
    detection.skills.push({
      id: skill.path,
      dir: path.dirname(skill.path),
      file: skill.path,
      flat: path.basename(skill.path).toLowerCase() !== 'skill.md',
      name: skill.name,
      description: skill.description,
      compatible: true, // 一期 readSkillFile 已要求 name+description 齐备
      ...(Number.isFinite(skill.level) ? { level: skill.level } : {}),
      digest: digestText(content),
    })
  }

  // instructions：全局 CLAUDE.md。
  const globalClaudeMd = index.personal?.globalClaudeMd
  if (globalClaudeMd) {
    try {
      const content = await readFile(assertAllowedRead(whitelist(home), globalClaudeMd.path), 'utf8')
      detection.instructions.push({
        id: globalClaudeMd.path,
        file: globalClaudeMd.path,
        kind: 'claude-md',
        bytes: globalClaudeMd.sizeBytes ?? Buffer.byteLength(content, 'utf8'),
        digest: digestText(content),
      })
    } catch (err) {
      recordError(detection, 'CLAUDE.md', err)
    }
  }

  // hooks：全局 + 项目级 settings.json 的 hooks 段 → 不支持清单输入。
  if (index.personal?.settings) {
    detection.hooks.push(...await scanHooks(index.personal.settings.path, detection))
  }
  for (const project of index.projects ?? []) {
    if (project.projectSettings) {
      detection.hooks.push(...await scanHooks(project.projectSettings.path, detection))
    }
  }
  return detection
}
