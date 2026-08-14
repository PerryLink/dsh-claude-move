// SPDX-License-Identifier: Apache-2.0
// index.mjs — dsh-claude-move host 插件入口。
//
// 已注册：claude_scan（F1-F4 + settings 翻译建议 F14）、import_claude（F5-F10/S4/S5）、
// memory/CLAUDE.md 系统提示词段（F11/F13，同步提供者 + mtime 缓存）、
// Claude 技能 provider（F12）、/claude-import-all 与 /resume-claude 命令（F15/F17）、
// /api/claude-move/* 面板 JSON 路由（F16）。
//
// 只消费公开服务：tools / systemPrompt / skills / sessionPersistence /
// workspaceRegistry（后两者经 ctx.get 可选读取）。源文件只读，缓存只写
// resolveCacheDir()。

import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  INDEX_VERSION,
  DEFAULT_MAX_TRANSCRIPT_BYTES,
  DEFAULT_GIT_TIMEOUT_MS,
  DEFAULT_SCAN_CONCURRENCY,
  locateClaudeHome,
  resolveCacheDir,
  loadCache,
  saveCache,
  loadImports,
  scanClaudeHome,
  scanProjectDir,
  scanTranscriptFile,
  resetCacheFiles,
} from './lib/discovery.mjs'
import { convertClaudeJsonl, mintSessionId, tailSessionEvents } from './lib/convert.mjs'
import { scanSecrets, summarizePermissions } from './lib/report.mjs'
import { makeFileCache, readMemoriesSync, renderMemories, renderClaudeMd, fileExists, selectMemoryDirs, DEFAULT_MEMORY_MAX_BYTES, DEFAULT_MEMORY_SCOPE } from './lib/context.mjs'
import { makeClaudeSkillsProvider } from './lib/skills-provider.mjs'
import { translateSettings } from './lib/settings.mjs'
import { buildHandoff, DEFAULT_HANDOFF_MAX_CHARS } from './lib/handoff.mjs'
import { importsStore } from './lib/imports-store.mjs'

export const name = 'claude-move'

export const inject = ['tools']

/** 批量导入「读取 + 转换」阶段的默认并发上限（落盘阶段保持串行，保证幂等确定性）。 */
export const DEFAULT_IMPORT_CONCURRENCY = 4

/**
 * 插件配置（cordis.yml 可覆盖，C4）。
 * @typedef {object} Config
 * @property {string} [claudeHome] Claude 数据根目录；缺省自动定位（$CLAUDE_CONFIG_DIR / ~/.claude）。
 * @property {boolean|'branch'} [scanGit] git 探测级别：true 全量（分支复用 transcript gitBranch，只跑 status 算脏行）、'branch' 零 git 子进程（只用 transcript 字段）、false 关闭（默认 true）。
 * @property {number} [gitTimeoutMs] git 子进程超时毫秒（默认 5000）。
 * @property {number} [scanConcurrency] 全量扫描的项目并发上限（默认 8）。
 * @property {number} [maxTranscriptBytes] transcript oversized 判定阈值（默认 64 MiB）。
 * @property {string[]} [excludeProjects] 排除的项目 slug（子串匹配，默认空）。
 * @property {boolean} [enableMemory] 注入 Claude memory 上下文段（默认 true）。
 * @property {number} [memoryMaxBytes] memory 注入字节上限（默认 8192）。
 * @property {'current-project'|'all'} [memoryScope] memory 注入范围：'current-project' 只注入当前会话 cwd 对应项目的记忆（无对应项目时回退全部），'all' 注入全部项目、当前项目优先（默认 'current-project'）。
 * @property {boolean} [enableSkills] 注册 Claude 技能 provider（默认 true）。
 * @property {number} [maxSkills] 技能目录条目上限（默认 30）。
 * @property {string[]} [extraSkillDirs] 额外技能目录（默认空）。
 * @property {boolean} [enableInstructions] 注入全局/项目级 CLAUDE.md 段（默认 true）。
 * @property {number} [resumeMaxChars] 续聊交接摘要字符上限（默认 2048）。
 * @property {'inject'|'agents'} [resumeMode] /resume-claude 的继续方式：'inject' 在当前会话注入交接摘要（默认），'agents' 尝试经 ctx.agents.resume 打开导入会话（服务缺失/失败回退注入）。
 * @property {boolean} [enableWebPanel] 注册面板 JSON 路由 /api/claude-move/*（默认 true）。
 * @property {number} [importConcurrency] 批量导入读取+转换并发上限（默认 4；落盘串行）。
 */

export const Config = Schema.object({
  claudeHome: Schema.string(),
  scanGit: Schema.union([Schema.boolean(), Schema.const('branch')]).default(true),
  gitTimeoutMs: Schema.number().default(DEFAULT_GIT_TIMEOUT_MS),
  scanConcurrency: Schema.number().default(DEFAULT_SCAN_CONCURRENCY),
  maxTranscriptBytes: Schema.number().default(DEFAULT_MAX_TRANSCRIPT_BYTES),
  excludeProjects: Schema.array(Schema.string()).default([]),
  enableMemory: Schema.boolean().default(true),
  memoryMaxBytes: Schema.number().default(DEFAULT_MEMORY_MAX_BYTES),
  memoryScope: Schema.union([Schema.const('current-project'), Schema.const('all')]).default(DEFAULT_MEMORY_SCOPE),
  enableSkills: Schema.boolean().default(true),
  maxSkills: Schema.number().default(30),
  extraSkillDirs: Schema.array(Schema.string()).default([]),
  enableInstructions: Schema.boolean().default(true),
  resumeMaxChars: Schema.number().default(DEFAULT_HANDOFF_MAX_CHARS),
  resumeMode: Schema.union([Schema.const('inject'), Schema.const('agents')]).default('inject'),
  enableWebPanel: Schema.boolean().default(true),
  importConcurrency: Schema.number().default(DEFAULT_IMPORT_CONCURRENCY),
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
 * @param signal - 可选 AbortSignal（工具 exec.signal）；中止时抛出 signal.reason。
 * @returns 结构化索引（session.import 已标注）。
 */
export async function runScan(ctx, config, args, signal) {
  const claudeHome = config.claudeHome ? path.resolve(config.claudeHome) : locateClaudeHome()
  const cacheDir = resolveCacheDir()
  const scanOpts = {
    maxBytes: config.maxTranscriptBytes ?? DEFAULT_MAX_TRANSCRIPT_BYTES,
    gitTimeoutMs: config.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
    scanGit: config.scanGit === undefined ? true : config.scanGit,
    concurrency: config.scanConcurrency ?? DEFAULT_SCAN_CONCURRENCY,
    ...(config.excludeProjects?.length ? { excludeProjects: config.excludeProjects } : {}),
    ...(signal ? { signal } : {}),
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
    const session = await scanTranscriptFile(target.target, { maxBytes: scanOpts.maxBytes, ...(signal ? { signal } : {}) })
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

  await annotateImports(ctx, cacheDir, index, target.kind === 'all')
  await annotateSettings(index)
  trimIndex(index, {
    ...(Number.isInteger(args?.projectsLimit) && args.projectsLimit > 0 ? { projectsLimit: args.projectsLimit } : {}),
    ...(Number.isInteger(args?.sessionsLimit) && args.sessionsLimit > 0 ? { sessionsLimit: args.sessionsLimit } : {}),
    fields: args?.fields === 'brief' ? 'brief' : 'full',
  })
  return index
}

/**
 * 索引裁剪（C4）：projectsLimit/sessionsLimit 截断项目与会话（超过时打
 * projectsTruncated/sessionsTruncated 标记）；fields='brief' 只保留定位与
 * 导入状态字段，减小模型上下文与 tool/result 日志体量。裁剪发生在缓存
 * 落盘与导入标注之后，不影响增量书签完整性。
 * @param index - 扫描索引（就地裁剪）。
 * @param options - `{ projectsLimit, sessionsLimit, fields }`。
 * @returns 裁剪后的索引。
 */
export function trimIndex(index, { projectsLimit, sessionsLimit, fields } = {}) {
  let projects = index.projects ?? []
  if (Number.isInteger(projectsLimit) && projectsLimit > 0 && projects.length > projectsLimit) {
    projects = projects.slice(0, projectsLimit)
    index.projectsTruncated = true
  }
  const sl = Number.isInteger(sessionsLimit) && sessionsLimit > 0 ? sessionsLimit : null
  index.projects = projects.map((project) => {
    if (sl === null || (project.sessions ?? []).length <= sl) return project
    return { ...project, sessions: project.sessions.slice(0, sl), sessionsTruncated: true }
  })
  if (fields === 'brief') {
    index.projects = index.projects.map((project) => {
      const brief = { slug: project.slug, dir: project.dir, dirExists: project.dirExists }
      if (project.cwd) brief.cwd = project.cwd
      if (project.git) brief.git = project.git
      if (project.sessionsTruncated) brief.sessionsTruncated = true
      brief.sessions = (project.sessions ?? []).map((s) => ({
        file: s.file,
        sessionId: s.sessionId,
        title: s.title,
        lastActivity: s.lastActivity,
        messages: s.messages,
        toolCalls: s.toolCalls,
        malformed: s.malformed,
        import: s.import,
      }))
      return brief
    })
  }
  return index
}

/**
 * 把全局与项目级 settings.json 翻译为 DSH 配置建议（F14）：只建议不代写，
 * 无法映射的键显式列出。读取失败单独记入 errors，不影响扫描。
 * @param index - 扫描索引（就地附加 settingsSuggestions）。
 */
export async function annotateSettings(index) {
  const files = []
  const globalSettings = index.personal?.settings
  if (globalSettings) files.push(globalSettings.path)
  for (const project of index.projects ?? []) {
    if (project.projectSettings) files.push(project.projectSettings.path)
  }
  const suggestions = []
  const unmapped = new Set()
  const errors = []
  for (const file of files) {
    let raw
    try {
      raw = await readFile(file, 'utf8')
    } catch (err) {
      errors.push(`${file}: ${String((err && err.message) || err)}`)
      continue
    }
    const result = translateSettings(raw, file)
    if (result.error) {
      errors.push(result.error)
      continue
    }
    suggestions.push(...result.suggestions)
    for (const key of result.unmapped) unmapped.add(key)
  }
  index.settingsSuggestions = { suggestions, unmapped: [...unmapped], errors }
}

/**
 * 用 sessionPersistence 列表 + imports 映射标注每个会话的导入状态（F4 幂等基础）。
 * 优先 `listSnapshots()`（更便宜的 header+revision 快照），回退 `list()`。
 * `cleanStale`（全量扫描时）惰性清理「映射指向已不存在会话」的残留记录并
 * 报告清理条数（B4：用户在 UI 删除导入会话后映射不再残留）。
 * @param ctx - Cordis 上下文。
 * @param cacheDir - 缓存目录。
 * @param index - 扫描索引（就地标注）。
 * @param cleanStale - 是否清理失效映射（仅全量扫描时信任快照完整性）。
 */
export async function annotateImports(ctx, cacheDir, index, cleanStale = false) {
  const imports = await loadImports(cacheDir)
  const sp = ctx.get('sessionPersistence')
  const imported = new Set()
  let listSucceeded = false
  if (sp) {
    try {
      if (typeof sp.listSnapshots === 'function') {
        for (const snap of await sp.listSnapshots()) imported.add(snap.header.id)
        listSucceeded = true
      } else if (typeof sp.list === 'function') {
        for (const header of await sp.list()) imported.add(header.id)
        listSucceeded = true
      }
    } catch {
      // 持久化不可读：全部按未导入处理，也不做清理。
      listSucceeded = false
    }
  }
  for (const project of index.projects ?? []) {
    for (const session of project.sessions ?? []) {
      // 幂等键 = 源文件路径（新格式）；sessionId 键保留为旧缓存回退。
      const dshId = unwrapImport(imports[session.file])?.dshId
        ?? unwrapImport(imports[session.sessionId])?.dshId
      if (dshId && imported.has(dshId)) {
        session.import = { status: 'imported', dshSessionId: dshId }
      } else if (session.error) {
        session.import = { status: 'source-missing' }
      } else {
        session.import = { status: 'none' }
      }
    }
  }
  if (cleanStale && listSucceeded) {
    let cleaned = 0
    for (const key of Object.keys(imports)) {
      const dshId = unwrapImport(imports[key])?.dshId
      if (dshId && !imported.has(dshId)) {
        delete imports[key]
        cleaned++
      }
    }
    if (cleaned > 0) {
      index.importsCleaned = cleaned
      try {
        await importsStore.update((current) => {
          for (const key of Object.keys(current)) {
            const dshId = unwrapImport(current[key])?.dshId
            if (dshId && !imported.has(dshId)) delete current[key]
          }
        })
      } catch (err) {
        console.error('[claude-move] imports cleanup failed:', String((err && err.message) || err))
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
  if (typeof value.importsCleaned === 'number' && value.importsCleaned > 0) {
    lines.push(`- 清理了 ${value.importsCleaned} 条失效导入映射（对应 DSH 会话已被删除）`)
  }
  if (typeof value.removedBookmarks === 'number' && value.removedBookmarks > 0) {
    lines.push(`- ${value.removedBookmarks} 个源 transcript 已删除（书签随扫描清理）`)
  }
  if (value.projectsTruncated || (value.projects ?? []).some((p) => p.sessionsTruncated)) {
    lines.push('- 索引已按 projectsLimit/sessionsLimit 裁剪（更多内容请调大上限或 fields=full）')
  }
  const suggestionCount = value.settingsSuggestions?.suggestions?.length ?? 0
  const unmappedCount = value.settingsSuggestions?.unmapped?.length ?? 0
  if (suggestionCount > 0 || unmappedCount > 0) {
    lines.push(`- settings.json 翻译建议 ${suggestionCount} 条、无法映射项 ${unmappedCount} 条（见 settingsSuggestions）`)
  }
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

function makeScanTool(ctx, config, state) {
  return defineTool({
    name: 'claude_scan',
    description:
      '扫描本机 Claude Code 数据：自动定位数据根目录（$CLAUDE_CONFIG_DIR 或 ~/.claude），' +
      '索引全部项目/会话（标题、起止时间、消息与工具调用数）、目录与 git 状态，以及' +
      '记忆、技能、全局 CLAUDE.md 与 settings.json。返回结构化 JSON 索引；' +
      'path 可收窄到 projects 目录、单个项目目录、单个 .jsonl 或任意含 .jsonl 的目录，' +
      'refresh=true 跳过增量缓存全量重扫，projectsLimit/sessionsLimit/fields 裁剪输出体量。' +
      '导入历史请用 import_claude。',
    parameters: {
      path: {
        type: 'string',
        description: "可选：'all'（默认全量）、'~/.claude/projects'、单个项目目录、单个 .jsonl 文件，或任意含 .jsonl 的目录。",
      },
      refresh: {
        type: 'boolean',
        description: '可选：true 时忽略增量缓存，全量重扫（默认 false）。',
      },
      projectsLimit: {
        type: 'integer',
        description: '可选：最多返回的项目数（按最近活动排序取前 N，默认全量）。',
      },
      sessionsLimit: {
        type: 'integer',
        description: '可选：每个项目最多返回的会话数（默认全量）。',
      },
      fields: {
        type: 'string',
        enum: ['brief', 'full'],
        description: "可选：'brief' 只返回定位与导入状态字段（减小上下文），默认 'full'。",
      },
    },
    output: {
      schema: scanIndexSchema,
      render: renderScan,
    },
    async execute(args, exec) {
      const value = await runScan(ctx, config, args, exec?.signal)
      state?.invalidateSkills?.()
      return value
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
  const sp = ctx.get('sessionPersistence')
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
 * 把导入的会话挂到其 cwd 对应的工作区（否则显示为「未分组」，F9）。
 * 迁移是复制式的：只新建/复用工作区并挂接，绝不移动或删除任何现有内容。
 * @param ctx - Cordis 上下文。
 * @param meta - SessionHeader。
 * @returns `{ attached, reason? }`；目录不存在/无 workspaceRegistry 时 attached=false。
 */
export async function attachToWorkspace(ctx, meta) {
  if (!meta.cwd) return { attached: false, reason: 'no-cwd' }
  const wr = ctx.get('workspaceRegistry')
  if (!wr || typeof wr.resolveByPath !== 'function') {
    return { attached: false, reason: 'workspace-registry-unavailable' }
  }
  try {
    let ws = await wr.resolveByPath(meta.cwd)
    if (!ws) ws = await wr.create(meta.cwd)
    await ws.attachSession(meta.id)
    return { attached: true }
  } catch (err) {
    console.error('[claude-move] workspace attach failed:', String((err && err.message) || err))
    return { attached: false, reason: String((err && err.message) || err) }
  }
}

/**
 * 记录 源文件路径 → 导入记录（增量缓存目录 imports.json，F4/F7 基础）。
 * 记录形如 `{ dshId, turns, events, sizeBytes, mtimeMs }`：幂等跳过与增量续写
 * 都依赖它；按文件路径为键：多个源文件可能共享同一源 sessionId（Claude
 * 子会话等），按 sessionId 去重会静默丢弃后导入文件的历史。
 * 写入经 importsStore 串行化 + 原子写：与模型工具/命令/面板 job 的并发
 * 读-改-写互不覆盖。
 * @param ctx - Cordis 上下文（保留签名兼容，当前不再读取）。
 * @param key - 源 transcript 绝对路径；缺失则跳过。
 * @param record - `{ dshId, turns, events, sizeBytes, mtimeMs }`。
 */
export async function rememberImport(ctx, key, record) {
  if (typeof key !== 'string' || key.length === 0) return
  try {
    await importsStore.update((imports) => {
      imports[key] = record
    })
  } catch (err) {
    console.error('[claude-move] remember import failed:', String((err && err.message) || err))
  }
}

/** 兼容旧格式（纯字符串 dshId）读取导入记录。 */
function unwrapImport(entry) {
  if (typeof entry === 'string') return { dshId: entry }
  if (entry && typeof entry === 'object') return entry
  return null
}

/** 读取已存储日志的事件数（服务支持 readFrom 时）；不可用返回 null。 */
async function storedEventCount(ctx, dshId) {
  const sp = ctx.get('sessionPersistence')
  if (!sp || typeof sp.readFrom !== 'function') return null
  try {
    const read = await sp.readFrom(dshId, 0)
    return Array.isArray(read?.events) ? read.events.length : null
  } catch {
    return null
  }
}

/**
 * 幂等落盘一份已转换会话（F5-F7/F9）。幂等键 = 源文件路径（imports.json）。
 * 复制式语义，绝不删除/改写既有内容：
 * - 首次导入：目标 id 由「显式 sessionId > 源 sessionId > 文件名 slug」确定，
 *   若目标 id 已被占用则后缀避让（import-<src>-<n>），绝不静默丢弃历史；
 *   落盘 = create + append（append-only），随后按 cwd 挂接工作区。
 * - 重复导入且源文件已增长（turns 变多）：把新增轮次以连续 seq 续写到同一
 *   DSH 会话（增量同步），旧事件一个字节不动。
 * - force：为同一源文件创建一份**新的**完整副本（新 id），旧副本原样保留。
 *   不再归档任何会话——归档会从全部界面隐藏历史，与复制式迁移冲突。
 * @param ctx - Cordis 上下文。
 * @param converted - convertClaudeJsonl 输出。
 * @param args - 工具参数 `{ sessionId?, force? }`。
 * @param persisted - 已持久化 id 快照（就地更新）。
 * @param sourcePath - 源 transcript 绝对路径（幂等键 + 报告用）。
 * @param source - 源文件本次 stat 信息 `{ sizeBytes?, mtimeMs? }`。
 * @returns 单文件统计。
 */
export async function persistConverted(ctx, converted, args, persisted, sourcePath, source = {}) {
  // 同一源文件并发导入互斥：后到者等先行者落盘后重跑，按幂等路径复用结果
  // （否则 create duplicate 会被记为 failed，且 imports.json 会被并发覆盖）。
  return importsStore.exclusive(sourcePath, () =>
    persistConvertedInner(ctx, converted, args, persisted, sourcePath, source))
}

/** 探测同名持久化会话是否为空日志（上次 create 成功、append 失败残留）；无法确定返回 false。 */
async function isEmptyStoredSession(ctx, dshId) {
  const sp = ctx.get('sessionPersistence')
  if (!sp || typeof sp.readFrom !== 'function') return false
  try {
    const read = await sp.readFrom(dshId, 0)
    return Array.isArray(read?.events) && read.events.length === 0
  } catch {
    // 读不到/读失败：按「非空」处理，走保守路径。
    return false
  }
}

async function persistConvertedInner(ctx, converted, args, persisted, sourcePath, source = {}) {
  const { meta, events, turns, messages, toolCalls, skipped, skippedLines, typeCounts, sourceId } = converted

  // 源 sessionId 缺失时用文件名 slug 保证目标 id 跨运行稳定（否则 mintSessionId
  // 回退 Date.now，重复导入不再幂等）。
  if (!args?.sessionId && !sourceId) {
    meta.id = mintSessionId(path.basename(sourcePath).replace(/\.jsonl$/i, ''))
  }

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

  const cacheDir = resolveCacheDir()
  const imports = await loadImports(cacheDir)
  const known = unwrapImport(imports[sourcePath])
  const knownId = known?.dshId

  // ── 已导入过：增量续写 / force 新副本 / 幂等跳过 ─────────────────────────
  if (knownId && persisted.has(knownId)) {
    if (args.force === true) {
      // 复制式 force：旧副本原样保留，新建一份完整副本。
      const nextId = mintForceSessionId(persisted, knownId)
      const nextMeta = { ...meta, id: nextId }
      await spPersist(ctx, nextMeta, events)
      persisted.add(nextId)
      const attached = await attachToWorkspace(ctx, nextMeta)
      await rememberImport(ctx, sourcePath, {
        dshId: nextId, turns: turns.length, events: events.length,
        sizeBytes: source.sizeBytes, mtimeMs: source.mtimeMs,
      })
      return {
        ...base,
        sessionId: nextId,
        status: 'imported',
        workspace: { ...attached, ...(meta.cwd ? { path: meta.cwd } : {}) },
        forceImported: { previous: knownId, current: nextId, archived: false },
      }
    }

    if (typeof known.turns === 'number' && turns.length > known.turns) {
      // 增量：把源文件新增轮次续写到同一 DSH 会话。
      let fromSeq = typeof known.events === 'number' ? known.events : await storedEventCount(ctx, knownId)
      if (typeof fromSeq !== 'number') {
        // 无法确定存储日志长度：保守跳过，绝不冒险 append 错误 seq。
        return { ...base, sessionId: knownId, status: 'already-imported', appendedSkipped: 'stored-length-unknown' }
      }
      const tail = tailSessionEvents(converted, { fromTurn: known.turns + 1, fromSeq })
      if (tail.events.length > 0) {
        const sp = ctx.get('sessionPersistence')
        if (!sp || typeof sp.append !== 'function') {
          throw new Error('会话持久化服务（sessionPersistence）不可用：claude-move 增量续写需要该服务')
        }
        await sp.append(knownId, tail.events)
      }
      await rememberImport(ctx, sourcePath, {
        dshId: knownId, turns: turns.length, events: fromSeq + tail.events.length,
        sizeBytes: source.sizeBytes, mtimeMs: source.mtimeMs,
      })
      return {
        ...base,
        sessionId: knownId,
        status: 'appended',
        appendedTurns: turns.length - known.turns,
        appendedEvents: tail.events.length,
      }
    }

    if (typeof known.events === 'number' && events.length > known.events) {
      // 源文件在既有轮次内新增内容（导入时该轮尚未完成）：append-only 不能
      // 改写已落盘轮次，保守保留已导入快照；下一轮完成后会按整轮续写。
      return { ...base, sessionId: knownId, status: 'already-imported', alreadyImported: true, changedInPlace: true }
    }

    return {
      ...base,
      sessionId: knownId,
      status: 'already-imported',
      alreadyImported: true,
      ...(typeof known.turns === 'number' && turns.length < known.turns
        ? { sourceShrunk: true }
        : {}),
    }
  }

  // ── 首次导入（或源文件从未成功落盘） ─────────────────────────────────────
  if (persisted.has(meta.id)) {
    // 半建残留恢复（A5）：同名会话日志为空（上次 create 成功、append 失败）
    // → 复用原 id 直接 append 补全，不另建副本；无法确认时后缀避让。
    if (await isEmptyStoredSession(ctx, meta.id)) {
      await spAppend(ctx, meta.id, events)
      persisted.add(meta.id)
      const attached = await attachToWorkspace(ctx, meta)
      await rememberImport(ctx, sourcePath, {
        dshId: meta.id, turns: turns.length, events: events.length,
        sizeBytes: source.sizeBytes, mtimeMs: source.mtimeMs,
      })
      return {
        ...base,
        sessionId: meta.id,
        status: 'imported',
        recoveredHalfCreated: true,
        workspace: { ...attached, ...(meta.cwd ? { path: meta.cwd } : {}) },
      }
    }
    // 目标 id 被其它源文件占用（同源 sessionId）：后缀避让，保留双方历史。
    meta.id = mintForceSessionId(persisted, meta.id)
  }
  await spPersist(ctx, meta, events)
  persisted.add(meta.id)
  const attached = await attachToWorkspace(ctx, meta)
  await rememberImport(ctx, sourcePath, {
    dshId: meta.id, turns: turns.length, events: events.length,
    sizeBytes: source.sizeBytes, mtimeMs: source.mtimeMs,
  })
  return {
    ...base,
    sessionId: meta.id,
    status: 'imported',
    workspace: { ...attached, ...(meta.cwd ? { path: meta.cwd } : {}) },
  }
}

/** append 一份事件批次；服务缺失响亮抛出。 */
async function spAppend(ctx, id, events) {
  const sp = ctx.get('sessionPersistence')
  if (!sp || typeof sp.append !== 'function') {
    throw new Error('会话持久化服务（sessionPersistence）不可用：claude-move 导入需要该服务')
  }
  await sp.append(id, events)
}

/** create + append 一份完整会话日志；服务缺失/落盘失败响亮抛出。 */
async function spPersist(ctx, meta, events) {
  const sp = ctx.get('sessionPersistence')
  if (!sp || typeof sp.create !== 'function' || typeof sp.append !== 'function') {
    throw new Error('会话持久化服务（sessionPersistence）不可用：claude-move 导入需要该服务')
  }
  await sp.create(meta)
  await sp.append(meta.id, events)
}

/**
 * 获取文件系统服务（可选依赖，经 ctx.get 查询；缺失响亮失败）。
 * Cordis 未声明 inject 的服务不能直接读 ctx.fs 属性（"cannot get property
 * without inject"），工具/命令/路由统一走这里。
 * @param ctx - Cordis 上下文。
 * @returns FileSystem 服务。
 */
export function requireFs(ctx) {
  const fs = ctx.get('fs')
  if (!fs || typeof fs.resolve !== 'function') {
    throw new Error('文件系统服务（ctx.fs）不可用：claude-move 的导入/扫描需要 fs 服务')
  }
  return fs
}

/**
 * 导入单个 transcript（F5-F7/F9/F10）：stat → 大小防护 → 读取 → 转换 → 落盘。
 * @param ctx - Cordis 上下文。
 * @param target - ctx.fs 目标。
 * @param args - 工具参数 `{ sessionId?, force? }`。
 * @param maxBytes - 单文件大小上限。
 * @param persisted - 已持久化 id 快照。
 * @param rawOverride - 已读取的原文（批量路径复用，避免双读）。
 * @param signal - 可选 AbortSignal（工具 exec.signal）；中止时抛出 signal.reason。
 * @returns 单文件统计。
 */
export async function importTranscript(ctx, target, args, maxBytes, persisted, rawOverride, signal) {
  const fs = requireFs(ctx)
  signal?.throwIfAborted()
  const sourcePath = target.displayPath || fs.processPath(target)
  const info = await fs.stat(target)
  if (info && typeof info.size === 'number' && info.size > maxBytes) {
    throw new Error(`transcript 过大（${info.size} 字节 > maxTranscriptBytes ${maxBytes}）：` +
      '请调高 maxTranscriptBytes 或单独处理该文件（S2 长度防护）')
  }
  signal?.throwIfAborted()
  const raw = rawOverride ?? await fs.readText(target)
  signal?.throwIfAborted()
  const converted = convertClaudeJsonl(raw, args.sessionId ? { sessionId: args.sessionId } : {})
  const result = await persistConverted(ctx, converted, args, persisted, sourcePath, {
    sizeBytes: info && typeof info.size === 'number' ? info.size : undefined,
    mtimeMs: info && typeof info.mtimeMs === 'number' ? info.mtimeMs : undefined,
  })
  result.secrets = scanSecrets(raw)
  return result
}

/** 递归收集目录下 .jsonl（按路径稳定排序），与上游 chat-import 一致。 */
async function collectJsonlFiles(ctx, dirTarget, out, recursive) {
  const fs = requireFs(ctx)
  const entries = await fs.listDir(dirTarget)
  for (const entry of entries) {
    if (entry.type === 'directory') {
      if (recursive) await collectJsonlFiles(ctx, entry.target, out, recursive)
    } else if (entry.type === 'file' && /\.jsonl$/i.test(entry.name)) {
      out.push(entry.target)
    }
  }
}

/** 有上限的并发执行器：并发跑 `worker`，全部 settle 后返回。 */
async function runPool(workerCount, worker) {
  await Promise.all(Array.from({ length: Math.max(1, workerCount) }, () => worker()))
}

/**
 * 批量导入（F8）：目录下每个 .jsonl 独立导入为会话，逐文件汇总。
 * 两阶段设计：先按 `concurrency` 并发完成「读取 + 转换」（IO/CPU 密集、
 * 幂等无关），再按文件名序**串行落盘**（id 后缀避让与 imports.json 映射
 * 依赖顺序，保证确定性）。任何文件失败只记入结果，不中断批量；
 * `signal` 中止则整体抛出 signal.reason。
 * @param ctx - Cordis 上下文。
 * @param dirTarget - 目录目标。
 * @param args - 工具参数 `{ recursive?, force? }`。
 * @param maxBytes - 单文件大小上限。
 * @param onProgress - 每个文件处理完后的进度回调（面板轮询用），可选。
 * @param concurrency - 读取+转换并发上限（默认 DEFAULT_IMPORT_CONCURRENCY）。
 * @param signal - 可选 AbortSignal（工具 exec.signal）。
 * @returns `{ total, imported, alreadyImported, appended, skipped, failed, results }`。
 */
export async function importDirectory(ctx, dirTarget, args, maxBytes, onProgress, concurrency = DEFAULT_IMPORT_CONCURRENCY, signal) {
  const fs = requireFs(ctx)
  const files = []
  await collectJsonlFiles(ctx, dirTarget, files, args.recursive !== false)
  files.sort((a, b) => a.displayPath.localeCompare(b.displayPath))
  const persisted = await listPersistedIds(ctx)
  const results = new Array(files.length)
  let imported = 0
  let alreadyImported = 0
  let appended = 0
  let skipped = 0
  let failed = 0
  const notify = () => {
    if (typeof onProgress === 'function') {
      onProgress({
        total: files.length, imported, alreadyImported, appended, skipped, failed,
        results: results.filter((r) => r !== undefined),
      })
    }
  }

  // 阶段一：并发读取 + 转换。
  const limit = Number.isInteger(concurrency) && concurrency > 0 ? concurrency : DEFAULT_IMPORT_CONCURRENCY
  const prepared = new Array(files.length)
  let cursor = 0
  await runPool(Math.min(limit, files.length), async () => {
    for (;;) {
      const i = cursor++
      if (i >= files.length) return
      signal?.throwIfAborted()
      const target = files[i]
      const pathLabel = target.displayPath || fs.processPath(target)
      try {
        const info = await fs.stat(target)
        if (info && typeof info.size === 'number' && info.size > maxBytes) {
          prepared[i] = {
            pathLabel, status: 'failed',
            error: `transcript 过大（${info.size} 字节 > maxTranscriptBytes ${maxBytes}）`,
          }
          continue
        }
        const raw = await fs.readText(target)
        signal?.throwIfAborted()
        const converted = convertClaudeJsonl(raw, {})
        if (converted.turns.length === 0 && converted.events.length === 0) {
          prepared[i] = { pathLabel, status: 'skipped', reason: 'not a Claude transcript (no user turns)' }
          continue
        }
        prepared[i] = {
          pathLabel, raw, converted,
          source: {
            sizeBytes: info && typeof info.size === 'number' ? info.size : undefined,
            mtimeMs: info && typeof info.mtimeMs === 'number' ? info.mtimeMs : undefined,
          },
        }
      } catch (err) {
        if (signal?.aborted) throw signal.reason ?? err
        prepared[i] = { pathLabel, status: 'failed', error: String((err && err.message) || err) }
      }
    }
  })

  // 阶段二：按序串行落盘。
  for (let i = 0; i < files.length; i++) {
    signal?.throwIfAborted()
    const p = prepared[i]
    if (p.status === 'failed') {
      failed++
      results[i] = { path: p.pathLabel, status: 'failed', error: p.error }
    } else if (p.status === 'skipped') {
      skipped++
      results[i] = { path: p.pathLabel, status: 'skipped', reason: p.reason }
    } else {
      try {
        const single = await persistConverted(ctx, p.converted, { force: args.force }, persisted, p.pathLabel, p.source)
        if (single.status === 'imported') imported++
        else if (single.status === 'appended') appended++
        else alreadyImported++
        results[i] = { path: p.pathLabel, ...single, secrets: scanSecrets(p.raw) }
      } catch (err) {
        failed++
        results[i] = { path: p.pathLabel, status: 'failed', error: String((err && err.message) || err) }
      }
    }
    notify()
  }
  return { total: files.length, imported, alreadyImported, appended, skipped, failed, results }
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
    appendedTurns: { type: 'integer' },
    appendedEvents: { type: 'integer' },
    appendedSkipped: { type: 'string' },
    sourceShrunk: { type: 'boolean' },
    changedInPlace: { type: 'boolean' },
    recoveredHalfCreated: { type: 'boolean' },
    workspace: { type: 'object', additionalProperties: true },
    forceImported: { type: 'object', additionalProperties: true },
    total: { type: 'integer' },
    imported: { type: 'integer' },
    alreadyImported: { type: 'integer' },
    appended: { type: 'integer' },
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
    if (value.appended) bits.push(`增量续写 ${value.appended}`)
    if (value.alreadyImported) bits.push(`已存在 ${value.alreadyImported}`)
    if (value.skipped) bits.push(`跳过 ${value.skipped}`)
    if (value.failed) bits.push(`失败 ${value.failed}`)
    lines.push(bits.join('，') + '。')
    for (const r of value.results ?? []) {
      if (r.status === 'failed') lines.push(`- 失败：${r.path}（${r.error}）`)
      if (r.status === 'appended') lines.push(`- ${r.path} 增量续写 ${r.appendedTurns} 轮（${r.sessionId}）`)
      if (r.sourceShrunk) lines.push(`- ${r.path} 源文件轮次少于已导入记录（可能被重置/截断），需要完整重导请用 force: true。`)
      if (r.changedInPlace) lines.push(`- ${r.path} 在已导入轮次内新增内容（导入时该轮尚未完成）：保留已导入快照，下一轮完成后自动续写；需要当前完整快照请用 force: true。`)
      if (r.skippedLines?.length) {
        lines.push(`- ${r.path} 有 ${r.skipped} 行畸形记录，例如第 ${r.skippedLines[0].line} 行：${r.skippedLines[0].error}`)
      }
    }
  } else {
    if (value.status === 'appended') {
      lines.push(`会话 ${value.sessionId} 增量续写 ${value.appendedTurns} 轮（累计 ${value.turns} 轮）。`)
    } else {
      lines.push(value.alreadyImported
        ? `会话 ${value.sessionId} 已导入，跳过（${value.turns} 轮、${value.toolCalls} 次工具调用）。` +
          (args?.force ? '' : ' 需要完整重导请用 force: true（旧副本保留，生成新会话）。')
        : `已导入 ${value.turns} 轮对话（${value.messages} 条消息、${value.toolCalls} 次工具调用）→ 会话 ${value.sessionId}。`)
      if (value.sourceShrunk) {
        lines.push('源文件轮次少于已导入记录（可能被重置/截断）；旧副本保留，需要完整重导请用 force: true。')
      }
      if (value.changedInPlace) {
        lines.push('源文件在已导入轮次内新增内容（导入时该轮尚未完成）：保留已导入快照，下一轮完成后自动续写；需要当前完整快照请用 force: true。')
      }
      if (value.recoveredHalfCreated) {
        lines.push('检测到上次中断残留的空会话，已复用原 id 补全（未另建副本）。')
      }
    }
    if (value.skipped) {
      lines.push(`跳过 ${value.skipped} 行畸形记录，明细见 skippedLines（前 ${value.skippedLines?.length ?? 0} 条含行号）。`)
    }
    if (value.workspace && value.workspace.attached === false) {
      lines.push(`未挂接工作区：${value.workspace.reason ?? '未知原因'}（会话仍已导入，可在会话列表中打开）。`)
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
      '从 Claude Code 的 JSONL transcript 复制导入历史对话为可继续（resume）的 DSH 会话。' +
      "path 可以是单个 .jsonl、目录、'~/.claude/projects' 或 'all'（全量批量）。" +
      '全保真映射 user/assistant/tool/thinking 消息、合成平衡会话事件并持久化、按 cwd 挂接对应工作区；' +
      '迁移是复制式的：绝不删除源文件，也绝不删除/改写 DSH 既有会话。' +
      '重复导入同一文件时自动增量续写新增轮次；force=true 为该源文件创建一份新的完整副本（新 id import-<src>-<n>），旧副本原样保留。' +
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
        description: '可选：true 时忽略幂等，为该源文件新建一份完整副本（新 id import-<src>-<n>，默认 false）。旧副本与 DSH 既有历史一律保留，绝不归档或删除。',
      },
    },
    output: {
      schema: importResultSchema,
      render: renderImport,
    },
    async execute(args, exec) {
      const fs = requireFs(ctx)
      const claudeHome = config.claudeHome ? path.resolve(config.claudeHome) : locateClaudeHome()
      const targetPath = resolveImportTarget(args.path, claudeHome)
      const target = await fs.resolve(targetPath)
      exec?.signal?.throwIfAborted()
      const info = await fs.stat(target)
      if (info && info.type === 'directory') {
        const batch = await importDirectory(
          ctx, target, args, maxBytes, undefined,
          config.importConcurrency ?? DEFAULT_IMPORT_CONCURRENCY,
          exec?.signal,
        )
        return { mode: 'batch', ...batch }
      }
      exec?.signal?.throwIfAborted()
      const persisted = await listPersistedIds(ctx)
      const single = await importTranscript(ctx, target, args, maxBytes, persisted, undefined, exec?.signal)
      return { mode: 'single', ...single }
    },
  })
}

// ── 个人信息搬移（F11-F13）：同步注入 + 技能 provider ────────────────────────

/**
 * 可选服务就绪即调用：apply 时已存在则立即调用；否则订阅 cordis 的
 * `internal/service` 事件，服务出现时再调用（避免插件先于服务加载的竞态，
 * 同时不在 headless 等无该服务的 profile 里保持 PENDING）。
 * @param ctx - Cordis 上下文。
 * @param name - 服务名。
 * @param fn - 服务就绪回调。
 */
export function withService(ctx, name, fn) {
  const existing = ctx.get(name)
  if (existing !== undefined && existing !== null) {
    fn(existing)
    return
  }
  const off = ctx.on('internal/service', (serviceName) => {
    if (serviceName !== name) return
    const service = ctx.get(name)
    if (service !== undefined && service !== null) {
      off()
      fn(service)
    }
  })
}

/**
 * 插件状态：Claude 根目录、同步文件缓存、技能目录失效回调。
 * @param config - 插件配置。
 * @returns 状态对象（apply 闭包持有）。
 */
export function makeClaudeState(config = {}) {
  return {
    claudeHome: config.claudeHome ? path.resolve(config.claudeHome) : locateClaudeHome(),
    fileCache: makeFileCache(),
    memoryDirCache: null,
    indexMapCache: null,
    invalidateSkills: null,
  }
}

/**
 * 从扫描书签缓存（index.json）定位当前会话 cwd 对应的 memory 目录（B3）。
 * 书签按 mtime/ctime 缓存，解析出的 cwd→项目目录映射同缓存；无缓存/无
 * 对应项目返回 null（注入层回退全部目录保底）。Windows 路径大小写不敏感。
 * @param state - 插件状态。
 * @param cwd - 当前会话工作目录。
 * @returns memory 目录绝对路径或 null。
 */
export function cwdMemoryDirSync(state, cwd) {
  if (!state || typeof cwd !== 'string' || cwd.length === 0) return null
  const cachePath = path.join(resolveCacheDir(), 'index.json')
  let st
  try {
    st = statSync(cachePath)
    if (!st.isFile()) return null
  } catch {
    // 无书签缓存：返回 null（回退全部目录）。
    return null
  }
  if (!state.indexMapCache
    || state.indexMapCache.mtimeMs !== st.mtimeMs
    || state.indexMapCache.ctimeMs !== st.ctimeMs) {
    let parsed
    try {
      parsed = JSON.parse(readFileSync(cachePath, 'utf8'))
    } catch {
      // 损坏缓存：按无缓存处理。
      return null
    }
    const map = new Map()
    for (const [file, header] of Object.entries(parsed?.files ?? {})) {
      if (header && typeof header.cwd === 'string' && typeof file === 'string') {
        const key = process.platform === 'win32' ? header.cwd.toLowerCase() : header.cwd
        if (!map.has(key)) map.set(key, path.dirname(file))
      }
    }
    state.indexMapCache = { mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, map }
  }
  const key = process.platform === 'win32' ? cwd.toLowerCase() : cwd
  const dir = state.indexMapCache.map.get(key)
  return dir ? path.join(dir, 'memory') : null
}

/**
 * 平台感知的路径相等（Windows 大小写不敏感）。
 * @param a - 路径一。
 * @param b - 路径二。
 * @returns boolean。
 */
export function samePath(a, b) {
  const norm = (x) => path.resolve(x)
  if (process.platform === 'win32') return norm(a).toLowerCase() === norm(b).toLowerCase()
  return norm(a) === norm(b)
}

/**
 * 枚举全部 memory 目录（同步，按 projects 目录 mtime 缓存）。
 * F11 注入全部项目的 memory 并按类型优先级排序，由字节上限控制总量。
 * @param state - 插件状态。
 * @returns memory 目录绝对路径数组。
 */
export function memoryDirsSync(state) {
  const projectsDir = path.join(state.claudeHome, 'projects')
  try {
    const st = statSync(projectsDir)
    if (state.memoryDirCache && state.memoryDirCache.mtimeMs === st.mtimeMs && state.memoryDirCache.ctimeMs === st.ctimeMs) {
      return state.memoryDirCache.dirs
    }
    const dirs = readdirSync(projectsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(projectsDir, e.name, 'memory'))
      .filter((d) => fileExists(d))
    state.memoryDirCache = { mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, dirs }
    return dirs
  } catch {
    // 无 projects 目录：无记忆。
    return []
  }
}

/**
 * 注册 F11/F12/F13 三组贡献（服务缺失时按可选依赖跳过）。
 * @param ctx - Cordis 上下文。
 * @param config - 插件配置。
 * @param state - 插件状态。
 */
export function registerContextContributions(ctx, config, state) {
  withService(ctx, 'systemPrompt', (systemPrompt) => {
    // F11：memory 动态上下文段（同步提供者 + mtime 缓存，每次请求重读变化文件）。
    if (config.enableMemory !== false && typeof systemPrompt.context === 'function') {
      systemPrompt.context({
        name: 'claude-move:memory',
        order: 120,
        text: (assemble) => {
          const cwd = assemble?.agent?.session?.header?.cwd
          const dirs = memoryDirsSync(state)
          const currentDir = typeof cwd === 'string' && cwd.length > 0 ? cwdMemoryDirSync(state, cwd) : null
          const selected = selectMemoryDirs(dirs, currentDir, config.memoryScope ?? DEFAULT_MEMORY_SCOPE)
          const memories = selected.flatMap((dir) => readMemoriesSync(dir, state.fileCache))
          return renderMemories(memories, config.memoryMaxBytes ?? DEFAULT_MEMORY_MAX_BYTES)
        },
      })
    }

    // F13：全局 + 项目级 CLAUDE.md（项目优先，前置于 persona）。
    if (config.enableInstructions !== false && typeof systemPrompt.section === 'function') {
      systemPrompt.section({
        name: 'claude-move:instructions',
        order: -90,
        text: (assemble) => {
          const cwd = assemble?.agent?.session?.header?.cwd
          const globalPath = path.join(state.claudeHome, 'CLAUDE.md')
          const globalText = fileExists(globalPath) ? state.fileCache.read(globalPath) : null
          const projectPath = typeof cwd === 'string' && cwd.length > 0
            ? path.join(cwd, '.claude', 'CLAUDE.md')
            : null
          const projectText = projectPath && fileExists(projectPath) ? state.fileCache.read(projectPath) : null
          return renderClaudeMd(projectText, globalText)
        },
      })
    }
  })

  // F12：Claude 技能 provider（async list/get；扫描后失效目录缓存）。
  withService(ctx, 'skills', (skills) => {
    if (config.enableSkills !== false && typeof skills.registerProvider === 'function') {
      const roots = [path.join(state.claudeHome, 'skills'), ...(config.extraSkillDirs ?? [])]
      skills.registerProvider((control) => {
        state.invalidateSkills = () => control.invalidate()
        return makeClaudeSkillsProvider({ roots, maxSkills: config.maxSkills ?? 30 })
      })
    }
  })
}

// ── 人机命令（F15/F17）───────────────────────────────────────────────────────

/**
 * 把上下文注入当前会话（模型可见 ⟺ 落盘：inject 走 inbox，随日志持久化）。
 * @param agent - CommandInvocation.agent。
 * @param text - 注入文本。
 * @returns 是否注入成功。
 */
export function injectContext(agent, text) {
  if (!agent || typeof agent.inject !== 'function') return false
  try {
    agent.inject({
      id: 'claude-move:' + randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'claude-move' },
    })
    return true
  } catch {
    // 会话已销毁等：注入失败不阻断命令结果。
    return false
  }
}

/**
 * 解析 /resume-claude 引用：latest/空 → 最近会话；会话ID（源 id 或 import-<src>）
 * 精确匹配；关键词匹配标题或源 id（多个命中列候选，绝不猜测）。
 * @param index - runScan 输出的索引（已标注 import 状态）。
 * @param ref - 命令输入。
 * @returns `{ kind: 'one', session }` | `{ kind: 'many', candidates }` | `{ kind: 'none' }`。
 */
export function resolveResumeTarget(index, ref) {
  const sessions = (index.projects ?? [])
    .flatMap((p) => p.sessions ?? [])
    .filter((s) => !s.error)
    .sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0))
  const trimmed = (ref ?? '').trim()
  if (trimmed.length === 0 || trimmed === 'latest') {
    return sessions[0] ? { kind: 'one', session: sessions[0] } : { kind: 'none' }
  }
  const exact = sessions.find((s) => s.sessionId === trimmed || s.import?.dshSessionId === trimmed)
  if (exact) return { kind: 'one', session: exact }
  const keyword = trimmed.toLowerCase()
  const matches = sessions.filter((s) => (
    (s.title ?? '').toLowerCase().includes(keyword) || (s.sessionId ?? '').toLowerCase().includes(keyword)
  ))
  if (matches.length === 1) return { kind: 'one', session: matches[0] }
  if (matches.length > 1) {
    return {
      kind: 'many',
      candidates: matches.slice(0, 10).map((s) => `${s.sessionId} — ${s.title ?? '(无标题)'}`),
    }
  }
  return { kind: 'none' }
}

/**
 * /resume-claude 定位快路径（A6）：精确 sessionId / import-<src> id 无需全量
 * 扫描——直接用 imports.json 映射 + index.json 书签定位；未命中返回 null
 * （调用方回退 runScan 增量扫描）。latest/关键词不走快路径（依赖最近活动
 * 排序与标题匹配，必须扫描索引）。
 * @param ctx - Cordis 上下文（当前仅用于签名对称）。
 * @param ref - 命令输入。
 * @returns `{ session }` 或 null。
 */
export async function resolveResumeFast(ctx, ref) {
  const trimmed = (ref ?? '').trim()
  if (trimmed.length === 0 || trimmed === 'latest') return null
  const cacheDir = resolveCacheDir()
  const [imports, cache] = await Promise.all([loadImports(cacheDir), loadCache(cacheDir)])
  const files = cache?.files ?? {}
  for (const [sourcePath, entry] of Object.entries(imports)) {
    const record = unwrapImport(entry)
    if (record?.dshId === trimmed) {
      const header = files[sourcePath]
      return header && !header.error ? { session: header } : null
    }
  }
  const bySessionId = Object.values(files).find((s) => s && !s.error && s.sessionId === trimmed)
  return bySessionId ? { session: bySessionId } : null
}

/**
 * 注册 claude-import-all 与 resume-claude 命令（F15/F17）。
 * 命令由用户直接触发，不经模型回合；结果直接渲染 UI，并注入当前会话上下文。
 * @param ctx - Cordis 上下文。
 * @param config - 插件配置。
 */
export function registerCommands(ctx, config) {
  withService(ctx, 'commands', (commands) => {
    if (typeof commands.register !== 'function') return
    registerCommandDefinitions(ctx, config, commands)
  })
}

function registerCommandDefinitions(ctx, config, commands) {
  const maxBytes = config.maxTranscriptBytes ?? DEFAULT_MAX_TRANSCRIPT_BYTES
  const resumeMaxChars = config.resumeMaxChars ?? DEFAULT_HANDOFF_MAX_CHARS
  const claudeHome = () => config.claudeHome ? path.resolve(config.claudeHome) : locateClaudeHome()

  // F15：一条命令完成 扫描 → 导入 → 注入上下文 → 输出报告。
  commands.register({
    name: 'claude-import-all',
    description: '一键全量迁移：扫描本机 Claude Code 数据并导入全部会话，输出报告并注入当前会话',
    handler: async (invocation) => {
      try {
        const fs = requireFs(ctx)
        const target = await fs.resolve(path.join(claudeHome(), 'projects'))
        const info = await fs.stat(target)
        if (!info || info.type !== 'directory') {
          return { kind: 'error', text: '未找到 Claude projects 目录（' + claudeHome() + '/projects）。' }
        }
        const batch = await importDirectory(
          ctx, target, { recursive: true }, maxBytes, undefined,
          config.importConcurrency ?? DEFAULT_IMPORT_CONCURRENCY,
          invocation.signal,
        )
        const lines = renderImport({}, { mode: 'batch', ...batch }).map((b) => b.text)
        const summaryText = 'Claude 全量迁移完成。\n\n' + lines.join('\n')
          + '\n\n已导入会话即时落盘，无需重启 dsh：服务端会话/工作区列表立即可见。'
          + '已打开的 Web 页面请刷新一次会话列表（浏览器刷新或面板「刷新会话列表」按钮）后在会话列表中点开续聊。'
        const injected = injectContext(invocation.agent, summaryText)
        return {
          kind: 'success',
          text: summaryText + (injected ? '\n\n（报告已注入当前会话上下文。）' : ''),
        }
      } catch (err) {
        return { kind: 'error', text: 'claude-import-all 失败：' + String((err && err.message) || err) }
      }
    },
  })

  // F17：未导入先导入，再以交接摘要方式在当前会话继续。
  commands.register({
    name: 'resume-claude',
    description: '继续 Claude Code 会话：latest | 会话ID | 标题关键词；未导入的先导入，再以静态交接摘要继续',
    input: { hint: 'latest | 会话ID | 标题关键词' },
    handler: async (invocation) => {
      try {
        const ref = invocation.rawInput.trim()
        // 快路径：精确 id 直接由 imports.json + 缓存书签定位，省掉全量/增量扫描。
        const fast = await resolveResumeFast(ctx, ref)
        const resolved = fast ?? resolveResumeTarget(await runScan(ctx, config, {}), ref)
        if (resolved.kind === 'none') {
          return { kind: 'error', text: '未找到匹配的 Claude 会话。可用 /claude-import-all 先全量迁移，或运行 claude_scan 后重试。' }
        }
        if (resolved.kind === 'many') {
          return {
            kind: 'success',
            text: '关键词匹配到多个会话，请选择其一：\n- ' + resolved.candidates.join('\n- '),
          }
        }
        const session = resolved.session
        let dshId = session.import?.dshSessionId
        const fs = requireFs(ctx)
        const target = await fs.resolve(session.file)
        const info = await fs.stat(target)
        if (info && typeof info.size === 'number' && info.size > maxBytes) {
          return {
            kind: 'error',
            text: `transcript 过大（${info.size} 字节 > maxTranscriptBytes ${maxBytes}）：` +
              '请调高 maxTranscriptBytes，或改由 /claude-import-all 全量迁移。',
          }
        }
        invocation.signal?.throwIfAborted()
        // 只读一次原文：同一转换结果既用于幂等落盘，也用于生成交接摘要（A6 消除双读）。
        const raw = await fs.readText(target)
        const converted = convertClaudeJsonl(raw, {})
        if (!dshId) {
          const persisted = await listPersistedIds(ctx)
          const single = await persistConverted(ctx, converted, {}, persisted, session.file, {
            sizeBytes: info && typeof info.size === 'number' ? info.size : undefined,
            mtimeMs: info && typeof info.mtimeMs === 'number' ? info.mtimeMs : undefined,
          })
          dshId = single.sessionId
        }
        // resumeMode='agents'（D2）：尝试经 ctx.agents.resume 真正打开导入会话；
        // 服务缺失/失败回退到交接摘要注入（导入会话本身已含完整历史）。
        if (config.resumeMode === 'agents') {
          const agents = ctx.get('agents')
          if (agents && typeof agents.resume === 'function') {
            try {
              await agents.resume({ resumeSessionId: dshId })
              return {
                kind: 'success',
                text: `已恢复 DSH 会话 ${dshId}（含完整导入历史），可在会话列表中继续。`,
              }
            } catch {
              // agents 不可用/恢复失败：回退注入路径。
            }
          }
        }
        const handoff = buildHandoff(converted, { maxChars: resumeMaxChars, title: session.title })
        const injected = injectContext(invocation.agent, handoff)
        return {
          kind: 'success',
          text: `${handoff}\n\nDSH 会话：${dshId}（可在会话列表中打开继续）`
            + (injected ? '\n\n（交接摘要已注入当前会话，下一条消息即可继续。）' : ''),
        }
      } catch (err) {
        return { kind: 'error', text: 'resume-claude 失败：' + String((err && err.message) || err) }
      }
    },
  })

  // D5：重置本插件缓存（扫描书签 + 导入映射），保留已导入的 DSH 会话。
  commands.register({
    name: 'claude-move-reset',
    description: '重置本插件缓存（扫描书签与导入映射），保留已导入的 DSH 会话',
    handler: async () => {
      try {
        await resetCacheFiles(resolveCacheDir())
        return {
          kind: 'success',
          text: '已重置 claude-move 缓存（扫描书签与导入映射）。下次扫描将全量重建；已导入的 DSH 会话不受影响。',
        }
      } catch (err) {
        return { kind: 'error', text: 'claude-move-reset 失败：' + String((err && err.message) || err) }
      }
    },
  })
}

// ── 面板 JSON 路由（F16）：ctx.webServer 公开 seam ─────────────────────────────

/** 发送 JSON 响应（node:http）。 */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

/** 读取 JSON 请求体（上限 1 MiB）。 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1024 * 1024) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/**
 * 状态变更路由的 CSRF 加固（D6）：浏览器请求必须来自 loopback 或同源
 * （Origin 与 Host 一致）；无 Origin 的非浏览器客户端（curl/脚本）放行。
 * @param req - node:http IncomingMessage。
 * @returns 是否可信。
 */
export function isTrustedOrigin(req) {
  const origin = req?.headers?.origin
  if (typeof origin !== 'string' || origin.length === 0) return true
  let hostname
  try {
    hostname = new URL(origin).hostname
  } catch {
    return false
  }
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1') {
    return true
  }
  const host = req?.headers?.host
  if (typeof host === 'string' && host.length > 0) {
    const hostNameOnly = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
    if (hostNameOnly.toLowerCase() === hostname.toLowerCase()) return true
  }
  return false
}

/**
 * 注册面板路由（enableWebPanel=false 或 headless 无 webServer 时跳过）：
 * - GET /api/claude-move/index   → 最近扫描索引（含导入状态与 settings 建议）
 * - POST /api/claude-move/import → 启动批量/单文件导入任务，返回 jobId
 * - GET /api/claude-move/progress?job=<id> → 任务进度（面板轮询）
 * - DELETE /api/claude-move/job?job=<id> → 取消导入任务（B5/D4）
 * 路由随本插件生命周期自动撤销（webServer.register 返回 disposer）。
 * @param ctx - Cordis 上下文。
 * @param config - 插件配置。
 * @param state - 插件状态。
 */
export function registerWebRoutes(ctx, config, state) {
  if (config.enableWebPanel === false) return
  withService(ctx, 'webServer', (webServer) => {
    if (typeof webServer.register !== 'function') return
    registerRouteDefinitions(ctx, config, state, webServer)
  })
}

function registerRouteDefinitions(ctx, config, state, webServer) {

  const maxBytes = config.maxTranscriptBytes ?? DEFAULT_MAX_TRANSCRIPT_BYTES
  const claudeHome = () => config.claudeHome ? path.resolve(config.claudeHome) : locateClaudeHome()
  const jobs = new Map()
  const JOB_RETENTION = 20

  // 官方后台任务服务（B5）：特性探测，缺失回退自有 job Map（rc.6 兼容）。
  const hostJobs = typeof ctx.get === 'function' ? ctx.get('jobs') : undefined

  webServer.register({
    kind: 'exact',
    path: '/api/claude-move/index',
    handler: async (req, res) => {
      try {
        const index = await runScan(ctx, config, {})
        state.invalidateSkills?.()
        sendJson(res, 200, index)
      } catch (err) {
        sendJson(res, 500, { error: String((err && err.message) || err) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/claude-move/import',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      if (!isTrustedOrigin(req)) {
        sendJson(res, 403, { error: 'untrusted origin' })
        return
      }
      let body
      try {
        body = await readJsonBody(req)
      } catch (err) {
        sendJson(res, 400, { error: String((err && err.message) || err) })
        return
      }
      const jobId = randomUUID()
      const controller = new AbortController()
      const job = {
        jobId, status: 'running', total: 0, imported: 0, alreadyImported: 0, skipped: 0, failed: 0, results: [],
        controller, hostJobId: null,
      }
      jobs.set(jobId, job)
      while (jobs.size > JOB_RETENTION) jobs.delete(jobs.keys().next().value)
      sendJson(res, 200, { jobId })

      // B5：可选接入官方 ctx.jobs（获得官方 kill/UI 展示），失败回退自有取消面。
      if (hostJobs && typeof hostJobs.start === 'function') {
        try {
          job.hostJobId = hostJobs.start({
            kind: 'claude-move-import',
            label: 'claude-move 导入 ' + (body && typeof body.path === 'string' ? body.path : 'all'),
            run: () => ({
              cancel() { controller.abort(new Error('claude-move 导入已取消')) },
              done: new Promise((resolve) => {
                controller.signal.addEventListener('abort', () => resolve(), { once: true })
              }),
            }),
          })
        } catch {
          // 无 serving controller 等：保持自有取消面。
          job.hostJobId = null
        }
      }

      void (async () => {
        try {
          const fs = requireFs(ctx)
          const rawPath = body && typeof body.path === 'string' && body.path !== 'all'
            ? body.path
            : path.join(claudeHome(), 'projects')
          const target = await fs.resolve(rawPath)
          const info = await fs.stat(target)
          if (!info) {
            job.status = 'error'
            job.error = '路径不存在：' + rawPath
            return
          }
          if (info.type === 'file') {
            const persisted = await listPersistedIds(ctx)
            const single = await importTranscript(ctx, target, { force: body && body.force === true }, maxBytes, persisted, undefined, controller.signal)
            Object.assign(job, {
              status: 'done',
              total: 1,
              imported: single.status === 'imported' ? 1 : 0,
              alreadyImported: single.status === 'already-imported' ? 1 : 0,
              results: [{ path: rawPath, ...single }],
            })
            return
          }
          if (info.type !== 'directory') {
            job.status = 'error'
            job.error = '不支持的目标类型：' + rawPath
            return
          }
          const done = await importDirectory(ctx, target, {
            recursive: true, force: body && body.force === true,
          }, maxBytes, (progress) => Object.assign(job, progress),
            config.importConcurrency ?? DEFAULT_IMPORT_CONCURRENCY, controller.signal)
          Object.assign(job, done, { status: 'done' })
        } catch (err) {
          if (controller.signal.aborted) {
            job.status = 'cancelled'
          } else {
            job.status = 'error'
            job.error = String((err && err.message) || err)
          }
        }
      })()
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/claude-move/progress',
    handler: (req, res) => {
      const url = new URL(req.url ?? '', 'http://localhost')
      const id = url.searchParams.get('job')
      const job = id ? jobs.get(id) : undefined
      if (!job) {
        sendJson(res, 404, { error: 'unknown job' })
        return
      }
      // 不透出进程内句柄（AbortController/官方 job id）。
      const { controller: _controller, hostJobId: _hostJobId, ...publicJob } = job
      sendJson(res, 200, publicJob)
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/claude-move/job',
    handler: (req, res) => {
      if (req.method !== 'DELETE') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      if (!isTrustedOrigin(req)) {
        sendJson(res, 403, { error: 'untrusted origin' })
        return
      }
      const url = new URL(req.url ?? '', 'http://localhost')
      const id = url.searchParams.get('job')
      const job = id ? jobs.get(id) : undefined
      if (!job) {
        sendJson(res, 404, { error: 'unknown job' })
        return
      }
      if (job.hostJobId && hostJobs && typeof hostJobs.kill === 'function') {
        try {
          hostJobs.kill(job.hostJobId)
        } catch {
          job.controller?.abort(new Error('claude-move 导入已取消'))
        }
      } else {
        job.controller?.abort(new Error('claude-move 导入已取消'))
      }
      sendJson(res, 200, { cancelled: true })
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/claude-move/reset',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      if (!isTrustedOrigin(req)) {
        sendJson(res, 403, { error: 'untrusted origin' })
        return
      }
      try {
        await resetCacheFiles(resolveCacheDir())
        state.invalidateSkills?.()
        sendJson(res, 200, { reset: true })
      } catch (err) {
        sendJson(res, 500, { error: String((err && err.message) || err) })
      }
    },
  })
}

/**
 * 挂载插件：注册扫描/导入工具、个人上下文贡献、命令与面板路由。
 * @param ctx - Cordis 上下文。
 * @param config - 经 Schemastery 校验的插件配置。
 */
export function apply(ctx, config = {}) {
  const state = makeClaudeState(config)
  ctx.tools.register(makeScanTool(ctx, config, state))
  ctx.tools.register(makeImportTool(ctx, config))
  registerContextContributions(ctx, config, state)
  registerCommands(ctx, config)
  registerWebRoutes(ctx, config, state)
}
