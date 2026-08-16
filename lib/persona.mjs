// SPDX-License-Identifier: Apache-2.0
// lib/persona.mjs — 迁移向导生成的短 persona 段落（零 DSH 依赖）。
//
// 对齐官方 Minimal persona 风格：一句简短角色陈述开头、保持短小
// （`You are a helpful software engineer assistant.`）。迁移报告里给用户的
// persona 建议与向导注入文案都从这里生成，绝不超过两三句话。

/** 常见角色的中文名（保持短小）。 */
const ZH_ROLES = { assistant: '助手', migration: '迁移', code: '编程', review: '审查' }

/**
 * 一句角色陈述（官方 Minimal persona 风格）。
 * @param role - 角色名（默认 'assistant'）。
 * @param lang - 'en' | 'zh'。
 * @returns 单句 persona。
 */
export function personaSentence(role = 'assistant', lang = 'en') {
  const raw = String(role ?? 'assistant').trim() || 'assistant'
  const name = lang === 'zh' ? (ZH_ROLES[raw] ?? raw) : raw
  return lang === 'zh'
    ? `你是一名高效的${name}助手。`
    : `You are a helpful ${raw} assistant.`
}

/**
 * 迁移向导的短 persona 段落：一句角色陈述 + 一句边界说明，保持短小。
 * 用于（a）报告中的 persona 建议；（b）OpenCode agent 转技能时的 persona 建议。
 * @param role - 角色名。
 * @param lang - 'en' | 'zh'。
 * @returns 不超过两句的段落。
 */
export function personaParagraph(role = 'migration', lang = 'en') {
  const sentence = personaSentence(role, lang)
  return lang === 'zh'
    ? `${sentence}你只负责迁移本机数据到 DeepSeek Harness，回答简短、先确认再执行。`
    : `${sentence} You migrate local agent data into DeepSeek Harness: answer briefly and confirm before executing.`
}
