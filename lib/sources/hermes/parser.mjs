// SPDX-License-Identifier: Apache-2.0
// lib/sources/hermes/parser.mjs — Hermes 源解析器（四合一迁移向导）。
//
// Hermes 范围 = skills 与记忆目录（不含会话）：`~/.hermes/state.db` 不在范围，
// 永不读取。skills/ 是嵌套类别目录（skills/<category>/<name>/SKILL.md，类别
// 层数不定）；memories/ 下 MEMORY.md / USER.md 是 `§` 分隔的记忆条目文件，内容
// 原样迁移。只读白名单只含这两个目录：config.yaml / .env / state.db / pending/ /
// skill-bundles/ / journey 数据等凭据与内部状态永不出现在白名单里。

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { assertAllowedRead, digestText, emptyDetection, recordError } from '../contract.mjs'
import { classifySkill, skipSkillEntry } from '../../skill-migrate.mjs'

export const source = 'hermes'

/** 目录/文件缺失（ENOENT/ENOTDIR）→ 视为空，不记错误。 */
function isMissingError(err) {
  return err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')
}

/** Hermes 数据根定位（$HERMES_HOME / ~/.hermes）。 */
export function locateHome(env = process.env, home = homedir()) {
  const raw = env.HERMES_HOME
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return path.resolve(raw)
  }
  return path.join(home, '.hermes')
}

/** 只读白名单：仅 skills 与 memories 两个目录。 */
export function whitelist(home) {
  return [
    path.join(home, 'skills'),
    path.join(home, 'memories'),
  ]
}

/**
 * 读取单个 SKILL.md，产出技能条目（name 缺 frontmatter 时取叶目录名）。
 * @param skillsRoot - skills 根目录（id 以其为相对基准）。
 * @param file - SKILL.md 绝对路径。
 * @param roots - 白名单根列表。
 * @param detection - 用于 recordError。
 * @param signal - 可选 AbortSignal。
 * @returns 技能条目；读取失败记错误并返回 null。
 */
async function readSkill(skillsRoot, file, roots, detection, signal) {
  let content
  try {
    content = await readFile(assertAllowedRead(roots, file), { encoding: 'utf8', ...(signal ? { signal } : {}) })
  } catch (err) {
    if (signal?.aborted) throw err
    recordError(detection, 'skill:' + file, err)
    return null
  }
  const { compatible, name, description } = classifySkill(content)
  const dir = path.dirname(file)
  const id = path.relative(skillsRoot, dir).split(path.sep).join('/')
  return {
    id,
    dir,
    file,
    name: name || path.basename(dir),
    description,
    compatible,
    digest: digestText(content),
  }
}

/**
 * 递归遍历 skills/，跳过 `.` 开头目录/文件与 README.md/MEMORY.md（skipSkillEntry）。
 * @returns SKILL.md 条目数组；目录缺失返回空数组。
 */
async function walkSkills(skillsRoot, dir, roots, out, detection, signal) {
  if (signal?.aborted) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true, ...(signal ? { signal } : {}) })
  } catch (err) {
    if (isMissingError(err)) return
    throw err
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    if (signal?.aborted) return
    if (skipSkillEntry(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkSkills(skillsRoot, full, roots, out, detection, signal)
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      const skill = await readSkill(skillsRoot, full, roots, detection, signal)
      if (skill) out.push(skill)
    }
  }
}

/** 扫描 skills/ 目录（缺失→空数组；读目录失败记错误）。 */
async function scanSkills(skillsRoot, detection, roots, signal) {
  const out = []
  try {
    await walkSkills(skillsRoot, skillsRoot, roots, out, detection, signal)
  } catch (err) {
    if (signal?.aborted) throw err
    recordError(detection, 'skills', err)
  }
  return out
}

/** 扫描 memories/MEMORY.md 与 memories/USER.md（§ 分隔条目，缺失→跳过）。 */
async function scanMemories(memoriesRoot, detection, roots, signal) {
  const out = []
  for (const [id, kind] of [['MEMORY.md', 'hermes-memory'], ['USER.md', 'hermes-user']]) {
    if (signal?.aborted) return out
    const file = path.join(memoriesRoot, id)
    let content
    try {
      content = await readFile(assertAllowedRead(roots, file), { encoding: 'utf8', ...(signal ? { signal } : {}) })
    } catch (err) {
      if (signal?.aborted) throw err
      if (isMissingError(err)) continue
      recordError(detection, 'memories/' + id, err)
      continue
    }
    out.push({
      id,
      file,
      kind,
      bytes: Buffer.byteLength(content, 'utf8'),
      digest: digestText(content),
    })
  }
  return out
}

/**
 * 扫描 Hermes 数据根（skills + memories，不含会话）。
 * @param home - 数据根目录。
 * @param opts - `{ signal }`。
 * @returns 统一 Detection；目录缺失返回空数组。
 */
export async function detect(home, { signal } = {}) {
  const detection = emptyDetection(source, home)
  const roots = whitelist(home)
  const [skillsRoot, memoriesRoot] = roots
  detection.homeExists = existsSync(home)
  detection.skills = await scanSkills(skillsRoot, detection, roots, signal)
  detection.memories = await scanMemories(memoriesRoot, detection, roots, signal)
  return detection
}
