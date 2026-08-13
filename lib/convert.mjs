// SPDX-License-Identifier: Apache-2.0 AND MIT
// convert.mjs — 外部聊天记录 → DSH 会话事件（纯函数，无宿主依赖）
//
// Vendored from Nwflower/dsh-chat-import (MIT, see THIRD_PARTY_NOTICES.md) and
// extended in place. Upstream split it from the plugin entry so the mapping
// core stays independently testable: no DSH imports in this module.
//
// 与 index.mjs 分离是为了可独立单元测试：本模块不 import 任何 DSH 包。
// 每个源格式一个 `convertXxxJsonl(raw, args)`：把原始 JSONL 文本解析成统一
// 的回合中间结构，再交给共享的 synthesizeSession 合成 DSH 事件日志，
// 保证所有源（Claude Code / Codex-ChatGPT）事件纪律一致。

export const SESSION_FORMAT_VERSION = 0

/** 畸形行明细上报上限（完整计数不受限）。 */
export const MALFORMED_REPORT_CAP = 200

export function parseTime(iso) {
  if (typeof iso === 'string') {
    const n = Date.parse(iso)
    if (Number.isFinite(n)) return n
  }
  return Date.now()
}

// 把源 sessionId 折成合法的 DSH SessionId 片段。
export function mintSessionId(sourceId) {
  const slug = String(sourceId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64)
  return 'import-' + (slug || String(Date.now()))
}

// Claude content block → DSH content block。文本→text、思考→reasoning、工具调用→tool-call。
export function mapContentBlock(block) {
  if (!block) return null
  if (block.type === 'text' && typeof block.text === 'string') return { type: 'text', text: block.text }
  if (block.type === 'thinking' && typeof block.thinking === 'string') return { type: 'reasoning', text: block.thinking }
  if (block.type === 'tool_use') {
    return { type: 'tool-call', id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) }
  }
  return null
}

// 把「回合中间结构」合成平衡的 DSH 事件日志（seq 从 0 连续；surface 事件带
// surfaceOp:'append'；tool/result 用 sourceEventSeqs 关联其 tool/call）。
// turns: [{ prompt, steps: [{ content, toolCalls, toolResults }] }]
function synthesizeSession({ meta, turns, title, provider, model, skipped, records, skippedLines, typeCounts }) {
  const events = []
  let seq = 0
  let turn = 0
  const push = (type, data, surface, sourceEventSeqs) => {
    const ev = { type, seq: seq++, time: meta.createdAt, data }
    if (surface) ev.surfaceOp = 'append'
    if (sourceEventSeqs) ev.sourceEventSeqs = sourceEventSeqs
    events.push(ev)
    return ev
  }

  const mname = model || provider

  for (const t of turns) {
    turn += 1
    push('turn/start', { turn })
    if (t.steps.length === 0) {
      // 只有提问、没有回复的轮次
      push('user/message', {
        id: 'import:' + meta.id + ':u' + turn,
        role: 'user',
        content: [{ type: 'text', text: t.prompt }],
        source: { kind: 'user' },
      }, true)
    } else {
      for (let i = 0; i < t.steps.length; i++) {
        const stepNum = i + 1
        const step = t.steps[i]
        push('step/start', { turn, step: stepNum })
        if (i === 0) {
          push('user/message', {
            id: 'import:' + meta.id + ':u' + turn,
            role: 'user',
            content: [{ type: 'text', text: t.prompt }],
            source: { kind: 'user' },
          }, true)
        }
        push('assistant/message', {
          turn,
          step: stepNum,
          message: {
            id: 'import:' + meta.id + ':a' + turn + ':' + stepNum,
            role: 'assistant',
            content: step.content,
            source: { kind: 'model', provider, model: mname },
          },
        }, true)
        const callSeqByCallId = {}
        for (const tc of step.toolCalls) {
          const ev = push('tool/call', {
            turn,
            step: stepNum,
            callId: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })
          callSeqByCallId[tc.id] = ev.seq
        }
        for (const tr of step.toolResults) {
          const callSeq = callSeqByCallId[tr.toolCallId]
          push('tool/result', {
            turn,
            step: stepNum,
            message: {
              id: 'import:' + meta.id + ':t' + turn + ':' + stepNum + ':' + tr.toolCallId,
              role: 'user',
              content: [{
                type: 'tool-result',
                toolCallId: tr.toolCallId,
                content: tr.content,
                ...(tr.isError ? { isError: true } : {}),
              }],
              source: { kind: 'tool', callId: tr.toolCallId },
            },
          }, true, callSeq !== undefined ? [callSeq] : undefined)
        }
        push('step/end', { turn, step: stepNum })
      }
    }
    push('turn/end', { turn, reason: { kind: 'completed' } })
  }

  // 标题：custom-title / ai-title → session/title 事件（钉住，避免自动回退标题覆盖）。
  const normalizedTitle = (title || '').trim()
  if (normalizedTitle.length > 0) {
    push('session/title', { title: normalizedTitle, messageSeqs: [], source: { kind: 'user' } })
  }

  return {
    meta,
    events,
    turns,
    title,
    messages: events.filter((e) => e.type === 'user/message' || e.type === 'assistant/message' || e.type === 'tool/result').length,
    toolCalls: events.filter((e) => e.type === 'tool/call').length,
    skipped,
    records,
    ...(skippedLines !== undefined ? { skippedLines } : {}),
    ...(typeCounts !== undefined ? { typeCounts } : {}),
  }
}

// 逐行解析 JSONL：直连人类提问（type==='user' 且 content 为字符串）开新轮；每条
// assistant 消息 = 一步；其后的 tool_result 挂到最近一步。
//
// 扩展（相对上游）：畸形行带行号明细（F10）、标题 custom-title > ai-title、
// 按记录类型计数（S5 权限类统计、未知类型统计）。
export function convertClaudeJsonl(raw, args = {}) {
  const recs = []
  let skipped = 0
  const skippedLines = []
  const typeCounts = {}
  let lineNo = 0
  for (const line of raw.split('\n')) {
    lineNo++
    const t = line.trim()
    if (!t) continue
    try {
      const rec = JSON.parse(t)
      if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
        throw new SyntaxError('record is not a JSON object')
      }
      recs.push(rec)
    } catch (err) {
      skipped++
      if (skippedLines.length < MALFORMED_REPORT_CAP) {
        skippedLines.push({ line: lineNo, error: String((err && err.message) || err) })
      }
    }
  }

  let sourceId = null
  let aiTitle = null
  let customTitle = null
  let cwd = null
  let createdAt = null
  let model = null

  const turns = []
  let cur = null
  let lastStep = null

  for (const rec of recs) {
    const recType = typeof rec.type === 'string' ? rec.type : 'unknown'
    typeCounts[recType] = (typeCounts[recType] ?? 0) + 1

    if (typeof rec.sessionId === 'string' && !sourceId) sourceId = rec.sessionId
    if (typeof rec.cwd === 'string' && !cwd) cwd = rec.cwd
    if (typeof rec.timestamp === 'string' && createdAt === null) createdAt = parseTime(rec.timestamp)
    if (rec.type === 'custom-title' && typeof rec.customTitle === 'string' && customTitle === null) {
      customTitle = rec.customTitle
    } else if (rec.type === 'ai-title' && typeof rec.aiTitle === 'string' && aiTitle === null) {
      aiTitle = rec.aiTitle
    }
    const recModel = rec.message?.model ?? rec.model
    if (typeof recModel === 'string' && !model) model = recModel

    if (rec && rec.type === 'user' && rec.message && typeof rec.message.content === 'string') {
      // 直连人类提问 → 新轮
      cur = { prompt: rec.message.content, steps: [] }
      turns.push(cur)
      lastStep = null
    } else if (rec && rec.type === 'assistant' && cur) {
      // 一条 assistant 消息 = 一步
      const step = { content: [], toolCalls: [], toolResults: [] }
      if (Array.isArray(rec.message?.content)) {
        for (const block of rec.message.content) {
          const mapped = mapContentBlock(block)
          if (!mapped) continue
          if (mapped.type === 'tool-call') {
            step.content.push(mapped)   // 助手内容里的 tool-call block
            step.toolCalls.push(mapped) // 同时作为 tool/call 事件
          } else {
            step.content.push(mapped)   // text / reasoning block
          }
        }
      } else if (typeof rec.message?.content === 'string') {
        step.content.push({ type: 'text', text: rec.message.content })
      }
      cur.steps.push(step)
      lastStep = step
    } else if (rec && rec.type === 'user' && Array.isArray(rec.message?.content) && cur && lastStep) {
      // 工具结果：挂在最近一步
      for (const block of rec.message.content) {
        if (block && block.type === 'tool_result') {
          const inner = (Array.isArray(block.content) ? block.content : [])
            .map(mapContentBlock)
            .filter(Boolean)
          lastStep.toolResults.push({
            toolCallId: block.tool_use_id,
            content: inner,
            isError: block.is_error === true,
          })
        }
      }
    }
  }

  const sessionId = args.sessionId || mintSessionId(sourceId)
  const meta = { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: createdAt ?? Date.now() }
  if (cwd) meta.cwd = cwd

  const title = customTitle ?? aiTitle
  return {
    ...synthesizeSession({
      meta, turns, title, provider: 'claude-code', model, skipped, records: recs.length, skippedLines, typeCounts,
    }),
    sourceId: sourceId ?? null,
  }
}

/**
 * 从一次完整转换中截取「第 fromTurn 轮及之后」的事件尾部，并重新编号：
 * seq 从 fromSeq 连续（供增量 append 续写既有 DSH 会话日志）。轮次边界由
 * turn/start 事件确定——不是每个事件都带 data.turn（如 user/message 就没有）。
 * 末尾的 session/title 事件（无 turn）也一并带上（标题 last-wins，重复追加
 * 无害）。工具结果事件的 sourceEventSeqs 重映射到尾部新 seq；指向尾部之外的
 * 引用按原样保留（回合边界截取下不应出现）。
 * @param converted - convertClaudeJsonl / convertCodexJsonl 输出。
 * @param fromTurn - 尾部起始轮次（1 起）。
 * @param fromSeq - 尾部第一个事件的 seq。
 * @returns `{ events, firstTurn }`；无新事件时 events 为空数组。
 */
export function tailSessionEvents(converted, { fromTurn, fromSeq }) {
  const keep = []
  const oldToNew = new Map()
  let currentTurn = null
  for (const ev of converted.events ?? []) {
    if (ev && ev.type === 'turn/start' && ev.data && typeof ev.data.turn === 'number') {
      currentTurn = ev.data.turn
    }
    if (ev && ev.type === 'session/title') {
      oldToNew.set(ev.seq, fromSeq + keep.length)
      keep.push(ev)
      continue
    }
    if (currentTurn !== null && currentTurn >= fromTurn) {
      oldToNew.set(ev.seq, fromSeq + keep.length)
      keep.push(ev)
    }
  }
  return {
    firstTurn: fromTurn,
    events: keep.map((ev, i) => {
      const next = { ...ev, seq: fromSeq + i }
      if (Array.isArray(ev.sourceEventSeqs)) {
        next.sourceEventSeqs = ev.sourceEventSeqs.map((s) => oldToNew.has(s) ? oldToNew.get(s) : s)
      }
      return next
    }),
  }
}

// Codex / ChatGPT CLI rollout JSONL → 统一的回合中间结构。
// 行 envelope：{ timestamp, type, payload }。只消费 response_item（模型产物）与
// session_meta / turn_context（元数据）；event_msg 的 user_message / agent_message
// 是 response_item 的重复（schema 笔记明确警告会重复计数），一律忽略。
// 用户消息里以 `<` 开头的块（<environment_context>、<user_instructions>、
// <system-reminder> 等）是 harness 注入，不是人类输入，跳过。
export function convertCodexJsonl(raw, args = {}) {
  const recs = []
  let skipped = 0
  const skippedLines = []
  const typeCounts = {}
  let lineNo = 0
  for (const line of raw.split('\n')) {
    lineNo++
    const t = line.trim()
    if (!t) continue
    try {
      const rec = JSON.parse(t)
      if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
        throw new SyntaxError('record is not a JSON object')
      }
      recs.push(rec)
    } catch (err) {
      skipped++
      if (skippedLines.length < MALFORMED_REPORT_CAP) {
        skippedLines.push({ line: lineNo, error: String((err && err.message) || err) })
      }
    }
  }

  let sourceId = null
  let cwd = null
  let createdAt = null
  let model = null
  let title = null

  // callId → 它所属的 step（跨行配对 function_call_output）
  const callSteps = new Map()

  const turns = []
  let cur = null
  let lastStep = null

  // 新开一个「用户提问」回合。
  const openTurn = (prompt) => {
    cur = { prompt, steps: [] }
    turns.push(cur)
    lastStep = null
  }

  // 追加一步 assistant 产物（文本 / 工具调用）；没有当前回合时忽略。
  const openStep = () => {
    const step = { content: [], toolCalls: [], toolResults: [] }
    cur.steps.push(step)
    lastStep = step
    return step
  }

  for (const rec of recs) {
    const env = rec && rec.type
    const payload = rec && rec.payload
    if (env === 'session_meta' && payload) {
      if (!sourceId && typeof payload.id === 'string') sourceId = payload.id
      if (!cwd && typeof payload.cwd === 'string') cwd = payload.cwd
      if (createdAt === null) createdAt = parseTime(payload.timestamp ?? rec.timestamp)
      continue
    }
    if (env === 'turn_context' && payload) {
      if (!model && typeof payload.model === 'string') model = payload.model
      continue
    }
    if (env !== 'response_item' || !payload) continue

    if (payload.type === 'message') {
      if (payload.role === 'user' && Array.isArray(payload.content)) {
        // 过滤 harness 注入，剩余文本合并为用户提问
        const parts = []
        for (const block of payload.content) {
          if (block && block.type === 'input_text' && typeof block.text === 'string') {
            if (!block.text.startsWith('<')) parts.push(block.text)
          }
        }
        const prompt = parts.join('\n').trim()
        if (prompt) openTurn(prompt)
      } else if (payload.role === 'assistant' && cur) {
        const step = openStep()
        for (const block of payload.content) {
          if (block && block.type === 'output_text' && typeof block.text === 'string') {
            step.content.push({ type: 'text', text: block.text })
          }
        }
      }
      // developer（系统注入）忽略
    } else if ((payload.type === 'function_call' || payload.type === 'custom_tool_call') && cur) {
      // 挂到最近的 assistant 步骤（一步 = assistant 消息 + 其工具调用）；没有则新开一步
      const step = lastStep || openStep()
      const callId = payload.call_id
      let argumentsText
      if (payload.type === 'function_call') {
        argumentsText = typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments ?? {})
      } else {
        // custom_tool_call（如 apply_patch）：arguments 是自由格式 input
        argumentsText = JSON.stringify(payload.input ?? {})
      }
      const mapped = {
        id: callId,
        name: payload.name || 'unknown',
        arguments: argumentsText,
      }
      step.toolCalls.push(mapped)
      if (callId) callSteps.set(callId, step)
    } else if ((payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') && cur) {
      const callId = payload.call_id
      const step = callSteps.get(callId) || lastStep || openStep()
      // output 可能是纯字符串，也可能是 {"output": "...", "metadata": {...}} JSON 字符串
      let text
      const out = payload.output
      if (typeof out === 'string') {
        let parsed = null
        try { parsed = JSON.parse(out) } catch (_) { /* 纯文本 */ }
        text = parsed && typeof parsed === 'object' && typeof parsed.output === 'string'
          ? parsed.output
          : out
      } else if (out && typeof out === 'object' && typeof out.output === 'string') {
        text = out.output
      } else {
        text = typeof out === 'string' ? out : JSON.stringify(out ?? '')
      }
      step.toolResults.push({
        toolCallId: callId,
        content: [{ type: 'text', text }],
        isError: false,
      })
    }
    // reasoning（内容加密，通常不可读）与其余事件忽略
  }

  const sessionId = args.sessionId || mintSessionId(sourceId)
  const meta = { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: createdAt ?? Date.now() }
  if (cwd) meta.cwd = cwd

  return {
    ...synthesizeSession({
      meta, turns, title, provider: 'codex', model, skipped, records: recs.length, skippedLines, typeCounts,
    }),
    sourceId: sourceId ?? null,
  }
}
