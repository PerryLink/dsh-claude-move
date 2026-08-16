// SPDX-License-Identifier: Apache-2.0
// lib/sources/hermes/mapper.mjs — Hermes 源映射器（四合一迁移向导，纯函数）。
//
// 清单 → 迁移计划：
//   - skills → copy（兼容：name+description 齐备，内容直拷，只改落点目录名）或
//     convert-copy（不兼容：合成 frontmatter 后写入 SKILL.md）。
//   - memories（MEMORY.md / USER.md，§ 分隔条目）→ append-section（DSH 全局
//     AGENTS.md 管理段，每文件一个独立段，内容原样迁移）。

import { readFileSync } from 'node:fs'
import { assertAllowedRead, planKey } from '../contract.mjs'
import { defaultAgentsMdPath } from '../../agmd-section.mjs'
import { skillTargetPath, kebabName } from '../../skill-migrate.mjs'
import { whitelist } from './parser.mjs'

/**
 * 映射 Hermes 检测清单为迁移计划。
 * @param source - 'hermes'。
 * @param detection - hermes/parser.mjs 的 detect() 输出。
 * @param opts - `{ skillsDir, agentsMdPath }`；agentsMdPath 缺省 defaultAgentsMdPath()。
 * @returns `{ plans, errors }`。
 */
export function mapSource(source, detection, opts = {}) {
  const plans = []
  const errors = []
  const agentsMdPath = opts.agentsMdPath ?? defaultAgentsMdPath()
  const skillsDir = opts.skillsDir
  const roots = whitelist(detection.home)

  for (const skill of detection.skills ?? []) {
    plans.push({
      key: planKey(source, 'skill', skill.id),
      from: source,
      kind: 'skill',
      action: skill.compatible ? 'copy' : 'convert-copy',
      source: { file: skill.file, dir: skill.dir, name: skill.name },
      target: { path: skillTargetPath(skillsDir, kebabName(skill.name)) },
      digest: skill.digest,
    })
  }

  for (const memory of detection.memories ?? []) {
    try {
      const content = readFileSync(assertAllowedRead(roots, memory.file), 'utf8')
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

  return { plans, errors }
}
