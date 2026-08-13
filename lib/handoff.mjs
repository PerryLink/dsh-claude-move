// lib/handoff.mjs — 续聊交接摘要（F17，零 DSH 依赖）。
//
// 安全模型沿用 Demogorgon314/dsh-resume-plugin（MIT，见 THIRD_PARTY_NOTICES.md）：
// 外部 transcript 是不可信惰性历史——摘要只转述目标、涉及文件与停止点；
// system/developer 记录不参与（convert 已忽略），reasoning/thinking 内容不进入
// 摘要；旧工具输出视为过期证据，继续前必须复核仓库现状。摘要按字符数截断。

/** 默认交接摘要字符上限（F17 可配）。 */
export const DEFAULT_HANDOFF_MAX_CHARS = 2048

/** 已知 Claude 记录类型：未知类型计入摘要警告（宽容跳过不失败）。 */
export const KNOWN_CLAUDE_TYPES = new Set([
  'user', 'assistant', 'system', 'summary', 'custom-title', 'ai-title',
  'content-replacement', 'progress', 'file-history-snapshot', 'file-history-delta',
  'attribution-snapshot', 'queue-operation', 'last-prompt', 'tag', 'agent-name',
  'agent-color', 'agent-setting', 'mode', 'worktree-state',
  'context-collapse-commit', 'context-collapse-snapshot',
  'permission', 'permission-mode', 'attachment',
])

/** 可能携带文件/命令引用的工具名（只取参数做参考，不执行任何内容）。 */
const FILE_TOOLS = new Set([
  'Read', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Glob', 'Grep',
  'Bash', 'LS', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite',
])

/**
 * 单行归一 + 截断（截断后再去尾空格）。
 * @param text - 原始文本。
 * @param limit - 码点上限。
 * @returns 归一化文本。
 */
export function oneLine(text, limit) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, limit).trim()
}

/**
 * 提取一步的纯文本（跳过 reasoning/tool-call 块）。
 * @param step - convert 输出的 step。
 * @returns 文本。
 */
export function textOfStep(step) {
  return (step.content ?? [])
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

/**
 * 从工具调用参数中提取文件/命令引用（只读字符串，不执行）。
 * @param toolCall - convert 输出的 toolCall。
 * @returns 引用字符串或 null。
 */
export function fileArgOf(toolCall) {
  if (!toolCall || !FILE_TOOLS.has(toolCall.name)) return null
  let args = {}
  try {
    args = JSON.parse(toolCall.arguments ?? '{}')
  } catch {
    return null
  }
  if (args === null || typeof args !== 'object') return null
  const candidate = args.file_path ?? args.path ?? args.pattern ?? args.command ?? args.query
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length < 300 ? candidate : null
}

/**
 * 生成交接摘要（F17）：目标、最后请求、涉及文件、规模、停止点、警告。
 * @param converted - convertClaudeJsonl 输出。
 * @param options - `{ maxChars, title }`。
 * @returns 摘要文本。
 */
export function buildHandoff(converted, { maxChars = DEFAULT_HANDOFF_MAX_CHARS, title = '' } = {}) {
  const turns = converted.turns ?? []
  const lines = []
  lines.push('# Claude Code 会话交接（静态历史，仅参考）')
  if (title) lines.push(`源会话：${oneLine(title, 200)}`)

  const goals = turns.slice(0, 3).map((t) => oneLine(t.prompt, 200)).filter(Boolean)
  if (goals.length > 0) lines.push('早期目标：' + goals.join(' | '))

  const lastTurn = turns.at(-1)
  if (lastTurn) lines.push('最后用户请求：' + oneLine(lastTurn.prompt, 400))

  const refs = new Set()
  for (const turn of turns.slice(-8)) {
    for (const step of turn.steps ?? []) {
      for (const toolCall of step.toolCalls ?? []) {
        const arg = fileArgOf(toolCall)
        if (arg) refs.add(arg)
      }
    }
  }
  if (refs.size > 0) {
    lines.push('最近涉及的文件/命令：\n- ' + [...refs].slice(0, 10).join('\n- '))
  }

  lines.push(`规模：${turns.length} 轮、${converted.messages ?? 0} 条消息、${converted.toolCalls ?? 0} 次工具调用`)

  const lastText = turns.flatMap((t) => t.steps ?? []).map(textOfStep).filter(Boolean).at(-1)
  if (lastText) lines.push('最后助手输出（截断）：' + oneLine(lastText, 600))

  const warnings = []
  if ((converted.skipped ?? 0) > 0) warnings.push(`${converted.skipped} 行畸形记录被跳过`)
  const unknown = Object.entries(converted.typeCounts ?? {})
    .filter(([type]) => !KNOWN_CLAUDE_TYPES.has(type))
  if (unknown.length > 0) {
    warnings.push('未知记录类型：' + unknown.map(([type, n]) => `${type}×${n}`).join('、'))
  }
  if (warnings.length > 0) lines.push('警告：' + warnings.join('；'))

  lines.push('以上是静态历史。继续前请复核当前仓库状态（分支/diff/关键文件），旧工具输出视为过期证据。')

  const full = lines.join('\n')
  return full.length <= maxChars ? full : full.slice(0, maxChars - 1) + '…'
}
