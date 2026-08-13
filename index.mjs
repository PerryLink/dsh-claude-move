// index.mjs — dsh-claude-move host 插件入口。
//
// 阶段 1 注册 `claude_scan` 工具：自动定位 Claude 数据根目录，扫描全部
// project/session/memory/skill/CLAUDE.md 并返回结构化索引（F1-F4）。
// 后续阶段在同一 apply 里追加 import_claude 工具、claude-import-all 与
// resume-claude 命令、memory/CLAUDE.md 提示词注入、技能 provider 与面板路由。
//
// 只消费公开服务：ctx.tools 注册工具；导入状态经 ctx.get('sessionPersistence')
// 可选读取（无该服务时状态一律 none，不影响扫描）。源文件只读，缓存只写
// resolveCacheDir()。

import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  INDEX_VERSION,
  DEFAULT_MAX_TRANSCRIPT_BYTES,
  locateClaudeHome,
  resolveCacheDir,
  loadCache,
  saveCache,
  loadImports,
  saveImports,
  scanClaudeHome,
  scanProjectDir,
  scanTranscriptFile,
} from './lib/discovery.mjs'
import { convertClaudeJsonl } from './lib/convert.mjs'
import { scanSecrets, summarizePermissions } from './lib/report.mjs'

export const name = 'claude-move'

export const inject = ['tools']

/**
 * 插件配置（cordis.yml 可覆盖，C4）。
 * @typedef {object} Config
 * @property {string} [claudeHome] Claude 数据根目录；缺省自动定位（$CLAUDE_CONFIG_DIR / ~/.claude）。
 * @property {boolean} [scanGit] 是否探测 git 分支与脏状态（默认 true）。
 * @property {number} [maxTranscriptBytes] transcript oversized 判定阈值（默认 64 MiB）。
 * @property {string[]} [excludeProjects] 排除的项目 slug（子串匹配，默认空）。
 */

export const Config = Schema.object({
  claudeHome: Schema.string(),
  scanGit: Schema.boolean().default(true),
  maxTranscriptBytes: Schema.number().default(DEFAULT_MAX_TRANSCRIPT_BYTES),
  excludeProjects: Schema.array(Schema.string()).default([]),
})

const sessionImportSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true },
    dshSessionId: { type: 'string' },
  },
}

const sessionSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    file: { type: 'string', required: true },
    sessionId: { type: 'string' },
    title: { type: 'string' },
    messages: { type: 'integer' },
    toolCalls: { type: 'integer' },
    malformed: { type: 'integer' },
    import: sessionImportSchema,
  },
}

const projectSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    slug: { type: 'string', required: true },
    sessions: { type: 'array', items: sessionSchema },
  },
}

const scanIndexSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    version: { type: 'integer', required: true },
    claudeHome: { type: 'string', required: true },
    scannedAt: { type: 'string', required: true },
    projects: { type: 'array', items: projectSchema, required: true },
  },
}

/**
 * 解析工具参数里的目标路径：'all'/缺省 → 全量；projects 目录/数据根 → 全量；
 * 单个 .jsonl → 单会话；其余目录（projects/<slug> 或任意含 .jsonl 的目录）
 * → 按单个项目扫描。
 * @param raw - 用户给的路径（可含 `~`）。
 * @param claudeHome - 解析出的数据根目录。
 * @returns `{ kind: 'all' }` 或 `{ kind: 'file'|'dir', target }`。
 */
export function resolveScanTarget(raw, claudeHome) {
  if (typeof raw !== 'string' || raw.trim().length === 0 || raw === 'all') {
    return { kind: 'all' }
  }
  const expanded = raw.startsWith('~')
    ? path.join(homedir(), raw.slice(1).replace(/^[\\/]+/, ''))
    : raw
  const target = path.resolve(expanded)
  const projectsDir = path.join(claudeHome, 'projects')
  if (target === projectsDir || target === claudeHome) return { kind: 'all' }
  if (/\.jsonl$/i.test(target)) return { kind: 'file', target }
  return { kind: 'dir', target }
}

/**
 * 执行一次扫描（按 path 收窄；按 refresh 决定是否复用增量缓存）。
 * @param ctx - Cordis 上下文（仅用于可选导入状态标注）。
 * @param config - 插件配置。
 * @param args - 工具参数 `{ path?, refresh? }`。
 * @returns 结构化索引（session.import 已标注）。
 */
export async function runScan(ctx, config, args) {
  const claudeHome = config.claudeHome ? path.resolve(config.claudeHome) : locateClaudeHome()
  const cacheDir = resolveCacheDir()
  const scanOpts = {
    maxBytes: config.maxTranscriptBytes ?? DEFAULT_MAX_TRANSCRIPT_BYTES,
    ...(config.scanGit === false ? { scanGit: false } : {}),
    ...(config.excludeProjects?.length ? { excludeProjects: config.excludeProjects } : {}),
  }

  const target = resolveScanTarget(args?.path, claudeHome)
  const cache = args?.refresh === true ? null : await loadCache(cacheDir)
  const shared = { ...scanOpts, ...(cache ? { cache } : {}) }

  let index
  let files
  if (target.kind === 'all') {
    const result = await scanClaudeHome(claudeHome, shared)
    index = result.index
    files = result.files
  } else if (target.kind === 'file') {
    const session = await scanTranscriptFile(target.target, { maxBytes: scanOpts.maxBytes })
    const cwd = session.cwd
    index = {
      version: INDEX_VERSION,
      claudeHome,
      scannedAt: new Date().toISOString(),
      projects: [{
        slug: path.basename(path.dirname(target.target)),
        dir: path.dirname(target.target),
        dirExists: typeof cwd === 'string' && existsSync(cwd),
        sessions: [session],
      }],
      personal: null,
    }
    files = session.error ? {} : { [session.file]: session }
  } else {
    const project = await scanProjectDir(target.target, shared)
    index = { version: INDEX_VERSION, claudeHome, scannedAt: new Date().toISOString(), projects: [project], personal: null }
    files = {}
    for (const session of project.sessions) if (!session.error) files[session.file] = session
  }

  if (target.kind === 'all') {
    await saveCache(cacheDir, { version: INDEX_VERSION, claudeHome, files })
  }
  index.claudeHomeExists = existsSync(claudeHome)

  await annotateImports(ctx, cacheDir, index)
  return index
}

/**
 * 用 sessionPersistence 列表 + imports 映射标注每个会话的导入状态（F4 幂等基础）。
 * @param ctx - Cordis 上下文。
 * @param cacheDir - 缓存目录。
 * @param index - 扫描索引（就地标注）。
 */
export async function annotateImports(ctx, cacheDir, index) {
  const imports = await loadImports(cacheDir)
  const sp = ctx.get('sessionPersistence')
  const imported = new Set()
  if (sp && typeof sp.list === 'function') {
    try {
      for (const header of await sp.list()) imported.add(header.id)
    } catch {
      // 持久化不可读：全部按未导入处理。
    }
  }
  for (const project of index.projects ?? []) {
    for (const session of project.sessions ?? []) {
      const dshId = imports[session.sessionId]
      if (dshId && imported.has(dshId)) {
        session.import = { status: 'imported', dshSessionId: dshId }
      } else if (session.error) {
        session.import = { status: 'source-missing' }
      } else {
        session.import = { status: 'none' }
      }
    }
  }
}

/** claude_scan 结果的模型可读摘要（中文）。 */
export function renderScan(args, value) {
  const projects = value.projects ?? []
  const sessions = projects.flatMap((p) => p.sessions ?? [])
  const imported = sessions.filter((s) => s.import?.status === 'imported').length
  const skills = value.personal?.skills ?? []
  const lines = []
  lines.push(`已扫描 Claude 根目录 ${value.claudeHome}${value.claudeHomeExists ? '' : '（不存在）'}：`)
  lines.push(`- 项目 ${projects.length} 个、会话 ${sessions.length} 个（已导入 ${imported} 个）、技能 ${skills.length} 个`)
  const malformedTotal = sessions.reduce((sum, s) => sum + (s.malformed ?? 0), 0)
  if (malformedTotal > 0) lines.push(`- 畸形 JSONL 行 ${malformedTotal} 条（导入时逐条报告行号）`)
  const recent = projects.slice(0, 5)
  if (recent.length > 0) {
    lines.push('最近活动：')
    for (const project of recent) {
      const latest = project.sessions.find((s) => typeof s.lastActivity === 'number')
      const when = latest?.lastActivity ? new Date(latest.lastActivity).toLocaleString() : '未知'
      const git = project.git
        ? `git ${git.branch ?? '?'}${typeof git.dirtyCount === 'number' ? `（脏 ${git.dirtyCount}）` : ''}`
        : project.dirExists ? '非 git' : '目录不存在'
      lines.push(`  - ${project.slug}（${when}，会话 ${project.sessions.length} 个，${git}）`)
    }
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

function makeScanTool(ctx, config) {
  return defineTool({
    name: 'claude_scan',
    description:
      '扫描本机 Claude Code 数据：自动定位数据根目录（$CLAUDE_CONFIG_DIR 或 ~/.claude），' +
      '索引全部项目/会话（标题、起止时间、消息与工具调用数）、目录与 git 状态，以及' +
      '记忆、技能、全局 CLAUDE.md 与 settings.json。返回结构化 JSON 索引；' +
      'path 可收窄到 projects 目录、单个项目目录、单个 .jsonl 或任意含 .jsonl 的目录，' +
      'refresh=true 跳过增量缓存全量重扫。导入历史请用 import_claude。',
    parameters: {
      path: {
        type: 'string',
        description: "可选：'all'（默认全量）、'~/.claude/projects'、单个项目目录、单个 .jsonl 文件，或任意含 .jsonl 的目录。",
      },
      refresh: {
        type: 'boolean',
        description: '可选：true 时忽略增量缓存，全量重扫（默认 false）。',
      },
    },
    output: {
      schema: scanIndexSchema,
      render: renderScan,
    },
    async execute(args) {
      return runScan(ctx, config, args)
    },
  })
}

// ── 历史对话导入（F5-F10）────────────────────────────────────────────────────

/**
 * 解析导入目标：'all' → projects 根目录；其它路径照常（支持 `~`）。
 * @param raw - 工具参数里的 path。
 * @param claudeHome - Claude 数据根目录。
 * @returns 绝对路径。
 */
export function resolveImportTarget(raw, claudeHome) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('path 必填：单个 .jsonl、目录、"~/.claude/projects" 或 "all"')
  }
  if (raw === 'all') return path.join(claudeHome, 'projects')
  const expanded = raw.startsWith('~')
    ? path.join(homedir(), raw.slice(1).replace(/^[\\/]+/, ''))
    : raw
  return path.resolve(expanded)
}

/** 已持久化会话 id 集合（批量导入一次快照，避免逐文件 O(n) 列表）。 */
async function listPersistedIds(ctx) {
  const sp = ctx.sessionPersistence ?? ctx.get('sessionPersistence')
  if (!sp || typeof sp.list !== 'function') return new Set()
  try {
    return new Set((await sp.list()).map((h) => h.id))
  } catch {
    return new Set()
  }
}

/**
 * 强制重导入的新会话 id：`import-<src>-<n>`，n 取现有后缀最大值 +1（F7）。
 * @param persisted - 已持久化会话 id 快照。
 * @param baseId - 原目标 id。
 * @returns 新 id。
 */
export function mintForceSessionId(persisted, baseId) {
  const prefix = baseId + '-'
  let max = 0
  for (const id of persisted) {
    if (id.startsWith(prefix)) {
      const n = Number(id.slice(prefix.length))
      if (Number.isInteger(n) && n > max) max = n
    }
  }
  return prefix + (max + 1)
}

/**
 * 归档旧导入（workspaceRegistry.archiveSession，可选服务）。归档失败不阻断导入。
 * @param ctx - Cordis 上下文。
 * @param oldId - 旧 DSH 会话 id。
 */
export async function archiveSession(ctx, oldId) {
  const wr = ctx.get('workspaceRegistry')
  if (!wr || typeof wr.archiveSession !== 'function') return false
  try {
    await wr.archiveSession(oldId)
    return true
  } catch (err) {
    console.error('[claude-move] archive session failed:', String((err && err.message) || err))
    return false
  }
}

/**
 * 把导入的会话挂到其 cwd 对应的工作区（否则显示为「未分组」，F9）。
 * @param ctx - Cordis 上下文。
 * @param meta - SessionHeader。
 * @returns 是否挂接成功；目录不存在/无 workspaceRegistry 时 false。
 */
export async function attachToWorkspace(ctx, meta) {
  if (!meta.cwd) return false
  const wr = ctx.get('workspaceRegistry')
  if (!wr || typeof wr.resolveByPath !== 'function') return false
  try {
    let ws = await wr.resolveByPath(meta.cwd)
    if (!ws) ws = await wr.create(meta.cwd)
    await ws.attachSession(meta.id)
    return true
  } catch (err) {
    console.error('[claude-move] workspace attach failed:', String((err && err.message) || err))
    return false
  }
}

/**
 * 记录源 sessionId → DSH 会话 id 映射（增量缓存目录 imports.json，F4/F7 基础）。
 * @param ctx - Cordis 上下文。
 * @param sourceId - 源 transcript sessionId；缺失则跳过。
 * @param dshId - DSH 会话 id。
 */
export async function rememberImport(ctx, sourceId, dshId) {
  if (typeof sourceId !== 'string' || sourceId.length === 0) return
  try {
    const cacheDir = resolveCacheDir()
    const imports = await loadImports(cacheDir)
    imports[sourceId] = dshId
    await saveImports(cacheDir, imports)
  } catch (err) {
    console.error('[claude-move] remember import failed:', String((err && err.message) || err))
  }
}

/**
 * 幂等落盘一份已转换会话（F5-F7/F9）：已存在且未 force → 跳过；
 * force → 归档旧导入 + 新 id 重建。落盘 = create + append（append-only），
 * 随后按 cwd 挂接工作区并记录 imports 映射。
 * @param ctx - Cordis 上下文。
 * @param converted - convertClaudeJsonl 输出。
 * @param args - 工具参数 `{ force? }`。
 * @param persisted - 已持久化 id 快照（就地更新）。
 * @param sourcePath - 源 transcript 展示路径（报告用）。
 * @returns 单文件统计。
 */
export async function persistConverted(ctx, converted, args, persisted, sourcePath) {
  const { meta, events, turns, messages, toolCalls, skipped, skippedLines, typeCounts, sourceId } = converted
  const base = {
    sessionId: meta.id,
    sourcePath,
    turns: turns.length,
    messages,
    toolCalls,
    skipped,
    skippedLines: skippedLines ?? [],
    permissions: summarizePermissions(typeCounts),
  }

  if (persisted.has(meta.id) && args.force !== true) {
    return { ...base, status: 'already-imported', alreadyImported: true }
  }
  let forceImported
  if (persisted.has(meta.id) && args.force === true) {
    const previous = meta.id
    const nextId = mintForceSessionId(persisted, previous)
    await archiveSession(ctx, previous)
    meta.id = nextId
    forceImported = { previous, current: nextId, archived: true }
  }

  await ctx.sessionPersistence.create(meta)
  await ctx.sessionPersistence.append(meta.id, events)
  const attached = await attachToWorkspace(ctx, meta)
  await rememberImport(ctx, sourceId ?? null, meta.id)
  persisted.add(meta.id)
  return {
    ...base,
    sessionId: meta.id,
    status: 'imported',
    workspace: { attached, ...(meta.cwd ? { path: meta.cwd } : {}) },
    ...(forceImported ? { forceImported } : {}),
  }
}

/**
 * 导入单个 transcript（F5-F7/F9/F10）：stat → 大小防护 → 读取 → 转换 → 落盘。
 * @param ctx - Cordis 上下文。
 * @param target - ctx.fs 目标。
 * @param args - 工具参数 `{ sessionId?, force? }`。
 * @param maxBytes - 单文件大小上限。
 * @param persisted - 已持久化 id 快照。
 * @param rawOverride - 已读取的原文（批量路径复用，避免双读）。
 * @returns 单文件统计。
 */
export async function importTranscript(ctx, target, args, maxBytes, persisted, rawOverride) {
  const sourcePath = target.displayPath || ctx.fs.processPath(target)
  const info = await ctx.fs.stat(target)
  if (info && typeof info.size === 'number' && info.size > maxBytes) {
    throw new Error(`transcript 过大（${info.size} 字节 > maxTranscriptBytes ${maxBytes}）：` +
      '请调高 maxTranscriptBytes 或单独处理该文件（S2 长度防护）')
  }
  const raw = rawOverride ?? await ctx.fs.readText(target)
  const converted = convertClaudeJsonl(raw, args.sessionId ? { sessionId: args.sessionId } : {})
  const result = await persistConverted(ctx, converted, args, persisted, sourcePath)
  result.secrets = scanSecrets(raw)
  return result
}

/** 递归收集目录下 .jsonl（按路径稳定排序），与上游 chat-import 一致。 */
async function collectJsonlFiles(ctx, dirTarget, out, recursive) {
  const entries = await ctx.fs.listDir(dirTarget)
  for (const entry of entries) {
    if (entry.type === 'directory') {
      if (recursive) await collectJsonlFiles(ctx, entry.target, out, recursive)
    } else if (entry.type === 'file' && /\.jsonl$/i.test(entry.name)) {
      out.push(entry.target)
    }
  }
}

/**
 * 批量导入（F8）：目录下每个 .jsonl 独立导入为会话，逐文件汇总。
 * @param ctx - Cordis 上下文。
 * @param dirTarget - 目录目标。
 * @param args - 工具参数 `{ recursive?, force? }`。
 * @param maxBytes - 单文件大小上限。
 * @returns `{ total, imported, alreadyImported, skipped, failed, results }`。
 */
export async function importDirectory(ctx, dirTarget, args, maxBytes) {
  const files = []
  await collectJsonlFiles(ctx, dirTarget, files, args.recursive !== false)
  files.sort((a, b) => a.displayPath.localeCompare(b.displayPath))
  const persisted = await listPersistedIds(ctx)
  const results = []
  let imported = 0
  let alreadyImported = 0
  let skipped = 0
  let failed = 0
  for (const target of files) {
    const pathLabel = target.displayPath || ctx.fs.processPath(target)
    try {
      const info = await ctx.fs.stat(target)
      if (info && typeof info.size === 'number' && info.size > maxBytes) {
        failed++
        results.push({
          path: pathLabel, status: 'failed',
          error: `transcript 过大（${info.size} 字节 > maxTranscriptBytes ${maxBytes}）`,
        })
        continue
      }
      const raw = await ctx.fs.readText(target)
      const converted = convertClaudeJsonl(raw, {})
      if (converted.turns.length === 0 && converted.events.length === 0) {
        skipped++
        results.push({ path: pathLabel, status: 'skipped', reason: 'not a Claude transcript (no user turns)' })
        continue
      }
      const single = await persistConverted(ctx, converted, { force: args.force }, persisted, pathLabel)
      if (single.status === 'imported') imported++
      else alreadyImported++
      results.push({ path: pathLabel, ...single, secrets: scanSecrets(raw) })
    } catch (err) {
      failed++
      results.push({ path: pathLabel, status: 'failed', error: String((err && err.message) || err) })
    }
  }
  return { total: files.length, imported, alreadyImported, skipped, failed, results }
}

const importResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: { type: 'string', required: true },
    sessionId: { type: 'string' },
    sourcePath: { type: 'string' },
    turns: { type: 'integer' },
    messages: { type: 'integer' },
    toolCalls: { type: 'integer' },
    skipped: { type: 'integer' },
    skippedLines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          line: { type: 'integer', required: true },
          error: { type: 'string', required: true },
        },
      },
    },
    secrets: { type: 'object', additionalProperties: true },
    permissions: { type: 'object', additionalProperties: true },
    alreadyImported: { type: 'boolean' },
    status: { type: 'string' },
    workspace: { type: 'object', additionalProperties: true },
    forceImported: { type: 'object', additionalProperties: true },
    total: { type: 'integer' },
    imported: { type: 'integer' },
    alreadyImported: { type: 'integer' },
    skipped: { type: 'integer' },
    failed: { type: 'integer' },
    results: { type: 'array' },
  },
}

/** import_claude 结果的模型可读摘要（含畸形行行号与密钥告警，不展示内容）。 */
export function renderImport(args, value) {
  const lines = []
  if (value.mode === 'batch') {
    lines.push(`批量导入完成：扫描 ${value.total} 个 .jsonl，`)
    const bits = []
    if (value.imported) bits.push(`新增 ${value.imported}`)
    if (value.alreadyImported) bits.push(`已存在 ${value.alreadyImported}`)
    if (value.skipped) bits.push(`跳过 ${value.skipped}`)
    if (value.failed) bits.push(`失败 ${value.failed}`)
    lines.push(bits.join('，') + '。')
    for (const r of value.results ?? []) {
      if (r.status === 'failed') lines.push(`- 失败：${r.path}（${r.error}）`)
      if (r.skippedLines?.length) {
        lines.push(`- ${r.path} 有 ${r.skipped} 行畸形记录，例如第 ${r.skippedLines[0].line} 行：${r.skippedLines[0].error}`)
      }
    }
  } else {
    lines.push(value.alreadyImported
      ? `会话 ${value.sessionId} 已导入，跳过（${value.turns} 轮、${value.toolCalls} 次工具调用）。` +
        (args?.force ? '' : ' 需要重建请用 force: true。')
      : `已导入 ${value.turns} 轮对话（${value.messages} 条消息、${value.toolCalls} 次工具调用）→ 会话 ${value.sessionId}。`)
    if (value.skipped) {
      lines.push(`跳过 ${value.skipped} 行畸形记录，明细见 skippedLines（前 ${value.skippedLines?.length ?? 0} 条含行号）。`)
    }
  }
  const secretTotal = value.mode === 'batch'
    ? (value.results ?? []).reduce((n, r) => n + (r.secrets?.total ?? 0), 0)
    : value.secrets?.total ?? 0
  if (secretTotal > 0) {
    lines.push(`⚠️ 检测到 ${secretTotal} 处疑似凭据片段（只报告位置，不展示内容）：`)
    const hits = value.mode === 'batch'
      ? (value.results ?? []).flatMap((r) => (r.secrets?.hits ?? []).slice(0, 5).map((h) => `${r.path}:${h.line}（${h.kind}）`))
      : (value.secrets?.hits ?? []).slice(0, 5).map((h) => `${h.line}（${h.kind}）`)
    for (const h of hits.slice(0, 5)) lines.push(`  - ${h}`)
  }
  const permTotal = value.mode === 'batch'
    ? (value.results ?? []).reduce((n, r) => n + (r.permissions?.total ?? 0), 0)
    : value.permissions?.total ?? 0
  if (permTotal > 0) {
    lines.push(`权限类记录 ${permTotal} 条未导入（permission/queue-operation）：见报告中的 DSH 权限迁移建议（S5）。`)
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

function makeImportTool(ctx, config) {
  const maxBytes = config.maxTranscriptBytes ?? DEFAULT_MAX_TRANSCRIPT_BYTES
  return defineTool({
    name: 'import_claude',
    description:
      '从 Claude Code 的 JSONL transcript 导入历史对话为可继续（resume）的 DSH 会话。' +
      "path 可以是单个 .jsonl、目录、'~/.claude/projects' 或 'all'（全量批量）。" +
      '全保真映射 user/assistant/tool/thinking 消息、合成平衡会话事件并持久化、按 cwd 挂接工作区；' +
      '同一源 sessionId 幂等跳过，force=true 归档旧导入后重建（新 id import-<src>-<n>）。' +
      '畸形行带行号上报、疑似凭据只报位置、权限类记录只统计不导入。返回单文件或批量逐文件汇总。',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: "Claude transcript (.jsonl) 路径、目录、'~/.claude/projects' 或 'all'（全量）。",
      },
      recursive: {
        type: 'boolean',
        description: '可选：目录模式是否递归子目录（默认 true）。',
      },
      sessionId: {
        type: 'string',
        description: '可选：目标 DSH 会话 id 覆盖（仅单文件；默认 import-<源sessionId>）。',
      },
      force: {
        type: 'boolean',
        description: '可选：true 时对已导入会话归档旧导入并以新 id 重建（默认 false）。',
      },
    },
    output: {
      schema: importResultSchema,
      render: renderImport,
    },
    async execute(args) {
      const claudeHome = config.claudeHome ? path.resolve(config.claudeHome) : locateClaudeHome()
      const targetPath = resolveImportTarget(args.path, claudeHome)
      const target = await ctx.fs.resolve(targetPath)
      const info = await ctx.fs.stat(target)
      if (info && info.type === 'directory') {
        const batch = await importDirectory(ctx, target, args, maxBytes)
        return { mode: 'batch', ...batch }
      }
      const persisted = await listPersistedIds(ctx)
      const single = await importTranscript(ctx, target, args, maxBytes, persisted)
      return { mode: 'single', ...single }
    },
  })
}

/**
 * 挂载插件：注册 claude_scan 与 import_claude 工具。
 * @param ctx - Cordis 上下文。
 * @param config - 经 Schemastery 校验的插件配置。
 */
export function apply(ctx, config = {}) {
  ctx.tools.register(makeScanTool(ctx, config))
  ctx.tools.register(makeImportTool(ctx, config))
}
