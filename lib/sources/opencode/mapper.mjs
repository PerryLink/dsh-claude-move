// SPDX-License-Identifier: Apache-2.0
// lib/sources/opencode/mapper.mjs — OpenCode 源映射器（四合一迁移向导，纯函数）。
//
// 清单 → 迁移计划：
//   - sessions → import-session（provider 'opencode'；转换在 index.mjs 执行期经
//     loadDbSessionRows / loadLegacySessionRows + convertOpencodeRows 完成；
//     幂等走一期 imports.json，无 digest）。
//   - agents（<configHome>/agent/*.md）→ convert-copy：转换为 DSH 技能
//     （合成 name/description frontmatter；正文原样）。
//   - commands（<configHome>/command/*.md）→ 纯提示词 → register-command；
//     含 shell（```! 围栏/shebang）→ unsupported。
//   - instructions（全局 AGENTS.md）→ append-section（项目级 AGENTS.md DSH
//     原生读取，不迁移）。

import { readFile } from 'node:fs/promises'
import { planKey } from '../contract.mjs'
import { defaultAgentsMdPath } from '../../agmd-section.mjs'
import { skillTargetPath, kebabName } from '../../skill-migrate.mjs'
import { commandPlan } from '../../commands-migrate.mjs'

/**
 * 映射 OpenCode 检测清单为迁移计划。
 * @param source - 'opencode'。
 * @param detection - opencode/parser.mjs 的 detect() 输出。
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
      key: planKey(source, 'session', `${session.format}:${session.sessionId ?? session.id}`),
      from: source,
      kind: 'session',
      action: 'import-session',
      source: {
        file: session.file,
        sessionId: session.sessionId ?? session.id,
        storage: session.storage,
        dataHome: detection.home,
        title: session.title,
        cwd: session.cwd,
        format: session.format,
        importKey: `${session.storage}:${session.sessionId ?? session.id}`,
        turns: session.turns,
      },
      target: {},
      provider: 'opencode',
      title: session.title,
    })
  }

  for (const skill of detection.skills ?? []) {
    plans.push({
      key: planKey(source, 'skill', skill.id),
      from: source,
      kind: 'skill',
      action: 'convert-copy',
      source: { file: skill.file, dir: skill.dir, name: skill.name },
      target: skillsDir ? { path: skillTargetPath(skillsDir, kebabName(skill.name)) } : {},
      digest: skill.digest,
    })
  }

  for (const command of detection.commands ?? []) {
    try {
      const content = await readFile(command.file, 'utf8')
      plans.push(commandPlan(source, 'command', command.id, {
        file: command.file,
        name: command.name,
        promptOnly: command.promptOnly,
        prompt: content,
        digest: command.digest,
      }))
    } catch (err) {
      errors.push(`command:${command.file}: ${String((err && err.message) || err)}`)
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
  return { plans, ...(errors.length > 0 ? { errors } : {}) }
}
