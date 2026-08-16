// SPDX-License-Identifier: Apache-2.0
// lib/sources/contract.mjs — 四源迁移共享契约（零 DSH 依赖）。
//
// 每个源在 lib/sources/<source>/ 下提供一个解析器（parser.mjs）与一个映射器
// （mapper.mjs），两者都只依赖本契约与零依赖工具模块（convert.mjs 会话合成、
// skill-migrate.mjs 技能兼容判定、commands-migrate.mjs 命令分类）。解析器负责
// 数据根定位 + 只读白名单内的结构化扫描；映射器把清单变成迁移计划/不支持清单，
// 纯函数、可独立单测。
//
// 解析器导出约定：
//   export const source = 'codex'
//   export function locateHome(env, home)   // 数据根定位（$CODEX_HOME / ~/.codex …）
//   export function whitelist(home)         // 允许读取的绝对路径根列表（只读白名单）
//   export async function detect(home, opts) // 结构化清单，形状见下
//
// 映射器导出约定：
//   export function mapSource(source, detection, opts) → { plans, unsupported }

import { createHash } from 'node:crypto'
import path from 'node:path'

/** 支持的四个源标识（stable）。 */
export const SOURCES = ['claude', 'codex', 'opencode', 'hermes']

/** 会话类计划与文件类计划共用的幂等键前缀。 */
export function planKey(source, kind, id) {
  return `${source}:${kind}:${String(id ?? '')}`
}

/**
 * 平台感知的路径包含判定（Windows 大小写不敏感）。
 * @param root - 白名单根（绝对路径）。
 * @param absPath - 待判定绝对路径。
 * @returns boolean。
 */
export function isInsideRoot(root, absPath) {
  const rel = path.relative(root, absPath)
  if (rel === '' || rel === '.') return true
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false
  return true
}

/**
 * 只读白名单守卫：路径必须落在某个允许根内，否则大声失败（S1：绝不越界读隐私文件）。
 * 每个源的 whitelist(home) 决定可读面；auth.json / state db / log / .env 等
 * 凭据与内部状态永不出现在白名单里。
 * @param roots - 允许根列表。
 * @param absPath - 待读取的绝对路径。
 * @returns 归一化后的绝对路径。
 */
export function assertAllowedRead(roots, absPath) {
  const target = path.resolve(String(absPath ?? ''))
  const ok = (roots ?? []).some((root) => isInsideRoot(root, target))
  if (!ok) {
    throw new Error(`读取越界（白名单外）：${target}`)
  }
  return target
}

/** 越界/失败文案的统一提取。 */
export function errorText(err) {
  if (err && typeof err.message === 'string') return err.message
  return String(err)
}

/** 内容摘要（幂等比对）。 */
export function digestText(text) {
  return createHash('sha256').update(String(text ?? '')).digest('hex')
}

/** 标题截断（合成 fixture/映射器共用）。 */
export function truncateText(text, max = 120) {
  const s = String(text ?? '').trim().replace(/\s+/g, ' ')
  return s.length <= max ? s : s.slice(0, max - 3).trimEnd() + '...'
}

/** 解析器统一返回的计数/错误骨架。 */
export function emptyDetection(source, home) {
  return {
    source,
    home,
    homeExists: false,
    scannedAt: new Date().toISOString(),
    sessions: [],
    skills: [],
    memories: [],
    instructions: [],
    commands: [],
    hooks: [],
    errors: [],
  }
}

/**
 * 合并多源检测为一份索引（move_detect 全量输出）。
 * @param detections - 各源 detect() 结果。
 * @returns `{ sources: Detection[], stats: { sessions, skills, memories, instructions, commands, hooks } }`。
 */
export function mergeDetections(detections) {
  const stats = { sessions: 0, skills: 0, memories: 0, instructions: 0, commands: 0, hooks: 0 }
  for (const d of detections ?? []) {
    stats.sessions += d.sessions?.length ?? 0
    stats.skills += d.skills?.length ?? 0
    stats.memories += d.memories?.length ?? 0
    stats.instructions += d.instructions?.length ?? 0
    stats.commands += d.commands?.length ?? 0
    stats.hooks += d.hooks?.length ?? 0
  }
  return { sources: detections ?? [], stats }
}

/**
 * 迁移计划形状（mapper 输出 / wizard 输入）：
 * {
 *   key,                       // 幂等键 = planKey(source, kind, id)
 *   from,                      // 'claude'|'codex'|'opencode'|'hermes'（源标识）
 *   kind,                      // 'session'|'skill'|'memory'|'instruction'|'command'|'hook'
 *   action,                    // 'import-session'|'copy'|'convert-copy'|'append-section'|'register-command'|'unsupported'
 *   source: { file?, dir?, name?, title?, ... },  // 源定位对象（与 from 区分，避免同名键覆盖）
 *   target: { path?, sessionId?, commandName? },
 *   digest?,                   // 文件类计划的内容摘要（幂等）
 *   content?,                  // 生成内容（append-section / convert-copy）
 *   companionDirs?,            // 技能伴随目录（复制整个技能目录时）
 *   provider?, model?, title?, // session 类
 *   reason?,                   // unsupported 原因（含建议）
 * }
 * @param source - 源标识。
 * @param kind - 计划种类。
 * @param id - 条目 id。
 * @param extra - 其余字段（source 对象/action/target 等）。
 * @returns 计划对象。
 */
export function makePlan(source, kind, id, extra = {}) {
  return { key: planKey(source, kind, id), from: source, kind, ...extra }
}

/** 解析器统一的扫描错误记录。 */
export function recordError(detection, scope, err) {
  detection.errors.push({ scope, error: errorText(err) })
}

/** 源标识是否为受支持四源之一。 */
export function isSourceName(value) {
  return SOURCES.includes(value)
}
