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

/** 中断工具调用的合成结果文案（导入的历史里该调用没有返回记录）。 */
export const SYNTHETIC_TOOL_RESULT_TEXT = '(interrupted: no tool result in transcript)（中断的工具调用：transcript 未记录返回结果）'

// 把单个回合合成为平衡的事件数组（seq 从 startSeq 起）。流式转换（C3）与
// 全量 synthesizeSession 共用，保证两条路径事件纪律一致。
//
// 工具调用平衡（issue#1）：OpenAI 兼容协议要求助手消息里每个 tool_call_id
// 恰好跟一条 tool 消息。Claude transcript 可能缺结果（回合被中断）、重复
// 结果或孤儿结果（无对应声明的 tool_result），直接导入会令会话在续聊时
// 永久 400。这里在合成期修复：每个声明的 tool/call 恰好产出一条
// tool/result —— 有真实结果取第一条，重复的丢弃计数，缺失的补一条合成
// 错误结果（isError）；无对应声明的孤儿结果同样丢弃计数。
function synthesizeTurnEvents(meta, turn, t, startSeq, provider, mname, repaired) {
  const events = []
  let seq = startSeq
  const push = (type, data, surface, sourceEventSeqs) => {
    const ev = { type, seq: seq++, time: meta.createdAt, data }
    if (surface) ev.surfaceOp = 'append'
    if (sourceEventSeqs) ev.sourceEventSeqs = sourceEventSeqs
    events.push(ev)
    return ev
  }
  const bump = (key) => { if (repaired) repaired[key] = (repaired[key] ?? 0) + 1 }

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
      const declaredIds = new Set()
      for (const tc of step.toolCalls) {
        const ev = push('tool/call', {
          turn,
          step: stepNum,
          callId: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })
        callSeqByCallId[tc.id] = ev.seq
        declaredIds.add(tc.id)
      }
      // 每个声明的调用恰好一条结果：真实结果去重取首条，缺失补合成错误结果。
      const firstResultByCallId = new Map()
      for (const tr of step.toolResults) {
        if (!declaredIds.has(tr.toolCallId)) {
          bump('orphanResults')
          continue
        }
        if (firstResultByCallId.has(tr.toolCallId)) {
          bump('duplicateResults')
          continue
        }
        firstResultByCallId.set(tr.toolCallId, tr)
      }
      for (const tc of step.toolCalls) {
        const callSeq = callSeqByCallId[tc.id]
        const real = firstResultByCallId.get(tc.id)
        if (real) {
          push('tool/result', {
            turn,
            step: stepNum,
            message: {
              id: 'import:' + meta.id + ':t' + turn + ':' + stepNum + ':' + real.toolCallId,
              role: 'user',
              content: [{
                type: 'tool-result',
                toolCallId: real.toolCallId,
                content: real.content,
                ...(real.isError ? { isError: true } : {}),
              }],
              source: { kind: 'tool', callId: real.toolCallId },
            },
          }, true, [callSeq])
        } else {
          bump('synthesized')
          push('tool/result', {
            turn,
            step: stepNum,
            message: {
              id: 'import:' + meta.id + ':t' + turn + ':' + stepNum + ':' + tc.id,
              role: 'user',
              content: [{
                type: 'tool-result',
                toolCallId: tc.id,
                content: [{ type: 'text', text: SYNTHETIC_TOOL_RESULT_TEXT }],
                isError: true,
              }],
              source: { kind: 'tool', callId: tc.id },
            },
          }, true, [callSeq])
        }
      }
      push('step/end', { turn, step: stepNum })
    }
  }
  push('turn/end', { turn, reason: { kind: 'completed' } })
  return events
}

// 把「回合中间结构」合成平衡的 DSH 事件日志（seq 从 0 连续；surface 事件带
// surfaceOp:'append'；tool/result 用 sourceEventSeqs 关联其 tool/call）。
// turns: [{ prompt, steps: [{ content, toolCalls, toolResults }] }]
function synthesizeSession({ meta, turns, title, provider, model, skipped, records, skippedLines, typeCounts }) {
  const events = []
  let seq = 0
  const mname = model || provider
  const repaired = { synthesized: 0, duplicateResults: 0, orphanResults: 0 }

  for (let turn = 1; turn <= turns.length; turn++) {
    const evs = synthesizeTurnEvents(meta, turn, turns[turn - 1], seq, provider, mname, repaired)
    events.push(...evs)
    seq += evs.length
  }

  // 标题：custom-title / ai-title → session/title 事件（钉住，避免自动回退标题覆盖）。
  const normalizedTitle = (title || '').trim()
  if (normalizedTitle.length > 0) {
    events.push({
      type: 'session/title', seq: seq++, time: meta.createdAt,
      data: { title: normalizedTitle, messageSeqs: [], source: { kind: 'user' } },
    })
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
    repaired,
    ...(skippedLines !== undefined ? { skippedLines } : {}),
    ...(typeCounts !== undefined ? { typeCounts } : {}),
  }
}

// 逐行解析 JSONL：直连人类提问（type==='user' 且 content 为字符串）开新轮；每条
// assistant 消息 = 一步；其后的 tool_result 挂到最近一步。
//
// 扩展（相对上游）：畸形行带行号明细（F10）、标题 custom-title > ai-title、
// 按记录类型计数（S5 权限类统计、未知类型统计）。
//
// 实现走 createClaudeStreamConverter（C3）：与流式导入共用同一状态机，保证
// 两条路径事件纪律一致；全量模式 keepTurns 保留完整回合结构供 handoff/tail 使用。
export function convertClaudeJsonl(raw, args = {}) {
  const batches = []
  const converter = createClaudeStreamConverter({
    sessionId: args.sessionId,
    keepTurns: true,
    onBatch: (events) => { batches.push(events) },
  })
  converter.feed(raw)
  const result = converter.end()
  return {
    meta: result.meta,
    events: batches.flat(),
    turns: result.turns,
    title: result.title,
    messages: result.messages,
    toolCalls: result.toolCalls,
    skipped: result.skipped,
    records: result.records,
    skippedLines: result.skippedLines,
    typeCounts: result.typeCounts,
    repaired: result.repaired,
    sourceId: result.sourceId,
  }
}

/**
 * 导入自校验（issue#1）：验证合成的事件日志满足续聊协议不变式——
 * 每个 tool/call 恰好一条 tool/result（不重不漏）、tool/result 的
 * sourceEventSeqs 指向同轮声明的 tool/call、seq 从 startSeq 连续、
 * turn/step 配对。转换器按构造保证这些不变式，本校验供测试与导入前断言使用。
 * @param events - 合成的 DSH 事件数组。
 * @param startSeq - 期望的首事件 seq（增量批次为存储长度，默认 0）。
 * @returns 违规明细数组（空数组 = 通过）。
 */
export function validateSessionEvents(events, startSeq = 0) {
  const issues = []
  if (!Array.isArray(events)) return ['events is not an array']
  let seq = startSeq
  const calls = new Map()      // callId → seq
  const answered = new Map()   // callId → 已见结果数
  let openTurns = 0
  let openSteps = 0
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') {
      issues.push(`event at seq ${seq} is not an object`)
      continue
    }
    if (ev.seq !== seq) issues.push(`seq gap at ${seq}: got ${ev.seq}`)
    seq++
    if (ev.type === 'turn/start') {
      openTurns++
      openSteps = 0
    } else if (ev.type === 'turn/end') {
      if (openTurns <= 0) issues.push(`turn/end without turn/start at seq ${ev.seq}`)
      openTurns--
      if (openSteps !== 0) issues.push(`turn ended with ${openSteps} open steps at seq ${ev.seq}`)
      openSteps = 0
    } else if (ev.type === 'step/start') {
      openSteps++
    } else if (ev.type === 'step/end') {
      if (openSteps <= 0) issues.push(`step/end without step/start at seq ${ev.seq}`)
      openSteps--
    } else if (ev.type === 'tool/call') {
      const id = ev.data?.callId
      if (typeof id !== 'string' || id.length === 0) {
        issues.push(`tool/call without callId at seq ${ev.seq}`)
        continue
      }
      if (calls.has(id)) issues.push(`duplicate tool/call ${id} at seq ${ev.seq}`)
      calls.set(id, ev.seq)
      answered.set(id, 0)
    } else if (ev.type === 'tool/result') {
      const id = ev.data?.message?.content?.[0]?.toolCallId
      if (typeof id !== 'string' || id.length === 0) {
        issues.push(`tool/result without toolCallId at seq ${ev.seq}`)
        continue
      }
      if (!answered.has(id)) {
        issues.push(`tool/result ${id} has no tool/call at seq ${ev.seq}`)
        continue
      }
      answered.set(id, answered.get(id) + 1)
      const ref = Array.isArray(ev.sourceEventSeqs) ? ev.sourceEventSeqs[0] : undefined
      if (ref !== calls.get(id)) {
        issues.push(`tool/result ${id} sourceEventSeqs ${ref} does not match tool/call ${calls.get(id)} at seq ${ev.seq}`)
      }
    }
  }
  for (const [id, n] of answered) {
    if (n === 0) issues.push(`tool/call ${id} has no tool/result`)
    if (n > 1) issues.push(`tool/call ${id} has ${n} tool/result events`)
  }
  if (openTurns !== 0 || openSteps !== 0) issues.push(`unbalanced end: ${openTurns} turns, ${openSteps} steps open`)
  return issues
}

/**
 * Claude JSONL 流式转换器（C3）：逐行 feed、按回合边界合成事件、经 onBatch
 * 分批回调。onBatch 同步触发且返回值被忽略——需要顺序落盘的调用方在回调里
 * 自行串行 append（Promise 链），并在 end() 后等待该链。内存 O(当前回合 +
 * 单个批次)，不再 O(文件)；skipTurns>0 时前 N 个回合只计数不合成（续写
 * 前缀），新事件 seq 从 startSeq 起。
 *
 * @param options - `sessionId`（目标会话 id 覆盖）、`fallbackSessionId`
 *   （源 id 缺失时的稳定 id）、`keepTurns`（保留完整回合结构，默认 false）、
 *   `skipTurns`（跳过已落盘的回合数）、`startSeq`（新事件起始 seq）、
 *   `batchEvents`（批大小，默认 10000）、`onBatch`（批次回调）。
 * @returns `{ feed, end, meta }`；end() 返回 `{ meta, title, sourceId, turns,
 *   messages, toolCalls, skipped, skippedLines, typeCounts, records, emittedEvents }`
 *   ——turns 在 keepTurns 时为回合数组、否则为回合数。
 */
export function createClaudeStreamConverter({
  sessionId, fallbackSessionId, keepTurns = false,
  skipTurns = 0, startSeq = 0, batchEvents = 10000, onBatch,
} = {}) {
  const state = {
    sourceId: null,
    cwd: null,
    createdAt: null,
    model: null,
    aiTitle: null,
    customTitle: null,
    typeCounts: {},
    cur: null,
    lastStep: null,
  }
  const turns = keepTurns ? [] : null
  let skippedCount = 0
  const skippedLines = []
  let records = 0
  let lineNo = 0
  let turnCount = 0
  let messages = 0
  let toolCalls = 0
  let nextSeq = startSeq
  let emittedEvents = 0
  let pending = []
  let carry = ''
  let meta = null
  const repaired = { synthesized: 0, duplicateResults: 0, orphanResults: 0 }

  const metaFor = () => {
    if (meta === null) {
      const id = sessionId
        || (state.sourceId ? mintSessionId(state.sourceId) : fallbackSessionId)
        || mintSessionId(String(Date.now()))
      meta = { version: SESSION_FORMAT_VERSION, id, createdAt: state.createdAt ?? Date.now() }
      if (state.cwd) meta.cwd = state.cwd
    }
    return meta
  }

  const flush = () => {
    if (pending.length === 0) return
    const batch = pending
    pending = []
    if (typeof onBatch === 'function') onBatch(batch)
  }

  const finalizeTurn = (t) => {
    turnCount++
    if (turns) turns.push(t)
    if (turnCount <= skipTurns) return
    const evs = synthesizeTurnEvents(metaFor(), turnCount, t, nextSeq, 'claude-code', state.model, repaired)
    nextSeq += evs.length
    messages += evs.filter((e) => e.type === 'user/message' || e.type === 'assistant/message' || e.type === 'tool/result').length
    toolCalls += evs.filter((e) => e.type === 'tool/call').length
    emittedEvents += evs.length
    pending.push(...evs)
    if (pending.length >= batchEvents) flush()
  }

  const feedLine = (rawLine) => {
    lineNo++
    const t = rawLine.trim()
    if (!t) return
    let rec
    try {
      rec = JSON.parse(t)
      if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
        throw new SyntaxError('record is not a JSON object')
      }
    } catch (err) {
      skippedCount++
      if (skippedLines.length < MALFORMED_REPORT_CAP) {
        skippedLines.push({ line: lineNo, error: String((err && err.message) || err) })
      }
      return
    }
    records++
    const recType = typeof rec.type === 'string' ? rec.type : 'unknown'
    state.typeCounts[recType] = (state.typeCounts[recType] ?? 0) + 1

    if (typeof rec.sessionId === 'string' && !state.sourceId) state.sourceId = rec.sessionId
    if (typeof rec.cwd === 'string' && !state.cwd) state.cwd = rec.cwd
    if (typeof rec.timestamp === 'string' && state.createdAt === null) state.createdAt = parseTime(rec.timestamp)
    if (rec.type === 'custom-title' && typeof rec.customTitle === 'string' && state.customTitle === null) {
      state.customTitle = rec.customTitle
    } else if (rec.type === 'ai-title' && typeof rec.aiTitle === 'string' && state.aiTitle === null) {
      state.aiTitle = rec.aiTitle
    }
    const recModel = rec.message?.model ?? rec.model
    if (typeof recModel === 'string' && !state.model) state.model = recModel

    if (rec.type === 'user' && rec.message && typeof rec.message.content === 'string') {
      // 直连人类提问 → 新轮
      if (state.cur) finalizeTurn(state.cur)
      state.cur = { prompt: rec.message.content, steps: [] }
      state.lastStep = null
    } else if (rec.type === 'assistant' && state.cur) {
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
      state.cur.steps.push(step)
      state.lastStep = step
    } else if (rec.type === 'user' && Array.isArray(rec.message?.content) && state.cur && state.lastStep) {
      // 工具结果：挂在最近一步
      for (const block of rec.message.content) {
        if (block && block.type === 'tool_result') {
          const inner = (Array.isArray(block.content) ? block.content : [])
            .map(mapContentBlock)
            .filter(Boolean)
          state.lastStep.toolResults.push({
            toolCallId: block.tool_use_id,
            content: inner,
            isError: block.is_error === true,
          })
        }
      }
    }
  }

  return {
    /**
     * 喂入一段文本（可跨行边界分块）；同步执行，onBatch 立即触发。
     * @param chunk - 原始文本块。
     */
    feed(chunk) {
      const text = carry + String(chunk ?? '')
      const lines = text.split('\n')
      carry = lines.pop() ?? ''
      for (const line of lines) feedLine(line)
    },
    /**
     * 结束输入：落盘最后的未完成回合与标题，flush 剩余批次。
     * @returns 统计与元数据（见工厂 JSDoc）。
     */
    end() {
      if (carry.length > 0) {
        feedLine(carry)
        carry = ''
      }
      if (state.cur) {
        finalizeTurn(state.cur)
        state.cur = null
      }
      const title = state.customTitle ?? state.aiTitle
      const normalized = (title || '').trim()
      if (normalized.length > 0 && turnCount > skipTurns) {
        const m = metaFor()
        pending.push({
          type: 'session/title', seq: nextSeq++, time: m.createdAt,
          data: { title: normalized, messageSeqs: [], source: { kind: 'user' } },
        })
        emittedEvents++
      }
      flush()
      return {
        meta: metaFor(),
        title: title ?? null,
        sourceId: state.sourceId ?? null,
        turns: turns ?? turnCount,
        messages,
        toolCalls,
        skipped: skippedCount,
        skippedLines,
        typeCounts: state.typeCounts,
        records,
        emittedEvents,
        repaired,
      }
    },
    /** 转换器将使用的会话 meta（可改 meta.id 以避让冲突，随后事件沿用新 id）。 */
    meta: metaFor,
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
