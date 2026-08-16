// SPDX-License-Identifier: Apache-2.0
// lib/sources/opencode/convert.mjs — OpenCode 会话 → DSH 会话事件（零 DSH 依赖）。
//
// OpenCode message/part 行 → 统一回合中间结构 → synthesizeSession（与
// Claude/Codex 共用事件纪律：turn/step 配对、tool/call 恰好一条结果、seq 连续）。
// 兼容两条存储路径：opencode.db（node:sqlite 只读）与旧版 storage JSON 文件。
//
// 映射（据 OpenCode message-v2 契约，2026 实测）：
//   - 用户 message（text parts，跳过 synthetic/ignored）→ 新回合提问；
//   - assistant message → 一个或多个 step：step-start 开新步，text → text 块，
//     reasoning → reasoning 块（明文，保留为日志内容、不进摘要），
//     tool part（state.status=completed → 调用+结果；error → isError 结果；
//     pending/running → 仅声明调用，合成错误结果兜底）；
//   - 标题：session.title 或首条提问截断。

import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readFile, readdir } from 'node:fs/promises'
import { synthesizeSession, appendTitleEvent, mintSessionId, SESSION_FORMAT_VERSION } from '../../convert.mjs'
import { truncateText } from '../contract.mjs'

/**
 * 从数据库读取一个会话的全部 message/part 行（按 (time_created,id) 排序）。
 * @param dbPath - opencode.db 绝对路径。
 * @param sessionId - session.id。
 * @returns `{ session, messages }`；messages = [{ id, data, parts: [...] }]。
 */
export function loadDbSessionRows(dbPath, sessionId) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const session = db.prepare(
      'SELECT id, title, directory, time_created FROM session WHERE id = ?',
    ).get(sessionId)
    if (!session) return null
    const rows = db.prepare(
      'SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created ASC, id ASC',
    ).all(sessionId)
    const partStmt = db.prepare(
      'SELECT message_id, data FROM part WHERE session_id = ? ORDER BY time_created ASC, id ASC',
    )
    const partsByMessage = new Map()
    for (const row of partStmt.all(sessionId)) {
      if (!partsByMessage.has(row.message_id)) partsByMessage.set(row.message_id, [])
      partsByMessage.get(row.message_id).push(row.data)
    }
    return {
      session,
      messages: rows.map((row) => ({
        id: row.id,
        data: safeJson(row.data),
        parts: (partsByMessage.get(row.id) ?? []).map(safeJson).filter(Boolean),
      })),
    }
  } finally {
    try { db.close() } catch { /* 关闭失败无碍 */ }
  }
}

/** 旧版 JSON 布局读取：session 元数据 + message/part 文件。 */
export async function loadLegacySessionRows(dataHome, sessionId) {
  const sessionFile = path.join(dataHome, 'storage', 'session', 'global', `${sessionId}.json`)
  const messageDir = path.join(dataHome, 'storage', 'message', sessionId)
  let session
  try {
    session = JSON.parse(await readFile(sessionFile, 'utf8'))
  } catch {
    return null
  }
  const rows = []
  let names = []
  try {
    names = (await readdir(messageDir)).filter((n) => n.startsWith('msg_') && n.endsWith('.json')).sort()
  } catch {
    names = []
  }
  for (const name of names) {
    try {
      const msg = JSON.parse(await readFile(path.join(messageDir, name), 'utf8'))
      const parts = []
      const partDir = path.join(dataHome, 'storage', 'part', msg.id ?? name.replace(/\.json$/, ''))
      let partNames = []
      try {
        partNames = (await readdir(partDir)).filter((n) => n.startsWith('prt_') && n.endsWith('.json')).sort()
      } catch {
        partNames = []
      }
      for (const pn of partNames) {
        try {
          parts.push(JSON.parse(await readFile(path.join(partDir, pn), 'utf8')))
        } catch {
          // 畸形 part 文件：跳过（转换期容忍）。
        }
      }
      rows.push({ id: msg.id, data: { role: msg.role ?? 'assistant', modelID: msg.modelID, providerID: msg.providerID }, parts })
    } catch {
      // 畸形 message 文件：跳过。
    }
  }
  return { session, messages: rows }
}

function safeJson(text) {
  try {
    const parsed = JSON.parse(String(text ?? ''))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** 文本块是否可作提问内容（排除 synthetic/ignored 与空文本）。 */
function usableText(part) {
  return part
    && part.type === 'text'
    && typeof part.text === 'string'
    && part.synthetic !== true
    && part.ignored !== true
    && part.text.trim().length > 0
}

/**
 * 把 message/part 行合成为平衡的 DSH 会话事件日志。
 * @param loaded - loadDbSessionRows / loadLegacySessionRows 的输出。
 * @param args - `{ sessionId? }`（目标 id 覆盖）。
 * @returns convertXxxJsonl 同构输出 `{ meta, events, turns, title, messages, toolCalls, skipped, skippedLines, typeCounts, repaired, sourceId }`。
 */
export function convertOpencodeRows(loaded, args = {}) {
  if (!loaded) {
    return {
      meta: { version: SESSION_FORMAT_VERSION, id: args.sessionId ?? 'import-opencode', createdAt: Date.now() },
      events: [], turns: [], title: null, messages: 0, toolCalls: 0,
      skipped: 0, skippedLines: [], typeCounts: {}, repaired: { synthesized: 0, duplicateResults: 0, orphanResults: 0 }, sourceId: null,
    }
  }
  const { session, messages } = loaded
  const sourceId = session?.id ?? null
  const createdAt = typeof session?.time_created === 'number' && session.time_created > 0
    ? session.time_created
    : undefined
  const title = session?.title ? truncateText(session.title, 120) : null

  const turns = []
  let cur = null
  let model = null
  let firstPrompt = null

  const openTurn = (prompt) => {
    cur = { prompt, steps: [] }
    turns.push(cur)
  }
  const openStep = () => {
    const step = { content: [], toolCalls: [], toolResults: [] }
    cur.steps.push(step)
    return step
  }

  for (const row of messages) {
    const data = row.data ?? {}
    const role = data.role
    const parts = row.parts ?? []
    if (role === 'user') {
      const prompt = parts.filter(usableText).map((p) => p.text).join('\n').trim()
      if (prompt) {
        if (firstPrompt === null) firstPrompt = prompt
        openTurn(prompt)
      }
      continue
    }
    if (role !== 'assistant' || !cur) continue
    if (typeof data.modelID === 'string' && !model) model = data.modelID

    let step = null
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue
      if (part.type === 'step-start') {
        step = openStep()
        continue
      }
      if (part.type === 'step-finish') {
        step = null
        continue
      }
      if (!step) step = openStep()
      if (part.type === 'text' && typeof part.text === 'string') {
        step.content.push({ type: 'text', text: part.text })
      } else if (part.type === 'reasoning' && typeof part.text === 'string') {
        step.content.push({ type: 'reasoning', text: part.text })
      } else if (part.type === 'tool') {
        const state = part.state ?? {}
        const callId = String(part.callID ?? `opencode-${part.id ?? 'call'}`)
        step.toolCalls.push({
          id: callId,
          name: part.tool ?? 'unknown',
          arguments: typeof state.input === 'string' ? state.input : JSON.stringify(state.input ?? {}),
        })
        if (state.status === 'completed') {
          step.toolResults.push({
            toolCallId: callId,
            content: [{ type: 'text', text: typeof state.output === 'string' ? state.output : JSON.stringify(state.output ?? '') }],
            isError: false,
          })
        } else if (state.status === 'error') {
          step.toolResults.push({
            toolCallId: callId,
            content: [{ type: 'text', text: typeof state.error === 'string' ? state.error : JSON.stringify(state.error ?? '') }],
            isError: true,
          })
        }
        // pending/running：仅声明调用 → synthesizeTurnEvents 补合成错误结果。
      }
      // step 之后不再回到 null：同一 assistant message 内未标 step-start 的内容
      // 归入当前步（上游会反复 step-start/step-finish，容错起见保持单调）。
    }
  }

  const meta = {
    version: SESSION_FORMAT_VERSION,
    id: args.sessionId ?? mintSessionId(sourceId ?? 'opencode'),
    createdAt: createdAt ?? Date.now(),
  }
  if (session?.directory) meta.cwd = session.directory

  const synthesized = synthesizeSession({
    meta,
    turns,
    title: null, // 标题统一由 appendTitleEvent 追加一次（避免重复标题事件）
    provider: 'opencode',
    model,
    skipped: 0,
    records: messages.length,
    skippedLines: [],
    typeCounts: {},
  })
  appendTitleEvent(synthesized, title ?? truncateText(firstPrompt ?? '', 120))
  return { ...synthesized, sourceId }
}
