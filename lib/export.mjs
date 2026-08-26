// SPDX-License-Identifier: Apache-2.0
// lib/export.mjs — DSH 会话事件 → Claude Code 可 resume JSONL（纯函数，零 DSH 依赖）。
//
// 与 convert.mjs 相对：convert.mjs 把外部 transcript（Claude/Codex/OpenCode/Hermes）
// 折成 DSH 会话事件；本模块把 DSH 会话事件反向折叠为 Claude Code 可直接 --resume
// 的 JSONL 行。覆盖 user/assistant/tool 轮次：
//   user/message   → type:user（直连提问字符串，或内联 tool_result 的 user 消息）
//   assistant/message → type:assistant（text→text、reasoning→thinking、tool-call→tool_use）
//   tool/call      → 并入所属 assistant 消息的 tool_use 块（按 callId 去重，仅当
//                    assistant content 未内联时补入）
//   tool/result    → type:user（连续多条合并为一条 tool_result 数组，规范形状）
//   session/title  → type:custom-title（时间线任意位置均可被 Claude 读取）
// 文件引用（cwd）由调用方从会话 header 传入；映射不到时省略 cwd（Claude 打开时
// 回退当前目录）。tool_use 参数经 JSON 解析还原为对象；解析失败保留原文（尽力映射）。

import { randomUUID } from 'node:crypto'

/** Claude Code 可 resume 的 JSONL 版本字符串。 */
export const CLAUDE_JSONL_VERSION = '2.0.0'

/**
 * 把 DSH tool-call 的 arguments（JSON 字符串）还原为 Claude tool_use 的 input 对象。
 * 非字符串原样返回；JSON 字符串解析失败时保留原文（不静默丢参数）。
 * @param argumentsText - DSH tool-call.arguments 字段。
 * @returns input 对象或原值。
 */
function parseToolInput(argumentsText) {
  if (typeof argumentsText !== 'string') return argumentsText ?? {}
  try {
    const parsed = JSON.parse(argumentsText)
    return parsed !== null && typeof parsed === 'object' ? parsed : argumentsText
  } catch {
    // 非 JSON 参数（自由格式字符串）：保留原文，Claude 侧仍可读。
    return argumentsText
  }
}

/**
 * DSH assistant content block → Claude assistant content block。
 * @param block - DSH content block（text/reasoning/tool-call）。
 * @returns Claude block（text/thinking/tool_use）或 null。
 */
function mapAssistantBlock(block) {
  if (!block) return null
  if (block.type === 'text' && typeof block.text === 'string') return { type: 'text', text: block.text }
  if (block.type === 'reasoning' && typeof block.text === 'string') return { type: 'thinking', thinking: block.text }
  if (block.type === 'tool-call') {
    return { type: 'tool_use', id: block.id, name: block.name, input: parseToolInput(block.arguments) }
  }
  return null
}

/** 提取纯文本（content 为字符串或 [{type:'text',text}] 数组）。 */
function extractText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
}

/** DSH tool-result 内容 → Claude tool_result content 数组（仅 text 块）。 */
function mapToolResultContent(content) {
  if (Array.isArray(content)) {
    const blocks = content.map(mapAssistantBlock).filter(Boolean)
    return blocks.length > 0 ? blocks : [{ type: 'text', text: '' }]
  }
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return [{ type: 'text', text: String(content ?? '') }]
}

/**
 * 从 user/message 的 content 里提取 tool_result 块（部分会话把工具结果作为
 * user/message 的 content 内联，而非独立 tool/result 事件）。
 * @param content - user/message 的 content。
 * @returns Claude tool_result 块数组。
 */
function extractInlineToolResults(content) {
  if (!Array.isArray(content)) return []
  const blocks = []
  for (const b of content) {
    if (b && b.type === 'tool-result' && typeof b.toolCallId === 'string') {
      blocks.push({
        type: 'tool_result',
        tool_use_id: b.toolCallId,
        content: mapToolResultContent(b.content),
        is_error: b.isError === true,
      })
    }
  }
  return blocks
}

/** DSH 事件时间（毫秒 epoch）→ ISO 字符串；缺失回退当前时间。 */
function isoTime(ev) {
  return typeof ev?.time === 'number' ? new Date(ev.time).toISOString() : new Date().toISOString()
}

/**
 * 构造一条 Claude JSONL 记录（与 Claude Code 自身 transcript 的信封一致）。
 * @param fields - `{ type, message?, sessionId, cwd?, timestamp }`；`custom-title`
 *   记录用顶层 `customTitle` 字段而非 message。
 * @returns 记录对象。
 */
function makeRecord({ type, message, customTitle, sessionId, cwd, timestamp }) {
  const rec = {
    parentUuid: null,
    isSidechain: false,
    userType: 'user',
    ...(typeof cwd === 'string' && cwd.length > 0 ? { cwd } : {}),
    sessionId,
    version: CLAUDE_JSONL_VERSION,
    gitBranch: null,
    type,
    ...(message !== undefined ? { message } : {}),
    ...(customTitle !== undefined ? { customTitle } : {}),
    uuid: randomUUID(),
    timestamp: timestamp ?? new Date().toISOString(),
  }
  return rec
}

/**
 * 把 DSH 会话事件反向折叠为 Claude Code 可 resume 的 JSONL 记录。
 * 纯函数：不读写文件，输入事件数组，输出记录对象数组与 JSONL 行。
 * @param options - `{ events, sessionId, cwd, model }`；model 为 assistant
 *   消息缺省模型名（事件自带 source.model 时优先）。
 * @returns `{ records, lines, title, counts }`：
 *   counts 为 `{ turns, user, assistant, toolCalls, toolResults }`。
 */
export function eventsToClaudeJsonl({ events, sessionId, cwd, model } = {}) {
  const list = Array.isArray(events) ? events : []
  const records = []
  let title = null

  for (const ev of list) {
    if (ev?.type === 'session/title' && typeof ev.data?.title === 'string' && ev.data.title.trim().length > 0) {
      title = ev.data.title.trim()
    }
  }

  // 标题先行：Claude 在时间线任意位置读到 custom-title 均视为本会话标题。
  if (title) {
    records.push(makeRecord({ type: 'custom-title', customTitle: title, sessionId, cwd }))
  }

  let i = 0
  while (i < list.length) {
    const ev = list[i]
    const type = ev?.type
    const ts = isoTime(ev)

    if (type === 'user/message') {
      const inline = extractInlineToolResults(ev.data?.content)
      if (inline.length > 0) {
        records.push(makeRecord({
          type: 'user', message: { role: 'user', content: inline }, sessionId, cwd, timestamp: ts,
        }))
      } else {
        const text = extractText(ev.data?.content)
        if (text.length > 0) {
          records.push(makeRecord({
            type: 'user', message: { role: 'user', content: text }, sessionId, cwd, timestamp: ts,
          }))
        }
      }
      i++
      continue
    }

    if (type === 'assistant/message') {
      const content = Array.isArray(ev.data?.message?.content) ? ev.data.message.content : []
      const blocks = []
      for (const b of content) {
        const mapped = mapAssistantBlock(b)
        if (mapped) blocks.push(mapped)
      }
      // 紧随其后的 tool/call 事件：仅当 assistant content 未内联同 id tool_use 时
      // 补入（claude-move 导入的会话 content 已内联，这里保证其余会话形状也可导出）。
      let j = i + 1
      while (j < list.length && list[j]?.type === 'tool/call') {
        const tc = list[j]
        const callId = tc.data?.callId
        if (typeof callId === 'string' && !blocks.some((b) => b.type === 'tool_use' && b.id === callId)) {
          blocks.push({
            type: 'tool_use',
            id: callId,
            name: tc.data?.name ?? 'unknown',
            input: parseToolInput(tc.data?.arguments),
          })
        }
        j++
      }
      if (blocks.length > 0) {
        const modelName = ev.data?.message?.source?.model ?? model ?? null
        records.push(makeRecord({
          type: 'assistant',
          message: {
            id: randomUUID(),
            role: 'assistant',
            ...(modelName ? { model: modelName } : {}),
            content: blocks,
          },
          sessionId, cwd, timestamp: ts,
        }))
      }
      i = j
      continue
    }

    if (type === 'tool/result') {
      // 连续 tool/result 合并为一条 user 消息（Claude 规范：一步的工具结果并入一条）。
      const blocks = []
      while (i < list.length && list[i]?.type === 'tool/result') {
        const tr = list[i]
        const block = tr.data?.message?.content?.[0]
        if (block && typeof block.toolCallId === 'string') {
          blocks.push({
            type: 'tool_result',
            tool_use_id: block.toolCallId,
            content: mapToolResultContent(block.content),
            is_error: block.isError === true,
          })
        }
        i++
      }
      if (blocks.length > 0) {
        records.push(makeRecord({
          type: 'user', message: { role: 'user', content: blocks }, sessionId, cwd, timestamp: ts,
        }))
      }
      continue
    }

    i++
  }

  const counts = {
    turns: list.filter((e) => e?.type === 'turn/start').length,
    user: records.filter((r) => r.type === 'user').length,
    assistant: records.filter((r) => r.type === 'assistant').length,
    toolCalls: records.reduce(
      (n, r) => n + (r.type === 'assistant' ? (r.message.content ?? []).filter((b) => b.type === 'tool_use').length : 0),
      0,
    ),
    toolResults: records.reduce(
      (n, r) => n + (r.type === 'user' && Array.isArray(r.message.content)
        ? r.message.content.filter((b) => b.type === 'tool_result').length
        : 0),
      0,
    ),
  }

  return {
    records,
    lines: records.map((r) => JSON.stringify(r)),
    title,
    counts,
  }
}
