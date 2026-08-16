// SPDX-License-Identifier: Apache-2.0
// lib/sources/opencode/parser.mjs — OpenCode 源解析器（四合一迁移向导）。
//
// 数据布局（XDG，2026 实测）：
//   - 会话：`<dataHome>/opencode.db`（SQLite：session/message/part 表，node:sqlite
//     只读打开；message.data / part.data 是 JSON 文本列）——旧版为
//     `storage/session/global/<ses>.json` + `storage/message/<ses>/msg_*.json` +
//     `storage/part/<msg>/prt_*.json`，两条路径都支持（DB 优先）。
//   - 配置：`<configHome>/agent/*.md`（子代理定义 → 转换为技能）、
//     `<configHome>/command/*.md`（命令）、`<configHome>/AGENTS.md`（全局指令）。
// 只读白名单：opencode.db + storage 目录 + agent/command/AGENTS.md；
// auth.json / log/ / snapshot/ / bin/ / .env 永不读取。

import path from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { assertAllowedRead, digestText, emptyDetection, errorText, recordError, truncateText } from '../contract.mjs'
import { classifySkill } from '../../skill-migrate.mjs'
import { classifyCommand } from '../../commands-migrate.mjs'

export const source = 'opencode'

/** 数据库扫描的会话数上限（按最近更新排序；防超大户 OOM）。 */
export const SESSION_SCAN_CAP = 500

/** 数据根定位：OPENCODE_DATA_HOME > XDG_DATA_HOME/opencode > 平台默认。 */
export function locateHome(env = process.env, home = homedir()) {
  if (env.OPENCODE_DATA_HOME) return path.resolve(env.OPENCODE_DATA_HOME)
  if (env.XDG_DATA_HOME) return path.join(env.XDG_DATA_HOME, 'opencode')
  if (process.platform === 'win32') {
    return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'opencode')
  }
  return path.join(home, '.local', 'share', 'opencode')
}

/** 配置根定位：OPENCODE_CONFIG_HOME > XDG_CONFIG_HOME/opencode > ~/.config/opencode。 */
export function locateConfigHome(env = process.env, home = homedir()) {
  if (env.OPENCODE_CONFIG_HOME) return path.resolve(env.OPENCODE_CONFIG_HOME)
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, 'opencode')
  return path.join(home, '.config', 'opencode')
}

/** 只读白名单：数据库 + 旧版 storage + 配置三件套。 */
export function whitelist(home, configHome = locateConfigHome()) {
  return [
    path.join(home, 'opencode.db'),
    path.join(home, 'storage'),
    path.join(configHome, 'agent'),
    path.join(configHome, 'command'),
    path.join(configHome, 'AGENTS.md'),
  ]
}

/**
 * 打开 opencode.db（只读）。表缺失/打不开时抛错（调用方记 errors）。
 * @param dbPath - 数据库绝对路径。
 * @returns DatabaseSync 实例。
 */
export function openDb(dbPath) {
  return new DatabaseSync(dbPath, { readOnly: true })
}

/** 从数据库读取全部会话的元数据（标题/目录/时间 + 轻量统计）。 */
function scanDb(detection, dbPath, cap = SESSION_SCAN_CAP) {
  let db
  try {
    db = openDb(dbPath)
  } catch (err) {
    recordError(detection, 'opencode.db', '打开失败：' + errorText(err))
    return
  }
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
    const need = ['session', 'message', 'part']
    if (!need.every((t) => tables.includes(t))) {
      recordError(detection, 'opencode.db', `缺少表：${need.filter((t) => !tables.includes(t)).join(', ')}（不认识的 OpenCode 版本）`)
      return
    }
    const sessions = db.prepare(
      'SELECT id, title, directory, time_created, time_updated FROM session WHERE time_archived IS NULL ORDER BY time_updated DESC LIMIT ?',
    ).all(cap)
    const msgStmt = db.prepare("SELECT data FROM message WHERE session_id = ?")
    const partStmt = db.prepare(
      "SELECT COUNT(*) AS n FROM part WHERE session_id = ? AND json_extract(data, '$.type') = 'tool'",
    )
    for (const s of sessions) {
      let turns = 0
      let messages = 0
      for (const row of msgStmt.all(s.id)) {
        messages++
        try {
          const data = JSON.parse(row.data)
          if (data?.role === 'user') turns++
        } catch {
          // 畸形 message.data：宽容跳过（转换期再报行级错误）。
        }
      }
      const toolCalls = partStmt.get(s.id)?.n ?? 0
      detection.sessions.push({
        id: s.id,
        file: dbPath,
        sessionId: s.id,
        storage: 'opencode-db',
        ...(s.title ? { title: truncateText(s.title, 120) } : {}),
        ...(s.directory ? { cwd: s.directory } : {}),
        createdAt: typeof s.time_created === 'number' ? s.time_created : undefined,
        lastActivity: typeof s.time_updated === 'number' ? s.time_updated : undefined,
        turns,
        messages,
        toolCalls,
        format: 'opencode-db',
      })
    }
  } catch (err) {
    recordError(detection, 'opencode.db', errorText(err))
  } finally {
    try { db.close() } catch { /* 关闭失败无碍 */ }
  }
}

/** 旧版 JSON 布局扫描：storage/session/global/*.json + storage/message/<ses>/msg_*.json。 */
async function scanLegacy(detection, storageDir, cap = SESSION_SCAN_CAP) {
  const sessionDir = path.join(storageDir, 'session', 'global')
  let names
  try {
    names = (await readdir(sessionDir)).filter((n) => n.endsWith('.json'))
  } catch {
    return // 无旧版布局。
  }
  const sessions = []
  for (const name of names) {
    try {
      const raw = await readFile(assertAllowedRead(whitelist(detection.home), path.join(sessionDir, name)), 'utf8')
      const data = JSON.parse(raw)
      sessions.push({ name, data })
    } catch (err) {
      recordError(detection, 'legacy-session:' + name, errorText(err))
    }
  }
  sessions.sort((a, b) => ((b.data?.time?.updated ?? 0) - (a.data?.time?.updated ?? 0)))
  for (const { name, data } of sessions.slice(0, cap)) {
    const id = data?.id ?? name.replace(/\.json$/, '')
    const msgDir = path.join(storageDir, 'message', id)
    let messages = 0
    try {
      const entries = await readdir(assertAllowedRead(whitelist(detection.home), msgDir))
      messages = entries.filter((n) => n.startsWith('msg_') && n.endsWith('.json')).length
    } catch {
      // 消息目录缺失：按 0 处理。
    }
    detection.sessions.push({
      id,
      file: path.join(sessionDir, name),
      sessionId: id,
      storage: 'opencode-legacy',
      ...(data?.title ? { title: truncateText(data.title, 120) } : {}),
      ...(data?.directory ? { cwd: data.directory } : {}),
      createdAt: data?.time?.created,
      lastActivity: data?.time?.updated,
      turns: 0,
      messages,
      toolCalls: 0,
      format: 'opencode-legacy',
    })
  }
}

/**
 * 扫描 OpenCode：数据库优先，旧版 storage 兜底；agents/commands/AGENTS.md 走配置根。
 * @param home - 数据根目录。
 * @param opts - `{ configHome, signal }`。
 * @returns 统一 Detection。
 */
export async function detect(home, { configHome = locateConfigHome(), signal } = {}) {
  const detection = emptyDetection(source, home)
  detection.configHome = configHome
  detection.homeExists = existsSync(home) || existsSync(configHome)
  if (!detection.homeExists) return detection

  const roots = whitelist(home, configHome)
  const dbPath = path.join(home, 'opencode.db')
  if (existsSync(dbPath)) {
    scanDb(detection, dbPath)
  }
  if (detection.sessions.length === 0) {
    await scanLegacy(detection, path.join(home, 'storage'))
  }

  // agents：<configHome>/agent/*.md → 技能条目（一律转换为 SKILL.md）。
  try {
    signal?.throwIfAborted()
    const agentDir = path.join(configHome, 'agent')
    const entries = await readdir(assertAllowedRead(roots, agentDir), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const file = path.join(agentDir, entry.name)
      try {
        const content = await readFile(assertAllowedRead(roots, file), 'utf8')
        const { name, description } = classifySkill(content)
        detection.skills.push({
          id: 'agent:' + entry.name,
          dir: agentDir,
          file,
          name: name || entry.name.replace(/\.md$/, ''),
          description: description || '',
          compatible: false, // agent 定义 → 统一转换（合成 name/description frontmatter）
          digest: digestText(content),
        })
      } catch (err) {
        recordError(detection, 'agent:' + file, err)
      }
    }
  } catch {
    // 无 agent 目录。
  }

  // commands：<configHome>/command/*.md → 命令条目（纯提示词可注册，含 shell 不支持）。
  try {
    signal?.throwIfAborted()
    const commandDir = path.join(configHome, 'command')
    const entries = await readdir(assertAllowedRead(roots, commandDir), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const file = path.join(commandDir, entry.name)
      try {
        const content = await readFile(assertAllowedRead(roots, file), 'utf8')
        const name = entry.name.replace(/\.md$/, '')
        const classified = classifyCommand(content, name)
        detection.commands.push({
          id: name,
          file,
          name: classified.name,
          promptOnly: classified.promptOnly,
          bytes: Buffer.byteLength(content, 'utf8'),
          digest: digestText(content),
        })
      } catch (err) {
        recordError(detection, 'command:' + file, err)
      }
    }
  } catch {
    // 无 command 目录。
  }

  // instructions：全局 AGENTS.md。
  const agentsMd = path.join(configHome, 'AGENTS.md')
  try {
    signal?.throwIfAborted()
    const st = await stat(assertAllowedRead(roots, agentsMd))
    if (st.isFile()) {
      const content = await readFile(agentsMd, 'utf8')
      detection.instructions.push({
        id: agentsMd,
        file: agentsMd,
        kind: 'agents-md',
        bytes: st.size,
        digest: digestText(content),
      })
    }
  } catch {
    // 无全局 AGENTS.md。
  }
  return detection
}
