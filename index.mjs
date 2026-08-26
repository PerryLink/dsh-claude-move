// SPDX-License-Identifier: Apache-2.0
// index.mjs — dsh-claude-move host 插件入口。
//
// 已注册：claude_scan（F1-F4 + settings 翻译建议 F14）、import_claude（F5-F10/S4/S5）、
// memory/CLAUDE.md 系统提示词段（F11/F13，同步提供者 + mtime 缓存）、
// Claude 技能 provider（F12）、/claude-import-all 与 /resume-claude 命令（F15/F17）、
// /api/claude-move/* 面板 JSON 路由（F16）。
// 二期（四合一迁移向导）：move_detect / move_preview / move_run 工具与 /move 命令
// （CC/Codex/OpenCode/Hermes 检测→预览→审批执行→报告；move.json 幂等；冲突 diff）。
//
// 只消费公开服务：tools / systemPrompt / skills / sessionPersistence /
// workspaceRegistry / commands / webServer / approval（后几者经 ctx.get 可选读取）。
// 源文件只读，缓存只写 resolveCacheDir()；迁移落点只写 $DSH_HOME/skills、
// $DSH_HOME/AGENTS.md 与 imports 工作区目录。

import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
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
  loadImportsSync,
  scanClaudeHome,
  scanProjectDir,
  scanTranscriptFile,
  resetCacheFiles,
} from './lib/discovery.mjs'
import { convertClaudeJsonl, convertCodexJsonl, createClaudeStreamConverter, mintSessionId, tailSessionEvents, validateSessionEvents, appendTitleEvent } from './lib/convert.mjs'
import { scanSecrets, summarizePermissions } from './lib/report.mjs'
import { makeFileCache, readMemoriesSync, renderMemories, renderClaudeMd, fileExists, selectMemoryDirs, DEFAULT_MEMORY_MAX_BYTES, DEFAULT_MEMORY_SCOPE } from './lib/context.mjs'
import { makeClaudeSkillsProvider } from './lib/skills-provider.mjs'
import { translateSettings } from './lib/settings.mjs'
import { buildHandoff, DEFAULT_HANDOFF_MAX_CHARS } from './lib/handoff.mjs'
import { eventsToClaudeJsonl } from './lib/export.mjs'
import { importsStore } from './lib/imports-store.mjs'
import { manifestStore } from './lib/manifest.mjs'
import { runPreview, runExecute, runWizard, reportLines } from './lib/wizard.mjs'
import { defaultAgentsMdPath } from './lib/agmd-section.mjs'
import { personaParagraph, personaSentence } from './lib/persona.mjs'
import * as claudeParser from './lib/sources/claude/parser.mjs'
import * as claudeMapper from './lib/sources/claude/mapper.mjs'
import * as codexParser from './lib/sources/codex/parser.mjs'
import * as codexMapper from './lib/sources/codex/mapper.mjs'
import * as opencodeParser from './lib/sources/opencode/parser.mjs'
import * as opencodeMapper from './lib/sources/opencode/mapper.mjs'
import * as hermesParser from './lib/sources/hermes/parser.mjs'
import * as hermesMapper from './lib/sources/hermes/mapper.mjs'
import { convertOpencodeRows, loadDbSessionRows, loadLegacySessionRows } from './lib/sources/opencode/convert.mjs'
import { mergeDetections } from './lib/sources/contract.mjs'

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
 * @property {'claudecode'|'per-project'} [workspaceMode] 工作区归组方式：'claudecode'（默认）把全部导入会话挂到独立的 claudecode 工作区（claudecodeDir 目录）；'per-project' 按源项目 cwd 各建一个工作区。
 * @property {string} [claudecodeDir] claudecode 工作区目录；缺省 `$DSH_HOME/claudecode`（DSH_HOME 缺失时 `~/.dsh/claudecode`）。插件只会在此目录下创建文件夹（迁移唯一的有意写入），绝不触碰其它路径。
 * @property {boolean} [enableMove] 注册四合一迁移向导（move_detect/move_preview/move_run 工具与 /move 命令，默认 true）。
 * @property {boolean} [requireApproval] 迁移执行前经 ctx.approval 审批（默认 true；fail-closed，非 allowed-once 零写入；无审批 seam 的平台显式设 false 才可执行）。
 * @property {('claude'|'codex'|'opencode'|'hermes')[]} [sources] 向导覆盖的源（默认四源全开）。
 * @property {string} [codexHome] Codex 数据根；缺省 `$CODEX_HOME` 或 `~/.codex`。
 * @property {string} [opencodeDataHome] OpenCode 数据根；缺省 XDG_DATA_HOME/opencode（平台默认）。
 * @property {string} [opencodeConfigHome] OpenCode 配置根；缺省 XDG_CONFIG_HOME/opencode（平台默认）。
 * @property {string} [hermesHome] Hermes 数据根；缺省 `$HERMES_HOME` 或 `~/.hermes`。
 * @property {'per-source'|'single'} [moveWorkspaceMode] 向导会话归组：'per-source'（默认）每源一个工作区（`$DSH_HOME/imports/<source>`）；'single' 全部挂到一个 imports 工作区（`$DSH_HOME/imports`）。
 * @property {string} [skillsDir] 向导技能落点；缺省 `$DSH_HOME/skills`（官方用户技能根，DSH 自动发现）。
 * @property {string} [agentsMdPath] 向导记忆/指令落点；缺省 `$DSH_HOME/AGENTS.md`（DSH 全局指令文件）。
 * @property {boolean} [enableExport] 注册 DSH 会话回迁导出（claude_export 工具与 /claude-export 命令，默认 true）。
 * @property {string} [exportDir] 回迁导出落点目录；缺省 `$DSH_HOME/claude-export`（DSH_HOME 缺失时 `~/.dsh/claude-export`）。
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
  workspaceMode: Schema.union([Schema.const('claudecode'), Schema.const('per-project')]).default('claudecode'),
  claudecodeDir: Schema.string(),
  enableMove: Schema.boolean().default(true),
  requireApproval: Schema.boolean().default(true),
  sources: Schema.array(Schema.union([
    Schema.const('claude'), Schema.const('codex'), Schema.const('opencode'), Schema.const('hermes'),
  ])).default(['claude', 'codex', 'opencode', 'hermes']),
  codexHome: Schema.string(),
  opencodeDataHome: Schema.string(),
  opencodeConfigHome: Schema.string(),
  hermesHome: Schema.string(),
  moveWorkspaceMode: Schema.union([Schema.const('per-source'), Schema.const('single')]).default('per-source'),
  skillsDir: Schema.string(),
  agentsMdPath: Schema.string(),
  enableExport: Schema.boolean().default(true),
  exportDir: Schema.string(),
})

const sessionImportSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true },
    dshSessionId: { type: 'string' },
    updatesPending: { type: 'boolean' },
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
      const record = unwrapImport(imports[session.file])
        ?? unwrapImport(imports[session.sessionId])
      const dshId = record?.dshId
      if (dshId && imported.has(dshId)) {
        session.import = { status: 'imported', dshSessionId: dshId }
        // 源文件轮次多于已导入记录 → 面板打「有新增」徽标（D4）。
        if (typeof record.turns === 'number' && typeof session.turns === 'number' && session.turns > record.turns) {
          session.import.updatesPending = true
        }
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
      'Scan the local Claude Code data: locate the data root ($CLAUDE_CONFIG_DIR or ~/.claude), index every project/session (title, timestamps, message & tool-call counts), directory & git state, memories, skills, global CLAUDE.md and settings.json. Returns a structured JSON index. path narrows to the projects directory, one project, one .jsonl or any directory containing .jsonl files; refresh=true bypasses the incremental cache; projectsLimit/sessionsLimit/fields trim the output. Use import_claude for imports. ' +
      '（扫描本机 Claude Code 数据：自动定位数据根目录，索引全部项目/会话、目录与 git 状态、记忆/技能/CLAUDE.md/settings.json；path 收窄范围，refresh 全量重扫，projectsLimit/sessionsLimit/fields 裁剪输出。导入请用 import_claude。）',
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
 * 工作区归组模式（E2 + 向导）：'claudecode'（默认，全部导入会话挂到独立
 * claudecode 工作区）、'per-project'（按源项目 cwd 各建工作区）或 'wizard'
 * （四合一向导：按 source 挂到 imports 工作区）。未知值一律按 'claudecode'
 * 处理，保持「只新建、不打扰既有目录」的默认安全语义。
 * @param config - 插件配置。
 * @returns 'claudecode' | 'per-project' | 'wizard'。
 */
export function workspaceModeOf(config) {
  if (config?.workspaceMode === 'per-project') return 'per-project'
  if (config?.workspaceMode === 'wizard') return 'wizard'
  return 'claudecode'
}

/**
 * 向导会话工作区目录：'per-source' → `$DSH_HOME/imports/<source>`；
 * 'single' → `$DSH_HOME/imports`（DSH_HOME 缺失时 `~/.dsh`）。
 * @param config - 插件配置（wizardSource 为源标识）。
 * @param env - 环境对象，缺省 process.env。
 * @returns 目录绝对路径。
 */
export function resolveMoveDir(config, env = process.env) {
  const base = env.DSH_HOME || path.join(homedir(), '.dsh')
  const source = typeof config?.wizardSource === 'string' && config.wizardSource.length > 0
    ? config.wizardSource
    : 'imports'
  return config?.moveWorkspaceMode === 'single'
    ? path.join(base, 'imports')
    : path.join(base, 'imports', source)
}

/**
 * claudecode 工作区目录：配置显式给出则按绝对路径解析，否则
 * `$DSH_HOME/claudecode`（DSH_HOME 缺失时 `~/.dsh/claudecode`）。
 * @param config - 插件配置。
 * @param env - 环境对象，缺省 process.env。
 * @returns 目录绝对路径。
 */
export function resolveClaudecodeDir(config, env = process.env) {
  if (typeof config?.claudecodeDir === 'string' && config.claudecodeDir.trim().length > 0) {
    return path.resolve(config.claudecodeDir)
  }
  const base = env.DSH_HOME || path.join(homedir(), '.dsh')
  return path.join(base, 'claudecode')
}

/**
 * 应用工作区 cwd 策略：claudecode 模式下把会话 cwd 覆写为 claudecodeDir
 * （工作区注册表要求 header.cwd 与工作区路径严格相等），并返回覆写前的
 * 源项目 cwd 供 imports 记录保真；per-project 模式不改动。
 * @param meta - SessionHeader（就地修改）。
 * @param config - 插件配置。
 * @returns 覆写前的 cwd（无覆写时返回当前 cwd）。
 */
export function applyWorkspaceCwd(meta, config) {
  if (!meta) return undefined
  const mode = workspaceModeOf(config)
  if (mode === 'wizard') {
    const original = meta.cwd
    meta.cwd = resolveMoveDir(config)
    return original
  }
  if (mode !== 'claudecode') return meta.cwd
  const original = meta.cwd
  meta.cwd = resolveClaudecodeDir(config)
  return original
}

/**
 * 把导入会话挂到工作区（E2）：
 * - per-project：复用 attachToWorkspace（按源 cwd 归组）。
 * - claudecode：确保 claudecodeDir 目录存在（迁移唯一的有意写入，绝不
 *   递归删除任何内容），把该目录注册为标题「claudecode」的工作区并挂接；
 *   标题冲突时依次退回目录名 / 'claude-code' 标题，仍失败则报告原因。
 * @param ctx - Cordis 上下文。
 * @param config - 插件配置。
 * @param meta - SessionHeader（cwd 已按 applyWorkspaceCwd 覆写）。
 * @returns `{ attached, mode, path?, reason? }`。
 */
export async function attachImportedSession(ctx, config, meta) {
  const mode = workspaceModeOf(config)
  if (mode === 'per-project') {
    const result = await attachToWorkspace(ctx, meta)
    return { ...result, mode: 'per-project' }
  }
  if (mode === 'wizard') {
    // 向导归组：imports/<source>（或 imports）工作区，标题用源标识兜底。
    const dir = resolveMoveDir(config)
    const wr = ctx.get('workspaceRegistry')
    if (!wr || typeof wr.resolveByPath !== 'function' || typeof wr.create !== 'function') {
      return { attached: false, mode: 'wizard', path: dir, reason: 'workspace-registry-unavailable' }
    }
    try {
      await mkdir(dir, { recursive: true })
      let ws = await wr.resolveByPath(dir)
      if (!ws) {
        const sourceTitle = typeof config.wizardSource === 'string' ? config.wizardSource : null
        for (const title of [sourceTitle, undefined, 'imports']) {
          try {
            ws = title === undefined || title === null ? await wr.create(dir) : await wr.create(dir, title)
            break
          } catch (err) {
            const text = String((err && err.name) || '') + ' ' + String((err && err.message) || '')
            if (/conflict/i.test(text)) continue
            throw err
          }
        }
      }
      if (!ws) {
        return { attached: false, mode: 'wizard', path: dir, reason: 'workspace-title-conflict' }
      }
      await ws.attachSession(meta.id)
      return { attached: true, mode: 'wizard', path: dir }
    } catch (err) {
      console.error('[claude-move] workspace attach failed:', String((err && err.message) || err))
      return { attached: false, mode: 'wizard', path: dir, reason: String((err && err.message) || err) }
    }
  }
  const dir = resolveClaudecodeDir(config)
  const wr = ctx.get('workspaceRegistry')
  if (!wr || typeof wr.resolveByPath !== 'function' || typeof wr.create !== 'function') {
    return { attached: false, mode: 'claudecode', path: dir, reason: 'workspace-registry-unavailable' }
  }
  try {
    await mkdir(dir, { recursive: true })
    let ws = await wr.resolveByPath(dir)
    if (!ws) {
      for (const title of ['claudecode', undefined, 'claude-code']) {
        try {
          ws = title === undefined ? await wr.create(dir) : await wr.create(dir, title)
          break
        } catch (err) {
          const text = String((err && err.name) || '') + ' ' + String((err && err.message) || '')
          if (/conflict/i.test(text)) continue
          throw err
        }
      }
    }
    if (!ws) {
      return { attached: false, mode: 'claudecode', path: dir, reason: 'workspace-title-conflict' }
    }
    await ws.attachSession(meta.id)
    return { attached: true, mode: 'claudecode', path: dir }
  } catch (err) {
    console.error('[claude-move] workspace attach failed:', String((err && err.message) || err))
    return { attached: false, mode: 'claudecode', path: dir, reason: String((err && err.message) || err) }
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
 * @param config - 插件配置（工作区归组策略）。
 * @returns 单文件统计。
 */
export async function persistConverted(ctx, converted, args, persisted, sourcePath, source = {}, config = {}) {
  // 同一源文件并发导入互斥：后到者等先行者落盘后重跑，按幂等路径复用结果
  // （否则 create duplicate 会被记为 failed，且 imports.json 会被并发覆盖）。
  return importsStore.exclusive(sourcePath, () =>
    persistConvertedInner(ctx, converted, args, persisted, sourcePath, source, config))
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

async function persistConvertedInner(ctx, converted, args, persisted, sourcePath, source = {}, config = {}) {
  const { meta, events, turns, messages, toolCalls, skipped, skippedLines, typeCounts, repaired, sourceId } = converted

  // 落盘前自校验（issue#1）：不平衡的日志会让会话在续聊时永久 400，宁可
  // 大声失败也不把非法消息流写进持久层（转换器按构造保证通过）。
  const issues = validateSessionEvents(events)
  if (issues.length > 0) {
    throw new Error('claude-move 拒绝落盘：转换结果不满足续聊协议不变式 —— ' + issues.slice(0, 3).join('；'))
  }

  // 源 sessionId 缺失时用文件名 slug 保证目标 id 跨运行稳定（否则 mintSessionId
  // 回退 Date.now，重复导入不再幂等）。
  if (!args?.sessionId && !sourceId) {
    meta.id = mintSessionId(path.basename(sourcePath).replace(/\.jsonl$/i, ''))
  }

  // 工作区 cwd 策略：claudecode 模式覆写 cwd，保真记录源项目 cwd（E2）。
  const sourceCwd = applyWorkspaceCwd(meta, config)

  const base = {
    sessionId: meta.id,
    sourcePath,
    turns: turns.length,
    messages,
    toolCalls,
    skipped,
    skippedLines: skippedLines ?? [],
    permissions: summarizePermissions(typeCounts),
    typeCounts: typeCounts ?? {},
    repaired: repaired ?? { synthesized: 0, duplicateResults: 0, orphanResults: 0 },
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
      const attached = await attachImportedSession(ctx, config, nextMeta)
      await rememberImport(ctx, sourcePath, {
        dshId: nextId, turns: turns.length, events: events.length,
        sizeBytes: source.sizeBytes, mtimeMs: source.mtimeMs,
        ...(typeof sourceCwd === 'string' ? { sourceCwd } : {}),
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
        ...(typeof sourceCwd === 'string' ? { sourceCwd } : {}),
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
      const attached = await attachImportedSession(ctx, config, meta)
      await rememberImport(ctx, sourcePath, {
        dshId: meta.id, turns: turns.length, events: events.length,
        sizeBytes: source.sizeBytes, mtimeMs: source.mtimeMs,
        ...(typeof sourceCwd === 'string' ? { sourceCwd } : {}),
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
  const attached = await attachImportedSession(ctx, config, meta)
  await rememberImport(ctx, sourcePath, {
    dshId: meta.id, turns: turns.length, events: events.length,
    sizeBytes: source.sizeBytes, mtimeMs: source.mtimeMs,
    ...(typeof sourceCwd === 'string' ? { sourceCwd } : {}),
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
 * 超过 maxTranscriptBytes 且 fs 提供 streamText 时走流式分块导入（C3），
 * 内存 O(块) 而非 O(文件)；无流式面的环境保持响亮拒绝。
 * @param ctx - Cordis 上下文。
 * @param target - ctx.fs 目标。
 * @param args - 工具参数 `{ sessionId?, force? }`。
 * @param maxBytes - 单文件大小上限。
 * @param persisted - 已持久化 id 快照。
 * @param rawOverride - 已读取的原文（批量路径复用，避免双读）。
 * @param signal - 可选 AbortSignal（工具 exec.signal）；中止时抛出 signal.reason。
 * @param config - 插件配置（工作区归组策略）。
 * @returns 单文件统计。
 */
export async function importTranscript(ctx, target, args, maxBytes, persisted, rawOverride, signal, config = {}) {
  const fs = requireFs(ctx)
  signal?.throwIfAborted()
  const sourcePath = target.displayPath || fs.processPath(target)
  const info = await fs.stat(target)
  if (info && typeof info.size === 'number' && info.size > maxBytes) {
    if (rawOverride === undefined && typeof fs.streamText === 'function') {
      return importsStore.exclusive(sourcePath, () =>
        importTranscriptStreamed(ctx, fs, target, args, persisted, sourcePath, info, signal, config))
    }
    throw new Error(`transcript 过大（${info.size} 字节 > maxTranscriptBytes ${maxBytes}）：` +
      '请调高 maxTranscriptBytes，或改由 /claude-import-all 与面板批量导入（该路径支持流式分块导入超大文件）')
  }
  signal?.throwIfAborted()
  const raw = rawOverride ?? await fs.readText(target)
  signal?.throwIfAborted()
  const converted = convertClaudeJsonl(raw, args.sessionId ? { sessionId: args.sessionId } : {})
  const result = await persistConverted(ctx, converted, args, persisted, sourcePath, {
    sizeBytes: info && typeof info.size === 'number' ? info.size : undefined,
    mtimeMs: info && typeof info.mtimeMs === 'number' ? info.mtimeMs : undefined,
  }, config)
  result.secrets = scanSecrets(raw)
  return result
}

/**
 * 流式分块导入超大 transcript（C3）：fs.streamText 逐块读取 → 转换器按回合
 * 边界分批合成 → 顺序 append（内存 O(当前回合 + 单批)）。首次导入的 create
 * 由首个批次触发（id 冲突时后缀避让）；已导入且源增长的按 skipTurns/startSeq
 * 增量续写同一会话；force 另存新 id 完整副本。中断后重跑天然幂等：imports
 * 记录只以最终落盘结果为准，重复执行续写从存储长度继续。
 * @param ctx - Cordis 上下文。
 * @param fs - FileSystem 服务（已确认含 streamText）。
 * @param target - ctx.fs 目标。
 * @param args - 工具参数 `{ sessionId?, force? }`。
 * @param persisted - 已持久化 id 快照（就地更新）。
 * @param sourcePath - 源 transcript 绝对路径。
 * @param info - fs.stat 结果。
 * @param signal - 可选 AbortSignal。
 * @param config - 插件配置（工作区归组策略）。
 * @returns 单文件统计（status: imported | appended | already-imported）。
 */
async function importTranscriptStreamed(ctx, fs, target, args, persisted, sourcePath, info, signal, config = {}) {
  const imports = await loadImports(resolveCacheDir())
  const known = unwrapImport(imports[sourcePath])
  const knownId = known?.dshId
  let dshId = null
  let skipTurns = 0
  let startSeq = 0
  if (knownId && persisted.has(knownId)) {
    if (args.force === true) {
      dshId = mintForceSessionId(persisted, knownId)
    } else {
      const se = typeof known.events === 'number' ? known.events : await storedEventCount(ctx, knownId)
      const st = typeof known.turns === 'number' ? known.turns : 0
      if (typeof se !== 'number' || st <= 0) {
        return {
          sessionId: knownId, status: 'already-imported', appendedSkipped: 'stored-length-unknown',
          turns: 0, messages: 0, toolCalls: 0, skipped: 0, skippedLines: [],
          secrets: { total: 0, hits: [] },
          repaired: { synthesized: 0, duplicateResults: 0, orphanResults: 0 },
        }
      }
      skipTurns = st
      startSeq = se
      dshId = knownId
    }
  }

  let chain = Promise.resolve()
  let created = false
  let firstError = null
  let originalCwd

  const settleId = () => {
    const m = converter.meta()
    if (originalCwd === undefined) originalCwd = m.cwd
    if (dshId) {
      m.id = dshId
    } else if (persisted.has(m.id)) {
      dshId = mintForceSessionId(persisted, m.id)
      m.id = dshId
    }
    applyWorkspaceCwd(m, config)
    return m
  }

  const converter = createClaudeStreamConverter({
    sessionId: dshId ?? undefined,
    fallbackSessionId: mintSessionId(path.basename(sourcePath).replace(/\.jsonl$/i, '')),
    skipTurns,
    startSeq,
    batchEvents: 10000,
    onBatch: (events) => {
      if (firstError) return
      // 落盘前自校验（issue#1）：批次是完整回合边界，seq 从批次首事件起。
      const issues = validateSessionEvents(events, events[0]?.seq ?? 0)
      if (issues.length > 0) {
        firstError = new Error('claude-move 拒绝落盘：转换结果不满足续聊协议不变式 —— ' + issues.slice(0, 3).join('；'))
        return
      }
      if (skipTurns > 0) {
        chain = chain.then(() => spAppend(ctx, dshId, events)).catch((err) => { firstError = err })
        return
      }
      if (!created) {
        const m = settleId()
        created = true
        chain = chain
          .then(() => spPersist(ctx, m, []))
          .then(() => spAppend(ctx, m.id, events))
          .catch((err) => { firstError = err })
        return
      }
      chain = chain.then(() => spAppend(ctx, dshId, events)).catch((err) => { firstError = err })
    },
  })

  const stream = await fs.streamText(target, signal)
  const secrets = { total: 0, hits: [] }
  let lineNo = 0
  let carryLine = ''
  const scanLine = (line) => {
    const hit = scanSecrets(line)
    if (hit.total <= 0) return
    secrets.total += hit.total
    for (const h of hit.hits) {
      if (secrets.hits.length < 50) secrets.hits.push({ line: lineNo, kind: h.kind })
    }
  }
  for await (const chunk of stream) {
    signal?.throwIfAborted()
    const text = carryLine + String(chunk)
    const lines = text.split('\n')
    carryLine = lines.pop() ?? ''
    for (const line of lines) {
      lineNo++
      scanLine(line)
      converter.feed(line + '\n')
    }
  }
  if (carryLine.length > 0) {
    lineNo++
    scanLine(carryLine)
    converter.feed(carryLine + '\n')
  }
  const result = converter.end()
  await chain
  if (firstError) throw firstError
  const m = settleId()
  const source = {
    sizeBytes: info && typeof info.size === 'number' ? info.size : undefined,
    mtimeMs: info && typeof info.mtimeMs === 'number' ? info.mtimeMs : undefined,
  }

  if (skipTurns === 0) {
    persisted.add(m.id)
    const attached = await attachImportedSession(ctx, config, m)
    await rememberImport(ctx, sourcePath, {
      dshId: m.id, turns: result.turns, events: result.emittedEvents,
      sizeBytes: source.sizeBytes, mtimeMs: source.mtimeMs,
      ...(typeof originalCwd === 'string' ? { sourceCwd: originalCwd } : {}),
    })
    return {
      sessionId: m.id,
      status: 'imported',
      turns: result.turns,
      messages: result.messages,
      toolCalls: result.toolCalls,
      skipped: result.skipped,
      skippedLines: result.skippedLines,
      repaired: result.repaired,
      secrets,
      workspace: { ...attached, ...(m.cwd ? { path: m.cwd } : {}) },
    }
  }
  if (result.emittedEvents === 0) {
    return {
      sessionId: dshId, status: 'already-imported', alreadyImported: true,
      turns: skipTurns, messages: 0, toolCalls: 0,
      skipped: result.skipped, skippedLines: result.skippedLines,
      repaired: result.repaired, secrets,
    }
  }
  // result.turns 为全文件轮次数（含被跳过前缀）；新增轮次 = 总数 - 前缀。
  const appendedTurns = result.turns - skipTurns
  await rememberImport(ctx, sourcePath, {
    dshId, turns: result.turns, events: startSeq + result.emittedEvents,
    sizeBytes: source.sizeBytes, mtimeMs: source.mtimeMs,
    ...(typeof originalCwd === 'string' ? { sourceCwd: originalCwd } : {}),
  })
  return {
    sessionId: dshId,
    status: 'appended',
    appendedTurns,
    appendedEvents: result.emittedEvents,
    turns: result.turns,
    messages: result.messages,
    toolCalls: result.toolCalls,
    skipped: result.skipped,
    skippedLines: result.skippedLines,
    repaired: result.repaired,
    secrets,
  }
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
 * @param config - 插件配置（工作区归组策略）。
 * @returns `{ total, imported, alreadyImported, appended, skipped, failed, results }`。
 */
export async function importDirectory(ctx, dirTarget, args, maxBytes, onProgress, concurrency = DEFAULT_IMPORT_CONCURRENCY, signal, config = {}) {
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
          if (typeof fs.streamText === 'function') {
            // 超大文件：阶段二走流式分块导入（C3），内存 O(块)。
            prepared[i] = { pathLabel, status: 'streamed' }
          } else {
            prepared[i] = {
              pathLabel, status: 'failed',
              error: `transcript 过大（${info.size} 字节 > maxTranscriptBytes ${maxBytes}）`,
            }
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
    } else if (p.status === 'streamed') {
      try {
        const single = await importTranscript(ctx, files[i], { force: args.force }, maxBytes, persisted, undefined, signal, config)
        if (single.status === 'imported') imported++
        else if (single.status === 'appended') appended++
        else alreadyImported++
        results[i] = { path: p.pathLabel, ...single }
      } catch (err) {
        failed++
        results[i] = { path: p.pathLabel, status: 'failed', error: String((err && err.message) || err) }
      }
    } else {
      try {
        const single = await persistConverted(ctx, p.converted, { force: args.force }, persisted, p.pathLabel, p.source, config)
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
    typeCounts: { type: 'object', additionalProperties: true },
    repaired: { type: 'object', additionalProperties: true },
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
    if ((value.typeCounts?.summary ?? 0) > 0) {
      lines.push(`源记录含 ${value.typeCounts.summary} 条 summary（Claude 上下文压缩摘要，未映射为压缩节点；完整历史已按原始轮次导入）。`)
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
  const summaryTotal = value.mode === 'batch'
    ? (value.results ?? []).reduce((n, r) => n + (r.typeCounts?.summary ?? 0), 0)
    : 0
  if (summaryTotal > 0) {
    lines.push(`批量源记录共含 ${summaryTotal} 条 summary（Claude 上下文压缩摘要，未映射为压缩节点）。`)
  }
  const permTotal = value.mode === 'batch'
    ? (value.results ?? []).reduce((n, r) => n + (r.permissions?.total ?? 0), 0)
    : value.permissions?.total ?? 0
  if (permTotal > 0) {
    lines.push(`权限类记录 ${permTotal} 条未导入（permission/queue-operation）：见报告中的 DSH 权限迁移建议（S5）。`)
  }
  const repairedTotal = value.mode === 'batch'
    ? (value.results ?? []).reduce((n, r) => n + ((r.repaired?.synthesized ?? 0) + (r.repaired?.duplicateResults ?? 0) + (r.repaired?.orphanResults ?? 0)), 0)
    : ((value.repaired?.synthesized ?? 0) + (value.repaired?.duplicateResults ?? 0) + (value.repaired?.orphanResults ?? 0))
  if (repairedTotal > 0) {
    const synth = value.mode === 'batch'
      ? (value.results ?? []).reduce((n, r) => n + (r.repaired?.synthesized ?? 0), 0)
      : value.repaired?.synthesized ?? 0
    lines.push(`工具调用平衡修复：${synth} 处被中断的调用补为合成错误结果，` +
      `${repairedTotal - synth} 处重复/孤儿结果被丢弃（保证会话可继续对话）。`)
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

function makeImportTool(ctx, config) {
  const maxBytes = config.maxTranscriptBytes ?? DEFAULT_MAX_TRANSCRIPT_BYTES
  return defineTool({
    name: 'import_claude',
    description:
      'Copy Claude Code JSONL transcripts into resumable DSH sessions. path is a single .jsonl, a directory, "~/.claude/projects" or "all". Full-fidelity user/assistant/tool/thinking mapping, balanced session events, per-cwd workspace attach. Copy-only: never deletes source files and never deletes/rewrites existing DSH sessions. Re-import appends only new turns; force=true saves a fresh full copy under a new id (import-<src>-<n>) and keeps the old copy. Malformed lines carry line numbers, suspected secrets are reported by position only, permission-class records are counted, not imported. Returns a single-file or per-file batch summary. ' +
      '（从 Claude Code JSONL transcript 复制导入历史对话为可续聊的 DSH 会话；全保真映射、按 cwd 挂接工作区；复制式迁移，绝不删除源文件或改写既有会话；重复导入增量续写，force=true 另存新 id 完整副本；畸形行报行号、密钥只报位置、权限类记录只统计。）',
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
          exec?.signal, config,
        )
        return { mode: 'batch', ...batch }
      }
      exec?.signal?.throwIfAborted()
      const persisted = await listPersistedIds(ctx)
      const single = await importTranscript(ctx, target, args, maxBytes, persisted, undefined, exec?.signal, config)
      return { mode: 'single', ...single }
    },
  })
}

// ── 会话回迁导出（F18）：DSH 会话 → Claude 可 resume JSONL ────────────────────

/** claude_export 输出 schema。 */
const exportResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', required: true },
    path: { type: 'string', required: true },
    title: { type: 'string' },
    cwd: { type: 'string' },
    lines: { type: 'integer', required: true },
    turns: { type: 'integer', required: true },
    user: { type: 'integer', required: true },
    assistant: { type: 'integer', required: true },
    toolCalls: { type: 'integer', required: true },
    toolResults: { type: 'integer', required: true },
  },
}

/**
 * 回迁导出落点目录：config.exportDir 显式给出则按绝对路径解析，否则
 * `$DSH_HOME/claude-export`（DSH_HOME 缺失时 `~/.dsh/claude-export`）。
 * @param config - 插件配置。
 * @param env - 环境对象，缺省 process.env。
 * @returns 目录绝对路径。
 */
export function resolveExportDir(config, env = process.env) {
  if (typeof config?.exportDir === 'string' && config.exportDir.trim().length > 0) {
    return path.resolve(config.exportDir)
  }
  const base = env.DSH_HOME || path.join(homedir(), '.dsh')
  return path.join(base, 'claude-export')
}

/**
 * 解析导出目标文件路径：显式 path（支持 `~`）直接解析；缺省落回
 * `<exportDir>/<sanitized-sessionId>.jsonl`。
 * @param raw - 工具参数里的 path。
 * @param sessionId - DSH 会话 id。
 * @param config - 插件配置。
 * @returns 绝对文件路径。
 */
export function resolveExportTarget(raw, sessionId, config) {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const expanded = raw.startsWith('~')
      ? path.join(homedir(), raw.slice(1).replace(/^[\\/]+/, ''))
      : raw
    return path.resolve(expanded)
  }
  const safe = String(sessionId ?? '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)
  return path.join(resolveExportDir(config), `${safe || 'session'}.jsonl`)
}

/**
 * 执行一次回迁导出：读 DSH 会话日志（sessionPersistence.readFrom）→ 反向折叠为
 * Claude 可 resume JSONL → 写入目标文件。只读源会话、只写导出落点文件，绝不
 * 改写 DSH 会话日志。会话不可读/无可导出内容时大声失败。
 * @param ctx - Cordis 上下文。
 * @param config - 插件配置。
 * @param args - 工具参数 `{ sessionId, path? }`。
 * @param signal - 可选 AbortSignal。
 * @returns `{ sessionId, path, title, cwd, lines, turns, user, assistant, toolCalls, toolResults }`。
 */
export async function runExport(ctx, config, args, signal) {
  const sp = ctx.get('sessionPersistence')
  if (!sp || typeof sp.readFrom !== 'function') {
    throw new Error('会话持久化服务（sessionPersistence）不可用：claude-move 回迁导出需要该服务')
  }
  const sessionId = typeof args?.sessionId === 'string' ? args.sessionId.trim() : ''
  if (sessionId.length === 0) throw new Error('sessionId 必填：要回迁为 Claude jsonl 的 DSH 会话 id')
  signal?.throwIfAborted()
  let read
  try {
    read = await sp.readFrom(sessionId, 0)
  } catch (err) {
    throw new Error(`读取会话 ${sessionId} 失败（不存在或不可读）：${String((err && err.message) || err)}`)
  }
  const events = Array.isArray(read?.events) ? read.events : null
  if (!events || events.length === 0) throw new Error(`会话 ${sessionId} 无日志事件，无法导出`)
  const cwd = typeof read?.meta?.cwd === 'string' ? read.meta.cwd : null
  const result = eventsToClaudeJsonl({ events, sessionId, cwd })
  if (result.lines.length === 0) {
    throw new Error(`会话 ${sessionId} 无可导出的对话内容（user/assistant/tool 轮次为空）`)
  }
  const target = resolveExportTarget(args?.path, sessionId, config)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, result.lines.map((l) => l + '\n').join(''), 'utf8')
  return {
    sessionId,
    path: target,
    title: result.title ?? null,
    cwd,
    lines: result.lines.length,
    turns: result.counts.turns,
    user: result.counts.user,
    assistant: result.counts.assistant,
    toolCalls: result.counts.toolCalls,
    toolResults: result.counts.toolResults,
  }
}

/** claude_export 结果的模型可读摘要（中文）。 */
export function renderExport(args, value) {
  const lines = [
    `已把 DSH 会话 ${value.sessionId} 回迁为 Claude 可 resume JSONL：`,
    `- 输出文件：${value.path}`,
    `- 轮次 ${value.turns}、用户消息 ${value.user}、助手消息 ${value.assistant}、` +
      `工具调用 ${value.toolCalls}、工具结果 ${value.toolResults}（共 ${value.lines} 行）`,
    value.title ? `- 标题：${value.title}` : null,
    value.cwd ? `- 工作目录：${value.cwd}` : '- 工作目录：未知（Claude 打开时回退当前目录）',
    'Claude Code 续接：claude --resume <输出文件>（或放入项目 .claude/projects 后 resume）。',
  ].filter(Boolean)
  return [{ type: 'text', text: lines.join('\n') }]
}

function makeExportTool(ctx, config) {
  return defineTool({
    name: 'claude_export',
    description:
      'Export a DSH session back into a resumable Claude Code JSONL transcript (user/assistant/tool turns, thinking and tool_use/tool_result pairing, file reference best-effort mapping). Read-only on the source session; writes one .jsonl target. Round-trips the same shape claude_scan/import_claude consume, so the export can be re-imported or resumed by Claude Code. ' +
      '（把 DSH 会话回迁为 Claude Code 可 resume 的 JSONL transcript：覆盖 user/assistant/tool 轮次、thinking 与 tool_use/tool_result 配对、文件引用尽力映射。只读源会话，只写一个目标 .jsonl；与 import_claude 同构，可被再次导入或由 Claude Code resume。）',
    parameters: {
      sessionId: {
        type: 'string',
        required: true,
        description: '要导出的 DSH 会话 id（会话列表/import_claude 结果中的 dshSessionId）。',
      },
      path: {
        type: 'string',
        description: `可选：目标 .jsonl 文件路径（支持 ~）。缺省写入 ${resolveExportDir(config)}/<sessionId>.jsonl。`,
      },
    },
    output: { schema: exportResultSchema, render: renderExport },
    async execute(args, exec) {
      return runExport(ctx, config, args, exec?.signal)
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
    config,
    claudeHome: config.claudeHome ? path.resolve(config.claudeHome) : locateClaudeHome(),
    fileCache: makeFileCache(),
    memoryDirCache: null,
    indexMapCache: null,
    sourceCwdCache: null,
    invalidateSkills: null,
    registeredCommands: new Set(),
    lastWizardRun: null,
  }
}

/**
 * 同步解析导入会话的源 Claude 项目 cwd（E2 保真映射）：claudecode 模式下
 * 会话 header.cwd 是工作区目录，这里经 imports.json（dshId → sourcePath，
 * 记录含 sourceCwd 字段时直接用）+ index.json 书签（sourcePath → cwd）找回
 * 原项目目录。两个缓存文件按 mtime/ctime 失效；缺失/损坏时回退 null（注入层
 * 按无项目处理）。per-project 模式恒返回 null（header.cwd 即源目录）。
 * @param state - 插件状态。
 * @param sessionId - 当前会话 id。
 * @returns 源项目 cwd 或 null。
 */
export function sourceCwdSync(state, sessionId) {
  if (!state || workspaceModeOf(state.config) !== 'claudecode') return null
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null
  const cacheDir = resolveCacheDir()
  const importsPath = path.join(cacheDir, 'imports.json')
  const indexPath = path.join(cacheDir, 'index.json')
  let importsStat = null
  let indexStat = null
  try {
    const st = statSync(importsPath)
    if (st.isFile()) importsStat = st
  } catch { /* 无 imports.json */ }
  try {
    const st = statSync(indexPath)
    if (st.isFile()) indexStat = st
  } catch { /* 无 index.json */ }

  const c = state.sourceCwdCache ?? (state.sourceCwdCache = {})
  if (!c.byDshId || c.importsMtimeMs !== importsStat?.mtimeMs || c.importsCtimeMs !== importsStat?.ctimeMs) {
    let imports = {}
    if (importsStat) {
      try {
        const parsed = JSON.parse(readFileSync(importsPath, 'utf8'))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) imports = parsed
      } catch { /* 损坏：空映射 */ }
    }
    const byDshId = new Map()
    for (const [sourcePath, entry] of Object.entries(imports)) {
      const rec = unwrapImport(entry)
      if (rec && typeof rec.dshId === 'string') {
        byDshId.set(rec.dshId, { sourcePath, sourceCwd: typeof rec.sourceCwd === 'string' ? rec.sourceCwd : null })
      }
    }
    c.byDshId = byDshId
    c.importsMtimeMs = importsStat?.mtimeMs
    c.importsCtimeMs = importsStat?.ctimeMs
  }
  const rec = c.byDshId.get(sessionId)
  if (!rec) return null
  if (rec.sourceCwd) return rec.sourceCwd
  // 旧版 imports 记录无 sourceCwd：用 index.json 书签兜底。
  if (!c.byFile || c.indexMtimeMs !== indexStat?.mtimeMs || c.indexCtimeMs !== indexStat?.ctimeMs) {
    const byFile = new Map()
    if (indexStat) {
      try {
        const parsed = JSON.parse(readFileSync(indexPath, 'utf8'))
        for (const [file, header] of Object.entries(parsed?.files ?? {})) {
          if (header && typeof header.cwd === 'string') byFile.set(file, header.cwd)
        }
      } catch { /* 损坏：无兜底 */ }
    }
    c.byFile = byFile
    c.indexMtimeMs = indexStat?.mtimeMs
    c.indexCtimeMs = indexStat?.ctimeMs
  }
  return c.byFile.get(rec.sourcePath) ?? null
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
          const header = assemble?.agent?.session?.header
          const cwd = header?.cwd
          const dirs = memoryDirsSync(state)
          // claudecode 模式下 header.cwd 是工作区目录，按 imports/index 找回
          // 源项目 cwd 做 current-project 匹配；找不到时回退全部项目。
          const srcCwd = sourceCwdSync(state, header?.id) ?? cwd
          const currentDir = typeof srcCwd === 'string' && srcCwd.length > 0 ? cwdMemoryDirSync(state, srcCwd) : null
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
          const header = assemble?.agent?.session?.header
          const cwd = header?.cwd
          const globalPath = path.join(state.claudeHome, 'CLAUDE.md')
          const globalText = fileExists(globalPath) ? state.fileCache.read(globalPath) : null
          // 同上：claudecode 模式先找回源项目 cwd 再定位项目级 CLAUDE.md。
          const srcCwd = sourceCwdSync(state, header?.id) ?? cwd
          const projectPath = typeof srcCwd === 'string' && srcCwd.length > 0
            ? path.join(srcCwd, '.claude', 'CLAUDE.md')
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
    description: 'One-shot migration: scan the local Claude Code data and import every session, then report and inject the summary into the current session（一键全量迁移：扫描本机 Claude Code 数据并导入全部会话，输出报告并注入当前会话）',
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
          invocation.signal, config,
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
    description: 'Continue a Claude Code session: latest | session id | title keyword; imports first if needed, then continues via a static handoff summary（继续 Claude Code 会话：latest | 会话ID | 标题关键词；未导入的先导入，再以静态交接摘要继续）',
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
          }, config)
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
        const handoff = buildHandoff(converted, {
          maxChars: resumeMaxChars,
          title: session.title,
          ...(typeof session.cwd === 'string' ? { sourceCwd: session.cwd } : {}),
          ...(workspaceModeOf(config) === 'claudecode' ? { workspaceCwd: resolveClaudecodeDir(config) } : {}),
        })
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
    description: 'Reset this plugin cache (scan bookmarks and import map); imported DSH sessions are kept（重置本插件缓存：扫描书签与导入映射，保留已导入的 DSH 会话）',
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

  // F18：DSH 会话回迁 Claude 可 resume JSONL（双向迁移的导出方向）。
  if (config.enableExport !== false) {
    commands.register({
      name: 'claude-export',
      description: 'Export a DSH session into a resumable Claude Code JSONL transcript（把 DSH 会话回迁为 Claude Code 可 resume 的 JSONL transcript）',
      input: { hint: '<DSH 会话 id> [目标 .jsonl 路径]' },
      handler: async (invocation) => {
        try {
          const parts = invocation.rawInput.trim().split(/\s+/)
          const sessionId = parts[0]
          if (!sessionId) {
            return { kind: 'error', text: '请提供要导出的 DSH 会话 id：/claude-export <sessionId> [path]' }
          }
          const value = await runExport(ctx, config, { sessionId, path: parts[1] }, invocation.signal)
          const text = renderExport({}, value).map((b) => b.text).join('\n')
          return { kind: 'success', text }
        } catch (err) {
          return { kind: 'error', text: 'claude-export 失败：' + String((err && err.message) || err) }
        }
      },
    })
  }
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
  // webServer.register 返回的 disposer 是唯一注销途径（重复 exact 路由会抛
  // duplicate route），不随 fiber 自动撤销：逐个收集，函数末尾挂进一个
  // ctx.effect，fiber 卸载时逆序摘除全部路由。
  /** @type {Array<(() => void) | undefined>} */
  const routeDisposers = []

  // 官方后台任务服务（B5）：特性探测，缺失回退自有 job Map（rc.6 兼容）。
  const hostJobs = typeof ctx.get === 'function' ? ctx.get('jobs') : undefined

  routeDisposers.push(webServer.register({
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
  }))

  routeDisposers.push(webServer.register({
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
            const single = await importTranscript(ctx, target, { force: body && body.force === true }, maxBytes, persisted, undefined, controller.signal, config)
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
            config.importConcurrency ?? DEFAULT_IMPORT_CONCURRENCY, controller.signal, config)
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
  }))

  routeDisposers.push(webServer.register({
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
  }))

  routeDisposers.push(webServer.register({
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
  }))

  routeDisposers.push(webServer.register({
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
  }))

  // 路由随本插件生命周期撤销：fiber 卸载时逆序执行全部 disposer。
  ctx.effect(() => () => {
    for (const dispose of routeDisposers.splice(0).reverse()) dispose?.()
  }, 'claude-move: web panel routes')
}

// ── 四合一迁移向导：move_detect / move_preview / move_run + /move ──────────────
//
// 阶段：detect（四源只读扫描）→ preview（幂等状态/diff/冲突）→ run（审批门 +
// 逐项落盘 + manifest 记录）→ report。核心状态机在 lib/wizard.mjs（纯编排），
// 本段只做 DSH 端口接线：源解析器/映射器、会话导入（复用 persistConverted +
// 各源转换器）、$DSH_HOME/skills 与 AGENTS.md 写入、ctx.commands 注册、
// ctx.approval 审批（特性探测，fail-closed）。

/** 源解析器/映射器注册表（按源标识）。 */
const WIZARD_PARSERS = { claude: claudeParser, codex: codexParser, opencode: opencodeParser, hermes: hermesParser }
const WIZARD_MAPPERS = { claude: claudeMapper, codex: codexMapper, opencode: opencodeMapper, hermes: hermesMapper }

/** 向导覆盖的源列表（config.sources 过滤未知值）。 */
export function wizardSourcesOf(config) {
  const want = config?.sources ?? ['claude', 'codex', 'opencode', 'hermes']
  return (Array.isArray(want) ? want : []).filter((s) => WIZARD_PARSERS[s])
}

/** 向导技能落点：config.skillsDir 或 `$DSH_HOME/skills`（官方用户技能根）。 */
export function wizardSkillsDir(config, env = process.env) {
  if (typeof config?.skillsDir === 'string' && config.skillsDir.trim().length > 0) {
    return path.resolve(config.skillsDir)
  }
  return path.join(env.DSH_HOME || path.join(homedir(), '.dsh'), 'skills')
}

/** 向导记忆/指令落点：config.agentsMdPath 或 `$DSH_HOME/AGENTS.md`。 */
export function wizardAgentsMdPath(config, env = process.env) {
  if (typeof config?.agentsMdPath === 'string' && config.agentsMdPath.trim().length > 0) {
    return path.resolve(config.agentsMdPath)
  }
  return defaultAgentsMdPath(env)
}

/**
 * 注册一条迁移来的 DSH 命令：把源提示词注入当前会话（绝不执行脚本）。
 * 命令由 manifest 在 apply 时重建，迁移完成后即时注册。
 * @param state - 插件状态（registeredCommands 去重）。
 * @param name - 命令名（kebab-case）。
 * @param prompt - 提示词全文。
 * @returns `{ registered: boolean, reason? }`。
 */
export function registerMigratedCommand(state, name, prompt) {
  if (!state || typeof name !== 'string' || name.length === 0) {
    return { registered: false, reason: '命令名无效' }
  }
  if (state.registeredCommands.has(name)) return { registered: true }
  // 延迟到 commands 服务可用（apply 阶段重建路径）。
  if (!state.commandsService || typeof state.commandsService.register !== 'function') {
    return { registered: false, reason: 'commands 服务不可用' }
  }
  const firstLine = String(prompt ?? '').split(/\r?\n/).find((l) => l.trim().length > 0) ?? ''
  state.commandsService.register({
    name,
    description: 'Migrated command (imported by dsh-claude-move from another agent): ' + firstLine.slice(0, 100) + '（迁移导入的命令，注入提示词到当前会话）',
    handler: async (invocation) => {
      const injected = injectContext(invocation.agent, String(prompt ?? '').trim())
      return {
        kind: 'success',
        text: (injected ? '（提示词已注入当前会话）' : '') + String(prompt ?? '').trim(),
      }
    },
  })
  state.registeredCommands.add(name)
  return { registered: true }
}

/**
 * 构造向导运行时端口（lib/wizard.mjs 的依赖注入面）。
 * @param ctx - Cordis 上下文。
 * @param config - 插件配置。
 * @param state - 插件状态。
 * @returns wizard 运行时对象。
 */
export function makeWizardRuntime(ctx, config, state) {
  const skillsDir = wizardSkillsDir(config)
  const agentsMdPath = wizardAgentsMdPath(config)
  const maxBytes = config.maxTranscriptBytes ?? DEFAULT_MAX_TRANSCRIPT_BYTES
  const homeOf = (source) => {
    switch (source) {
      case 'codex': return config.codexHome ? path.resolve(config.codexHome) : codexParser.locateHome()
      case 'opencode': return config.opencodeDataHome ? path.resolve(config.opencodeDataHome) : opencodeParser.locateHome()
      case 'hermes': return config.hermesHome ? path.resolve(config.hermesHome) : hermesParser.locateHome()
      default: return config.claudeHome ? path.resolve(config.claudeHome) : locateClaudeHome()
    }
  }

  return {
    /** 源数据根定位 + 白名单扫描。 */
    async detect(source, opts = {}) {
      const parser = WIZARD_PARSERS[source]
      if (!parser) throw new Error('未知源：' + source)
      const home = homeOf(source)
      if (source === 'opencode') {
        const configHome = config.opencodeConfigHome
          ? path.resolve(config.opencodeConfigHome)
          : opencodeParser.locateConfigHome()
        return parser.detect(home, { configHome, signal: opts.signal })
      }
      return parser.detect(home, { signal: opts.signal })
    },
    /** 清单 → 迁移计划（各源映射器）。 */
    async map(source, detection) {
      const mapper = WIZARD_MAPPERS[source]
      if (!mapper) throw new Error('未知源：' + source)
      return mapper.mapSource(source, detection, { skillsDir, agentsMdPath })
    },
    /** 目标文件读取（不存在 → null）。 */
    async readTarget(p) {
      try {
        return await readFile(p, 'utf8')
      } catch {
        return null
      }
    },
    /** 目标文件写入（只写 $DSH_HOME 下的 skills/AGENTS.md 等落点）。 */
    async writeTarget(p, content) {
      await mkdir(path.dirname(p), { recursive: true })
      await writeFile(p, content, 'utf8')
    },
    /** 源文件读取（不存在 → null）。 */
    async readSource(p) {
      try {
        return await readFile(p, 'utf8')
      } catch {
        return null
      }
    },
    /** 冲突 rename：技能目录名加 -2/-3 后缀避让。 */
    async renameTarget(p) {
      const parent = path.dirname(path.dirname(p))
      const name = path.basename(path.dirname(p))
      for (let n = 2; ; n++) {
        const candidate = path.join(parent, `${name}-${n}`)
        if (!existsSync(candidate)) return path.join(candidate, 'SKILL.md')
      }
    },
    /** 会话导入：按 provider 转换 → persistConverted（复用一期幂等/增量/force）。 */
    async importSession(plan, { force }) {
      const fs = requireFs(ctx)
      const sourceKey = plan.source.importKey ?? plan.source.file
      let converted
      let secrets = { total: 0, hits: [] }
      let statInfo = {}
      if (plan.provider === 'opencode') {
        const loaded = plan.source.storage === 'opencode-legacy'
          ? await loadLegacySessionRows(plan.source.dataHome, plan.source.sessionId)
          : loadDbSessionRows(plan.source.file, plan.source.sessionId)
        if (!loaded) throw new Error('OpenCode 会话不可读：' + plan.source.sessionId)
        converted = convertOpencodeRows(loaded, {})
      } else {
        const target = await fs.resolve(plan.source.file)
        const info = await fs.stat(target)
        if (info && typeof info.size === 'number' && info.size > maxBytes) {
          throw new Error(`transcript 过大（${info.size} 字节 > maxTranscriptBytes ${maxBytes}）：请调高 maxTranscriptBytes 后重试`)
        }
        const raw = await fs.readText(target)
        converted = plan.provider === 'codex'
          ? convertCodexJsonl(raw, {})
          : convertClaudeJsonl(raw, {})
        if (!converted.events.some((e) => e.type === 'session/title')) {
          appendTitleEvent(converted, plan.title)
        }
        secrets = scanSecrets(raw)
        statInfo = {
          sizeBytes: info && typeof info.size === 'number' ? info.size : undefined,
          mtimeMs: info && typeof info.mtimeMs === 'number' ? info.mtimeMs : undefined,
        }
      }
      const persisted = await listPersistedIds(ctx)
      // 向导归组：workspaceMode 'wizard' → imports/<source> 工作区（applyWorkspaceCwd/attachImportedSession 已支持）。
      const wizardConfig = {
        ...config,
        workspaceMode: 'wizard',
        wizardSource: plan.from ?? plan.provider,
        moveWorkspaceMode: config.moveWorkspaceMode,
      }
      const single = await persistConverted(ctx, converted, { force }, persisted, sourceKey, statInfo, wizardConfig)
      single.secrets = secrets
      return single
    },
    /** DSH 命令注册（迁移来的纯提示词命令）。 */
    async registerCommand(name, prompt) {
      return registerMigratedCommand(state, name, prompt)
    },
    /** 命令是否已由本插件注册（幂等预览用）。 */
    hasCommand(name) {
      return state.registeredCommands.has(name)
    },
    /**
     * 审批端口（fail-closed）：ctx.approval 特性探测；无服务/无 agent/无开放
     * 回合一律 'unavailable'（不写任何内容）。
     */
    async approval(args = {}) {
      const service = ctx.get('approval')
      if (!service || typeof service.request !== 'function' || !args.agent) return 'unavailable'
      try {
        return await service.request({
          agent: args.agent,
          toolName: args.toolName ?? 'move_run',
          ...(args.callId ? { callId: args.callId } : {}),
          reason: args.reason,
          ...(args.signal ? { signal: args.signal } : {}),
        })
      } catch {
        // 无开放回合等：审批不可用，fail-closed。
        return 'unavailable'
      }
    },
    /** move.json 清单。 */
    async loadManifest() {
      return manifestStore.load()
    },
    /** 记录一条已执行计划（串行 + 原子写）。 */
    async record(key, rec) {
      return manifestStore.update((manifest) => {
        manifest[key] = { appliedAt: new Date().toISOString(), ...rec }
      })
    },
    /**
     * 会话导入状态（幂等预览）：imports.json + 持久化列表；源轮次增加 →
     * 'updates'（增量续写）。
     */
    async sessionStatus(source) {
      const key = source.importKey ?? source.file
      const imports = await loadImports(resolveCacheDir())
      const rec = unwrapImport(imports[key])
      if (!rec || typeof rec.dshId !== 'string') return 'none'
      const persisted = await listPersistedIds(ctx)
      if (!persisted.has(rec.dshId)) return 'none'
      if (typeof rec.turns === 'number' && typeof source.turns === 'number' && source.turns > rec.turns) {
        return 'updates'
      }
      return 'imported'
    },
  }
}

/** move_detect 输出 schema（宽松，源内部结构由解析器决定）。 */
const moveDetectSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    stats: { type: 'object', additionalProperties: true, required: true },
    sources: { type: 'array', required: true },
  },
}

/** move_preview 输出 schema。 */
const movePreviewSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    counts: { type: 'object', additionalProperties: true, required: true },
    conflicts: { type: 'array', required: true },
    previews: { type: 'array', required: true },
  },
}

/** move_run 输出 schema（宽松：execution 报告字段）。 */
const moveRunSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    approved: { type: 'boolean' },
    outcome: { type: 'string' },
    applied: { type: 'integer' },
    skipped: { type: 'integer' },
    conflictSkipped: { type: 'integer' },
    unsupported: { type: 'integer' },
    failed: { type: 'integer' },
    results: { type: 'array' },
  },
}

/** 源显示名（报告用）。 */
const SOURCE_LABELS = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', hermes: 'Hermes' }

/** move_detect 结果摘要（中文，一句角色陈述开头）。 */
export function renderMoveDetect(args, value) {
  const lines = [personaSentence('迁移', 'zh') + '检测到以下可迁移内容：']
  for (const d of value.sources ?? []) {
    const label = SOURCE_LABELS[d.source] ?? d.source
    lines.push(`- ${label}（${d.home}${d.homeExists ? '' : '，不存在'}）：` +
      `会话 ${d.sessions?.length ?? 0}、技能 ${d.skills?.length ?? 0}、记忆 ${d.memories?.length ?? 0}、` +
      `指令 ${d.instructions?.length ?? 0}、命令 ${d.commands?.length ?? 0}、钩子 ${d.hooks?.length ?? 0}` +
      (d.errors?.length ? `、错误 ${d.errors.length}` : ''))
  }
  if (!(value.sources ?? []).length) lines.push('- 未选择任何源（检查 config.sources）。')
  lines.push('下一步：move_preview 查看逐项状态与冲突 diff；move_run 执行迁移。')
  return [{ type: 'text', text: lines.join('\n') }]
}

/** move_preview 结果摘要（状态计数 + 冲突 diff）。 */
export function renderMovePreview(args, value) {
  const c = value.counts ?? {}
  const lines = [personaSentence('迁移', 'zh') + `预览完成：新增 ${c.new ?? 0}、更新 ${c.changed ?? 0}、` +
    `幂等跳过 ${c.unchanged ?? 0}、冲突 ${c.conflict ?? 0}、不支持 ${c.unsupported ?? 0}。`]
  for (const conflict of value.conflicts ?? []) {
    lines.push(`- 冲突：${conflict.key}（${conflict.reason ?? ''}）`)
    if (conflict.existing) {
      lines.push(`  目标现状：${String(conflict.existing).slice(0, 200)}`)
    }
    for (const line of (conflict.diff ?? []).slice(0, 12)) lines.push('  ' + line)
    if ((conflict.diff ?? []).length > 12) lines.push('  …（diff 截断）')
  }
  for (const p of value.previews ?? []) {
    if (p.status === 'unsupported') lines.push(`- 不支持：${p.key}（${p.reason ?? ''}）`)
  }
  lines.push('执行：move_run { resolve: { "<key>": "skip|overwrite|rename|merge" } } 逐项选择冲突解法（默认跳过，绝不猜测）。')
  return [{ type: 'text', text: lines.join('\n') }]
}

/** move_run 结果摘要（报告：短 persona 开头 + 计数 + 不支持清单）。 */
export function renderMoveRun(args, value) {
  const lines = reportLines(value)
  return [{ type: 'text', text: lines.join('\n') }]
}

/** 构造 move_detect / move_preview / move_run 三个工具。 */
function makeMoveTools(ctx, config, state) {
  const runtime = makeWizardRuntime(ctx, config, state)
  const sourcesOf = (raw) => {
    if (typeof raw === 'string' && raw !== 'all' && WIZARD_PARSERS[raw]) return [raw]
    return wizardSourcesOf(config)
  }

  const detectTool = defineTool({
    name: 'move_detect',
    description:
      'Detect migratable data from other coding agents (Claude Code / Codex / OpenCode / Hermes) with a read-only whitelist scan: sessions, skills, memories, instruction files, commands and hooks. Returns per-source counts and errors. Use move_preview next for per-item status and conflict diffs. ' +
      '（只读白名单扫描四源（Claude Code/Codex/OpenCode/Hermes）可迁移内容：会话/技能/记忆/指令/命令/钩子，逐源计数与错误。下一步 move_preview。）',
    parameters: {
      source: {
        type: 'string',
        enum: ['all', 'claude', 'codex', 'opencode', 'hermes'],
        description: "可选：'all'（默认）或单个源标识。",
      },
    },
    output: { schema: moveDetectSchema, render: renderMoveDetect },
    async execute(args, exec) {
      const detections = []
      for (const source of sourcesOf(args?.source)) {
        exec?.signal?.throwIfAborted()
        detections.push(await runtime.detect(source, { signal: exec?.signal }))
      }
      return mergeDetections(detections)
    },
  })

  const previewTool = defineTool({
    name: 'move_preview',
    description:
      'Preview the four-source migration plan: per-item idempotent status (new/changed/unchanged/conflict/unsupported), conflict diffs when a target was manually edited, and counts. No writes. Use move_run to execute; pass resolve per conflict key (skip/overwrite/rename/merge, default skip). ' +
      '（预览四源迁移计划：逐项幂等状态（新增/更新/跳过/冲突/不支持）、目标被手工修改时的冲突 diff 与计数。零写入。执行用 move_run，冲突按 key 传 resolve。）',
    parameters: {
      source: {
        type: 'string',
        enum: ['all', 'claude', 'codex', 'opencode', 'hermes'],
        description: "可选：'all'（默认）或单个源标识。",
      },
      force: {
        type: 'boolean',
        description: '可选：true 时把已迁移项标为重新应用（默认 false）。',
      },
    },
    output: { schema: movePreviewSchema, render: renderMovePreview },
    async execute(args, exec) {
      const detections = []
      for (const source of sourcesOf(args?.source)) {
        exec?.signal?.throwIfAborted()
        detections.push(await runtime.detect(source, { signal: exec?.signal }))
      }
      const plans = []
      for (const detection of detections) {
        const mapped = await runtime.map(detection.source, detection)
        plans.push(...(mapped.plans ?? []))
      }
      const manifest = await runtime.loadManifest()
      const preview = await runPreview(runtime, plans, manifest, args?.force === true)
      state.lastWizardRun = { detections, plans, preview, execution: null }
      return {
        counts: preview.counts,
        conflicts: preview.conflicts.map((c) => ({
          key: c.plan.key,
          reason: c.reason,
          ...(c.diff ? { diff: c.diff } : {}),
          ...(c.existing ? { existing: c.existing } : {}),
        })),
        previews: preview.previews.map((p) => ({
          key: p.plan.key,
          source: p.plan.from,
          kind: p.plan.kind,
          status: p.status,
          reason: p.reason,
        })),
      }
    },
  })

  const runTool = defineTool({
    name: 'move_run',
    description:
      'Execute the four-source migration after approval (ctx.approval; fails closed when unavailable or rejected — nothing is written). Import sessions (resumable), copy/convert skills into $DSH_HOME/skills, append memories/instructions as managed sections of $DSH_HOME/AGENTS.md, register prompt-only commands. Idempotent via move.json manifest; force re-applies; conflicts need per-key resolve (skip/overwrite/rename/merge, default skip). ' +
      '（审批后执行四源迁移（fail-closed：审批不可用/拒绝时零写入）。导入可续聊会话、技能拷入 $DSH_HOME/skills、记忆/指令追加为 $DSH_HOME/AGENTS.md 管理段、纯提示词命令注册为 DSH 命令。move.json 幂等；force 重应用；冲突按 key 传 resolve。）',
    parameters: {
      source: {
        type: 'string',
        enum: ['all', 'claude', 'codex', 'opencode', 'hermes'],
        description: "可选：'all'（默认）或单个源标识。",
      },
      selection: {
        type: 'array',
        items: { type: 'string' },
        description: '可选：只执行这些计划 key（move_preview 输出里的 key）。',
      },
      resolve: {
        type: 'object',
        additionalProperties: true,
        description: '可选：冲突解法映射 { "<key>": "skip|overwrite|rename|merge" }；默认 skip（绝不猜测）。merge 只对 AGENTS.md 段有效。',
      },
      force: {
        type: 'boolean',
        description: '可选：true 重新应用已迁移项（默认 false）。',
      },
    },
    output: { schema: moveRunSchema, render: renderMoveRun },
    async execute(args, exec) {
      const detections = []
      for (const source of sourcesOf(args?.source)) {
        exec?.signal?.throwIfAborted()
        detections.push(await runtime.detect(source, { signal: exec?.signal }))
      }
      const plans = []
      const mapErrors = []
      for (const detection of detections) {
        const mapped = await runtime.map(detection.source, detection)
        plans.push(...(mapped.plans ?? []))
        for (const err of mapped.errors ?? []) mapErrors.push(err)
      }
      const manifest = await runtime.loadManifest()
      const preview = await runPreview(runtime, plans, manifest, args?.force === true)
      const execution = await runExecute(runtime, {
        plans,
        manifest,
        force: args?.force === true,
        resolve: args?.resolve ?? {},
        selection: args?.selection ?? [],
        requireApproval: config.requireApproval !== false,
        approval: runtime.approval,
        approvalContext: {
          agent: exec?.agent,
          toolName: 'move_run',
          callId: exec?.callId,
          signal: exec?.signal,
        },
        signal: exec?.signal,
      })
      state.lastWizardRun = { detections, plans, preview, execution }
      state.invalidateSkills?.()
      return { ...execution, ...(mapErrors.length > 0 ? { mapErrors } : {}) }
    },
  })

  return { detect: detectTool, preview: previewTool, run: runTool }
}

/**
 * 注册 /move 命令（detect | preview | run | report [source]）。
 * run 需要审批（审批服务要求模型回合内）：非交互/无审批 seam 时注入指示让
 * 模型调用 move_run 工具完成审批内执行；requireApproval=false 时直接执行。
 * @param ctx - Cordis 上下文。
 * @param config - 插件配置。
 * @param state - 插件状态。
 */
export function registerMoveCommand(ctx, config, state) {
  withService(ctx, 'commands', (commands) => {
    if (typeof commands.register !== 'function') return
    state.commandsService = commands
    const runtime = makeWizardRuntime(ctx, config, state)

    commands.register({
      name: 'move',
      description: 'Four-source migration wizard (Claude Code / Codex / OpenCode / Hermes): detect → preview → run → report（四合一迁移向导：detect 检测 → preview 预览 → run 执行 → report 报告）',
      input: { hint: 'detect | preview | run | report [source=claude|codex|opencode|hermes|all]' },
      handler: async (invocation) => {
        try {
          const parts = invocation.rawInput.trim().split(/\s+/)
          const sub = (parts[0] ?? '').toLowerCase() || 'report'
          const rawSource = parts[1] ?? 'all'
          const sources = rawSource !== 'all' && WIZARD_PARSERS[rawSource] ? [rawSource] : wizardSourcesOf(config)

          const detections = []
          for (const source of sources) detections.push(await runtime.detect(source))
          const plans = []
          for (const detection of detections) {
            const mapped = await runtime.map(detection.source, detection)
            plans.push(...(mapped.plans ?? []))
          }
          const manifest = await runtime.loadManifest()

          if (sub === 'detect') {
            const merged = mergeDetections(detections)
            const lines = renderMoveDetect({}, merged).map((b) => b.text)
            return { kind: 'success', text: lines.join('\n') }
          }

          if (sub === 'preview') {
            const preview = await runPreview(runtime, plans, manifest, false)
            state.lastWizardRun = { detections, plans, preview, execution: null }
            const lines = renderMovePreview({}, {
              counts: preview.counts,
              conflicts: preview.conflicts.map((c) => ({ key: c.plan.key, reason: c.reason, diff: c.diff, existing: c.existing })),
              previews: preview.previews.map((p) => ({ key: p.plan.key, source: p.plan.from, kind: p.plan.kind, status: p.status, reason: p.reason })),
            }).map((b) => b.text)
            return { kind: 'success', text: lines.join('\n') }
          }

          if (sub === 'run') {
            const execution = await runExecute(runtime, {
              plans,
              manifest,
              force: false,
              resolve: {},
              selection: [],
              requireApproval: config.requireApproval !== false,
              approval: runtime.approval,
              approvalContext: {}, // 命令不在模型回合内：approval 必然 unavailable（fail-closed）。
            })
            state.lastWizardRun = { detections, plans, preview: null, execution }
            if (execution.approved === false && config.requireApproval !== false) {
              // 审批必须在模型回合内：注入指示，由模型调 move_run 完成审批。
              const guidance = personaParagraph('迁移', 'zh')
                + '\n\n请在会话中运行 move_run 工具完成迁移（迁移写入需经审批，审批只能在模型回合内发起；'
                + '预览与冲突信息可用 move_preview 查看）。'
                + `\n计划数：${plans.length}；冲突默认跳过，可用 resolve 逐项选择解法。`
              injectContext(invocation.agent, guidance)
              return {
                kind: 'success',
                text: guidance + '\n\n（迁移未执行：零写入。）',
              }
            }
            const lines = reportLines(execution).join('\n')
            return { kind: 'success', text: personaParagraph('迁移', 'zh') + '\n\n' + lines }
          }

          // report：最近一次执行/预览摘要。
          const last = state.lastWizardRun
          if (last?.execution) {
            const lines = reportLines(last.execution).join('\n')
            return { kind: 'success', text: personaParagraph('迁移', 'zh') + '\n\n' + lines }
          }
          if (last?.preview) {
            const lines = renderMovePreview({}, {
              counts: last.preview.counts,
              conflicts: last.preview.conflicts.map((c) => ({ key: c.plan.key, reason: c.reason, diff: c.diff, existing: c.existing })),
              previews: [],
            }).map((b) => b.text)
            return { kind: 'success', text: lines.join('\n') }
          }
          const applied = Object.keys(manifest).length
          return {
            kind: 'success',
            text: personaParagraph('迁移', 'zh')
              + `\n\n暂无最近执行记录。move.json 共记录 ${applied} 条已迁移项。用 /move detect 或 /move preview 开始。`,
          }
        } catch (err) {
          return { kind: 'error', text: '/move 失败：' + String((err && err.message) || err) }
        }
      },
    })
  })
}

/**
 * apply 时从 manifest 重建迁移来的命令注册（重启后仍可用）。
 * @param ctx - Cordis 上下文。
 * @param state - 插件状态。
 */
export function registerManifestCommands(ctx, state) {
  withService(ctx, 'commands', (commands) => {
    if (typeof commands.register !== 'function') return
    state.commandsService = commands
    void (async () => {
      try {
        const manifest = await manifestStore.load()
        for (const record of Object.values(manifest)) {
          if (record?.action === 'register-command' && typeof record.prompt === 'string') {
            registerMigratedCommand(state, record.target, record.prompt)
          }
        }
      } catch (err) {
        console.error('[claude-move] manifest command rebuild failed:', String((err && err.message) || err))
      }
    })()
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
  if (config.enableExport !== false) ctx.tools.register(makeExportTool(ctx, config))
  if (config.enableMove !== false) {
    const move = makeMoveTools(ctx, config, state)
    ctx.tools.register(move.detect)
    ctx.tools.register(move.preview)
    ctx.tools.register(move.run)
  }
  registerContextContributions(ctx, config, state)
  registerCommands(ctx, config)
  if (config.enableMove !== false) registerMoveCommand(ctx, config, state)
  registerWebRoutes(ctx, config, state)
  registerManifestCommands(ctx, state)
}
