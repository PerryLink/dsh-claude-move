// SPDX-License-Identifier: Apache-2.0
// lib/sources/claude/mapper.mjs — Claude Code 源映射器（四合一迁移向导，纯函数）。
//
// 清单 → 迁移计划：
//   - sessions → import-session（会话转换与落盘复用一期 convertClaudeJsonl /
//     persistConverted，provider 'claude-code'；幂等走一期 imports.json，无 digest）。
//   - skills（一期已过滤为含 name+description）→ copy（目录束整目录复制，扁平
//     .md 写入 SKILL.md）。
//   - memories（projects/*/memory/*.md）→ append-section（DSH 全局 AGENTS.md 管理段，
//     每条一个段；一期 F11 的实时注入同时保留，两者互补：AGENTS.md 落盘可审计，
//     实时注入按请求刷新）。
//   - instructions（全局 CLAUDE.md）→ append-section。
//   - hooks（settings.json）→ unsupported 清单。

import { readFile } from 'node:fs/promises'
import { planKey } from '../contract.mjs'
import { defaultAgentsMdPath } from '../../agmd-section.mjs'
import { skillTargetPath, kebabName } from '../../skill-migrate.mjs'
import { hookUnsupportedPlan } from '../../commands-migrate.mjs'

/**
 * 映射 Claude 检测清单为迁移计划。
 * @param source - 'claude'。
 * @param detection - claude/parser.mjs 的 detect() 输出。
 * @param opts - `{ skillsDir, agentsMdPath }`。
 * @returns `{ plans, errors }`。
 */
export async function mapSource(source, detection, opts = {}) {
  const plans = []
  const errors = []
  const agentsMdPath = opts.agentsMdPath ?? defaultAgentsMdPath()
  const skillsDir = opts.skillsDir

  for (const session of detection.sessions ?? []) {
    plans.push({
      key: planKey(source, 'session', session.file),
      from: source,
      kind: 'session',
      action: 'import-session',
      source: { file: session.file, title: session.title, cwd: session.cwd, importKey: session.file, turns: session.turns },
      target: {},
      provider: 'claude-code',
      title: session.title,
    })
  }

  for (const skill of detection.skills ?? []) {
    plans.push({
      key: planKey(source, 'skill', skill.id),
      from: source,
      kind: 'skill',
      action: 'copy',
      source: { file: skill.file, dir: skill.dir, name: skill.name, ...(skill.flat ? { flat: true } : {}) },
      target: skillsDir ? { path: skillTargetPath(skillsDir, kebabName(skill.name)) } : {},
      digest: skill.digest,
    })
  }

  for (const memory of detection.memories ?? []) {
    try {
      const content = await readFile(memory.file, 'utf8')
      plans.push({
        key: planKey(source, 'memory', memory.id),
        from: source,
        kind: 'memory',
        action: 'append-section',
        source: { file: memory.file, kind: memory.kind },
        target: { path: agentsMdPath },
        content,
        digest: memory.digest,
      })
    } catch (err) {
      errors.push(`memory:${memory.file}: ${String((err && err.message) || err)}`)
    }
  }

  for (const instruction of detection.instructions ?? []) {
    try {
      const content = await readFile(instruction.file, 'utf8')
      plans.push({
        key: planKey(source, 'instruction', instruction.id),
        from: source,
        kind: 'instruction',
        action: 'append-section',
        source: { file: instruction.file, kind: instruction.kind },
        target: { path: agentsMdPath },
        content,
        digest: instruction.digest,
      })
    } catch (err) {
      errors.push(`instruction:${instruction.file}: ${String((err && err.message) || err)}`)
    }
  }

  for (const hook of detection.hooks ?? []) {
    plans.push(hookUnsupportedPlan(
      source, hook.id, hook.file,
      'Claude Code settings.json 钩子（PreToolUse 等）在 DSH 无插件级等价 seam（宿主 tools/post-execute 瀑布需 composition 级接入），未自动迁移',
    ))
  }
  return { plans, ...(errors.length > 0 ? { errors } : {}) }
}
