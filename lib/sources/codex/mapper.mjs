// SPDX-License-Identifier: Apache-2.0
// lib/sources/codex/mapper.mjs — Codex CLI 源映射器（四合一迁移向导，零 DSH 依赖）。
//
// 清单 → 迁移计划：
//   - sessions → import-session（会话转换与落盘复用一期 convertCodexJsonl /
//     persistConverted，provider 'codex'；幂等走一期 imports，无 digest）。
//   - skills → copy（兼容）/ convert-copy（缺 name/description 补合成 frontmatter）。
//   - memories（memories/*.md）与 instructions（AGENTS.md/CODEX.md）→ append-section
//     （DSH 全局 AGENTS.md 管理段，每条一个独立段 key）。
//   - commands（hooks/*/command.md）→ 纯提示词 register-command、含 shell unsupported。
//   - hooks（hooks/*/prompt.md、config.toml [commands]）→ unsupported 清单。
// 正文（memories/instructions/commands）在本模块读一次；所有读取经 assertAllowedRead
// 守卫（复用 parser 的白名单），越界/缺文件跳过并记 errors，绝不越界读隐私文件。

import { readFile } from 'node:fs/promises'
import { assertAllowedRead, planKey } from '../contract.mjs'
import { skillTargetPath, kebabName } from '../../skill-migrate.mjs'
import { commandPlan, hookUnsupportedPlan } from '../../commands-migrate.mjs'
import { defaultAgentsMdPath } from '../../agmd-section.mjs'
import { whitelist } from './parser.mjs'

/** 钩子 → 不支持清单的固定文案。 */
const CODEX_HOOK_REASON = 'Codex 钩子（matched-tool/shell）在 DSH 无插件级等价 seam，未自动迁移'

/**
 * 映射 Codex 检测清单为迁移计划。
 * @param source - 'codex'。
 * @param detection - codex/parser.mjs 的 detect() 输出。
 * @param opts - `{ skillsDir, agentsMdPath }`；agentsMdPath 缺省 defaultAgentsMdPath()。
 * @returns `{ plans }`；读取失败时附 `{ errors }`（plans 数组仍返回）。
 */
export async function mapSource(source, detection, opts = {}) {
  const plans = []
  const errors = []
  const agentsMdPath = opts.agentsMdPath ?? defaultAgentsMdPath()
  const skillsDir = opts.skillsDir
  const roots = whitelist(detection.home)

  const read = async (file, scope) => {
    try {
      return await readFile(assertAllowedRead(roots, file), 'utf8')
    } catch (err) {
      errors.push(`${scope}:${String((err && err.message) || err)}`)
      return null
    }
  }

  for (const session of detection.sessions ?? []) {
    plans.push({
      key: planKey(source, 'session', session.file),
      from: source,
      kind: 'session',
      action: 'import-session',
      source: { file: session.file, title: session.title, cwd: session.cwd, importKey: session.file, turns: session.turns },
      target: {},
      provider: 'codex',
      title: session.title,
    })
  }

  for (const skill of detection.skills ?? []) {
    plans.push({
      key: planKey(source, 'skill', skill.id),
      from: source,
      kind: 'skill',
      action: skill.compatible ? 'copy' : 'convert-copy',
      source: { file: skill.file, dir: skill.dir, name: skill.name },
      target: skillsDir ? { path: skillTargetPath(skillsDir, kebabName(skill.name)) } : {},
      digest: skill.digest,
    })
  }

  for (const memory of detection.memories ?? []) {
    const content = await read(memory.file, 'memory:' + memory.file)
    if (content === null) continue
    plans.push({
      key: planKey(source, 'memory', memory.id),
      from: source,
      kind: 'memory',
      action: 'append-section',
      source: { file: memory.file },
      target: { path: agentsMdPath },
      content,
      digest: memory.digest,
    })
  }

  for (const instruction of detection.instructions ?? []) {
    const content = await read(instruction.file, 'instruction:' + instruction.file)
    if (content === null) continue
    plans.push({
      key: planKey(source, 'instruction', instruction.id),
      from: source,
      kind: 'instruction',
      action: 'append-section',
      source: { file: instruction.file },
      target: { path: agentsMdPath },
      content,
      digest: instruction.digest,
    })
  }

  for (const command of detection.commands ?? []) {
    const content = await read(command.file, 'command:' + command.file)
    if (content === null) continue
    plans.push(commandPlan(source, 'command', command.id, {
      file: command.file,
      name: command.name,
      promptOnly: command.promptOnly,
      prompt: content,
      digest: command.digest,
    }))
  }

  for (const hook of detection.hooks ?? []) {
    plans.push(hookUnsupportedPlan(source, hook.id, hook.file, CODEX_HOOK_REASON))
  }

  return { plans, ...(errors.length > 0 ? { errors } : {}) }
}
