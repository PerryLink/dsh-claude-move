// index.mjs — dsh-claude-port host 插件入口。
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
  scanClaudeHome,
  scanProjectDir,
  scanTranscriptFile,
} from './lib/discovery.mjs'

export const name = 'claude-port'

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

/**
 * 挂载插件：注册 claude_scan 工具。
 * @param ctx - Cordis 上下文。
 * @param config - 经 Schemastery 校验的插件配置。
 */
export function apply(ctx, config = {}) {
  ctx.tools.register(makeScanTool(ctx, config))
}
