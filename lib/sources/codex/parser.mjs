// SPDX-License-Identifier: Apache-2.0
// lib/sources/codex/parser.mjs — Codex CLI 源解析器（四合一迁移向导，零 DSH 依赖）。
//
// 数据根定位（$CODEX_HOME / ~/.codex）→ 只读白名单 → 结构化扫描：
//   - sessions/**/rollout-*.jsonl：流式逐行读（envelope {timestamp,type,payload}），
//     产出会话条目（标题/消息/工具调用/畸形行计数），不整文件进内存；
//   - skills/<name>/SKILL.md：classifySkill 判定兼容性（.system/README/MEMORY 跳过）；
//   - memories/*.md：记忆条目；
//   - AGENTS.md / CODEX.md：全局指令；
//   - hooks/*/command.md：命令分类（纯提示词/含 shell）；hooks/*/prompt.md 与
//     config.toml [commands]：钩子（不支持清单输入）。
// 凭据与内部状态（auth.json、state_*.sqlite、logs_*.sqlite、history.jsonl、log/、
// .tmp/、cache/、tmp/、shell_snapshots/、version.json）永不在白名单内。

import path from 'node:path'
import { homedir } from 'node:os'
import { access, readFile, readdir } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import {
  assertAllowedRead,
  digestText,
  emptyDetection,
  recordError,
  truncateText,
} from '../contract.mjs'
import { classifySkill, skipSkillEntry } from '../../skill-migrate.mjs'
import { classifyCommand } from '../../commands-migrate.mjs'

export const source = 'codex'

// rollout JSONL 文件名（sessions/**/rollout-*.jsonl）。
const ROLLOUT_FILE_RE = /^rollout-.*\.jsonl$/

/** Codex 数据根定位（$CODEX_HOME 优先，否则 ~/.codex）。 */
export function locateHome(env = process.env, home = homedir()) {
  return env.CODEX_HOME || path.join(home, '.codex')
}

/**
 * 只读白名单：允许读取的绝对路径根列表。凭据/内部状态永不在内。
 * @param home - Codex 数据根。
 * @returns 绝对路径根数组（sessions/skills/hooks/memories 目录 + 三个文件）。
 */
export function whitelist(home) {
  const h = path.resolve(String(home ?? ''))
  return [
    path.join(h, 'sessions'),
    path.join(h, 'skills'),
    path.join(h, 'hooks'),
    path.join(h, 'memories'),
    path.join(h, 'AGENTS.md'),
    path.join(h, 'CODEX.md'),
    path.join(h, 'config.toml'),
  ]
}

/** ISO 时间戳 → 毫秒（parseTime 风格 Date.parse；非法返回 null）。 */
function toMs(value) {
  if (typeof value === 'string') {
    const n = Date.parse(value)
    if (Number.isFinite(n)) return n
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return null
}

/** 首个非空人类文本：过滤 `<...>` 开头的 harness 注入块。 */
function firstHumanText(payload) {
  const content = payload && payload.content
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (block && block.type === 'input_text' && typeof block.text === 'string') {
      const text = block.text.trim()
      if (text && !text.startsWith('<')) return text
    }
  }
  return null
}

function isNotFound(err) {
  return !!(err && err.code === 'ENOENT')
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    const err = new Error('扫描已中止')
    err.name = 'AbortError'
    throw err
  }
}

function isAbort(err, signal) {
  return !!(err && err.name === 'AbortError') || !!(signal && signal.aborted)
}

/** 相对路径 → 正斜杠 id（跨平台稳定）。 */
function toPosix(rel) {
  return String(rel).split(path.sep).join('/')
}

/** 路径存在性检查（不抛）。 */
async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/**
 * 读取单个白名单文件：越界/读取失败记入 errors；缺文件返回 null（不报错）。
 * @returns `{ file, content }`；缺文件/失败返回 null。
 */
async function readOptional(detection, roots, file, scope, signal) {
  throwIfAborted(signal)
  let abs
  try {
    abs = assertAllowedRead(roots, file)
  } catch (err) {
    recordError(detection, scope, err)
    return null
  }
  try {
    const content = await readFile(abs, 'utf8')
    return { file: abs, content }
  } catch (err) {
    if (isAbort(err, signal)) throw err
    if (isNotFound(err)) return null
    recordError(detection, scope, err)
    return null
  }
}

/** 流式逐行扫单个 rollout JSONL，统计会话条目（不整文件进内存）。 */
async function scanSession(file, roots, signal) {
  const abs = assertAllowedRead(roots, file)
  let id = null
  let cwd = null
  let createdAt = null
  let lastActivity = null
  let title = null
  let turns = 0
  let messages = 0
  let toolCalls = 0
  let malformed = 0

  const rl = createInterface({ input: createReadStream(abs), crlfDelay: Infinity })
  for await (const line of rl) {
    throwIfAborted(signal)
    const text = line.trim()
    if (!text) continue
    let rec
    try {
      rec = JSON.parse(text)
      if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
        throw new SyntaxError('record is not a JSON object')
      }
    } catch {
      malformed++
      continue
    }

    const ts = toMs(rec.timestamp)
    if (ts != null) lastActivity = lastActivity == null ? ts : Math.max(lastActivity, ts)

    const env = rec.type
    const payload = rec.payload
    if (env === 'session_meta' && payload) {
      if (id == null && typeof payload.id === 'string') id = payload.id
      if (cwd == null && typeof payload.cwd === 'string') cwd = payload.cwd
      if (createdAt == null) {
        const created = toMs(payload.timestamp)
        if (created != null) createdAt = created
      }
      continue
    }
    if (env === 'turn_context' && payload) {
      turns++
      continue
    }
    if (env !== 'response_item' || !payload) continue

    if (payload.type === 'message') {
      if (payload.role === 'user' || payload.role === 'assistant') messages++
      if (payload.role === 'user' && title == null) {
        const human = firstHumanText(payload)
        if (human) title = truncateText(human, 120)
      }
    } else if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      toolCalls++
    }
  }

  return {
    id: id || path.basename(abs),
    file: abs,
    turns,
    messages,
    toolCalls,
    malformed,
    format: 'rollout-jsonl',
    ...(title ? { title } : {}),
    ...(cwd ? { cwd } : {}),
    ...(createdAt != null ? { createdAt } : {}),
    ...(lastActivity != null ? { lastActivity } : {}),
  }
}

async function scanSessions(detection, roots, home, signal) {
  const dir = path.join(home, 'sessions')
  throwIfAborted(signal)
  let entries
  try {
    entries = await readdir(assertAllowedRead(roots, dir), { recursive: true })
  } catch (err) {
    if (isAbort(err, signal)) throw err
    if (isNotFound(err)) return
    recordError(detection, 'sessions', err)
    return
  }
  for (const rel of entries) {
    throwIfAborted(signal)
    if (!ROLLOUT_FILE_RE.test(path.basename(rel))) continue
    const file = path.join(dir, rel)
    try {
      detection.sessions.push(await scanSession(file, roots, signal))
    } catch (err) {
      if (isAbort(err, signal)) throw err
      recordError(detection, 'session:' + file, err)
    }
  }
}

async function scanSkills(detection, roots, home, signal) {
  const dir = path.join(home, 'skills')
  throwIfAborted(signal)
  let entries
  try {
    entries = await readdir(assertAllowedRead(roots, dir), { withFileTypes: true })
  } catch (err) {
    if (isAbort(err, signal)) throw err
    if (isNotFound(err)) return
    recordError(detection, 'skills', err)
    return
  }
  for (const entry of entries) {
    throwIfAborted(signal)
    if (skipSkillEntry(entry.name)) continue
    if (!entry.isDirectory()) continue
    const skillFile = path.join(dir, entry.name, 'SKILL.md')
    const read = await readOptional(detection, roots, skillFile, 'skill:' + skillFile, signal)
    if (!read) continue
    const classified = classifySkill(read.content)
    detection.skills.push({
      id: toPosix(path.relative(home, read.file)),
      dir: path.dirname(read.file),
      file: read.file,
      name: classified.name || entry.name,
      description: classified.description,
      compatible: classified.compatible,
      digest: digestText(read.content),
    })
  }
}

async function scanMemories(detection, roots, home, signal) {
  const dir = path.join(home, 'memories')
  throwIfAborted(signal)
  let entries
  try {
    entries = await readdir(assertAllowedRead(roots, dir), { withFileTypes: true })
  } catch (err) {
    if (isAbort(err, signal)) throw err
    if (isNotFound(err)) return
    recordError(detection, 'memories', err)
    return
  }
  for (const entry of entries) {
    throwIfAborted(signal)
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const file = path.join(dir, entry.name)
    const read = await readOptional(detection, roots, file, 'memory:' + file, signal)
    if (!read) continue
    detection.memories.push({
      id: toPosix(path.relative(home, read.file)),
      file: read.file,
      kind: 'codex-memory',
      bytes: Buffer.byteLength(read.content, 'utf8'),
      digest: digestText(read.content),
    })
  }
}

async function scanInstructions(detection, roots, home, signal) {
  const targets = [
    ['AGENTS.md', 'agents-md'],
    ['CODEX.md', 'codex-md'],
  ]
  for (const [name, kind] of targets) {
    throwIfAborted(signal)
    const file = path.join(home, name)
    const read = await readOptional(detection, roots, file, name, signal)
    if (!read) continue
    detection.instructions.push({
      id: toPosix(path.relative(home, read.file)),
      file: read.file,
      kind,
      bytes: Buffer.byteLength(read.content, 'utf8'),
      digest: digestText(read.content),
    })
  }
}

/** 去掉 TOML 行内注释（尊重双/单引号字符串）。 */
function stripTomlComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote && line[i - 1] !== '\\') quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '#') {
      return line.slice(0, i)
    }
  }
  return line
}

/** 去掉 TOML 字符串值的成对引号。 */
function unquoteToml(value) {
  const quoted = value.match(/^"([\s\S]*)"$|^'([\s\S]*)'$/)
  if (!quoted) return value
  return quoted[1] ?? quoted[2]
}

/** 最小 TOML 解析：提取 `[commands]` 段内的 `name = value` 条目。 */
function parseTomlCommands(toml) {
  const commands = []
  const lines = String(toml ?? '').split(/\r?\n/)
  let inCommands = false
  for (const raw of lines) {
    const line = stripTomlComment(raw).trim()
    if (!line) continue
    const section = line.match(/^\[([^\]]+)\]$/)
    if (section) {
      inCommands = section[1].trim() === 'commands'
      continue
    }
    if (!inCommands) continue
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/)
    if (!kv) continue
    commands.push({ name: kv[1], value: unquoteToml(kv[2].trim()) })
  }
  return commands
}

async function scanConfigCommands(detection, roots, home, signal) {
  const file = path.join(home, 'config.toml')
  const read = await readOptional(detection, roots, file, 'config.toml', signal)
  if (!read) return
  let commands
  try {
    commands = parseTomlCommands(read.content)
  } catch (err) {
    recordError(detection, 'config.toml', err)
    return
  }
  for (const cmd of commands) {
    detection.hooks.push({
      id: `config.toml:${cmd.name}`,
      file: read.file,
      kind: 'codex-hook',
      matcher: cmd.name,
      bytes: Buffer.byteLength(cmd.value, 'utf8'),
    })
  }
}

async function scanCommandsAndHooks(detection, roots, home, signal) {
  const hooksDir = path.join(home, 'hooks')
  throwIfAborted(signal)
  let entries
  try {
    entries = await readdir(assertAllowedRead(roots, hooksDir), { withFileTypes: true })
  } catch (err) {
    if (isAbort(err, signal)) throw err
    if (isNotFound(err)) entries = []
    else {
      recordError(detection, 'hooks', err)
      entries = []
    }
  }

  for (const entry of entries) {
    throwIfAborted(signal)
    if (!entry.isDirectory()) continue
    const dir = path.join(hooksDir, entry.name)

    const command = await readOptional(detection, roots, path.join(dir, 'command.md'), 'command:' + entry.name, signal)
    if (command) {
      const classified = classifyCommand(command.content, entry.name)
      detection.commands.push({
        id: toPosix(path.relative(home, command.file)),
        file: command.file,
        name: classified.name,
        promptOnly: classified.promptOnly,
        bytes: Buffer.byteLength(command.content, 'utf8'),
        digest: digestText(command.content),
      })
    }

    const prompt = await readOptional(detection, roots, path.join(dir, 'prompt.md'), 'prompt:' + entry.name, signal)
    if (prompt) {
      detection.hooks.push({
        id: toPosix(path.relative(home, prompt.file)),
        file: prompt.file,
        kind: 'codex-hook',
        bytes: Buffer.byteLength(prompt.content, 'utf8'),
      })
    }
  }

  await scanConfigCommands(detection, roots, home, signal)
}

/**
 * 扫描 Codex 数据根为统一 Detection。
 * @param home - 数据根目录。
 * @param opts - `{ signal }`。
 * @returns `{ source, home, homeExists, scannedAt, sessions, skills, memories,
 *   instructions, commands, hooks, errors }`。
 */
export async function detect(home, { signal } = {}) {
  const resolved = path.resolve(String(home ?? ''))
  const detection = emptyDetection(source, resolved)
  const roots = whitelist(resolved)
  throwIfAborted(signal)
  detection.homeExists = await exists(resolved)
  if (!detection.homeExists) return detection

  await scanSessions(detection, roots, resolved, signal)
  await scanSkills(detection, roots, resolved, signal)
  await scanMemories(detection, roots, resolved, signal)
  await scanInstructions(detection, roots, resolved, signal)
  await scanCommandsAndHooks(detection, roots, resolved, signal)
  return detection
}
