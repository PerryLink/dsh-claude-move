// SPDX-License-Identifier: Apache-2.0
// lib/commands-migrate.mjs — 四源钩子/命令 → DSH 命令/不支持清单（零 DSH 依赖）。
//
// 映射规则：
//   - 纯提示词命令（无 shell/脚本执行）→ DSH 命令：迁移后把提示词注入当前会话
//     （与一期 /resume-claude 的注入机制一致），绝不自动执行任何脚本。
//   - 含 shell 的命令、事件/权限钩子 → 明确「不支持」清单：报告列出原因与建议，
//     绝不静默丢弃，也绝不把未审查脚本注册成可执行命令。
//   - DSH 事件面（tools/post-execute 等）不能由插件给宿主补挂钩子，因此
//     Codex hooks / Claude settings.json hooks 一律进不支持清单并附建议。

import { kebabName } from './skill-migrate.mjs'

/** 命令名 → DSH 命令名（kebab-case）。 */
export function toDshCommandName(raw) {
  return kebabName(raw, 'migrated-command')
}

/**
 * 分类一个命令/钩子文件：
 * @param content - 文件原文。
 * @param name - 命令名。
 * @returns `{ promptOnly, prompt, hasShell }`。
 *   OpenCode 命令的 ` ```!...``` ` 围栏 = 终端命令；Codex command.md 含 shebang
 *   或 `#!/` 行视为 shell；其余视为纯提示词。
 */
export function classifyCommand(content, name = 'command') {
  const text = String(content ?? '')
  const hasShell = /```![^\n]*[\s\S]*?```/.test(text) || /^\s*#![^\n]*\n/.test(text)
  return {
    promptOnly: !hasShell,
    prompt: text.trim(),
    hasShell,
    name: toDshCommandName(name),
  }
}

/**
 * 生成命令迁移计划（纯提示词 → register-command；含 shell → unsupported）。
 * @param source - 源标识。
 * @param kind - 'command'。
 * @param id - 命令 id（文件路径或名称）。
 * @param entry - classifyCommand 结果 + 源文件。
 * @returns 迁移计划对象。
 */
export function commandPlan(source, kind, id, entry) {
  const base = {
    source: { file: entry.file, name: entry.name },
    digest: entry.digest,
  }
  if (entry.promptOnly) {
    return {
      key: `${source}:${kind}:${id}`,
      from: source,
      kind,
      action: 'register-command',
      target: { commandName: entry.name },
      content: entry.prompt,
      ...base,
    }
  }
  return {
    key: `${source}:${kind}:${id}`,
    from: source,
    kind,
    action: 'unsupported',
    target: { commandName: entry.name },
    content: entry.prompt,
    reason: '命令含 shell 脚本：迁移器不注册可执行命令（安全边界），请人工审查后在 DSH 中重建',
    ...base,
  }
}

/** 钩子 → 不支持清单条目的统一文案（附 DSH 对应面建议）。 */
export function hookUnsupportedPlan(source, id, file, reason) {
  return {
    key: `${source}:hook:${id}`,
    from: source,
    kind: 'hook',
    action: 'unsupported',
    source: { file },
    reason: reason
      ?? '事件/权限钩子在 DSH 无插件级等价 seam（宿主 tools/post-execute 瀑布需 composition 级接入），未自动迁移',
  }
}
