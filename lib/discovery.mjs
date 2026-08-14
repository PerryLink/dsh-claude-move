// SPDX-License-Identifier: Apache-2.0
// lib/discovery.mjs — Claude Code 数据自动发现（F1-F4，零 DSH 依赖）。
//
// 定位 Claude 数据根目录（$CLAUDE_CONFIG_DIR / ~/.claude），流式扫描
// projects/<slug>/**/*.jsonl 的头部元数据与消息/工具计数，汇总为按最近活动
// 排序的项目索引（目录存在性、git 分支与脏状态），并发现个人上下文
// （全局 CLAUDE.md、skills、每项目 memory、settings.json）。增量缓存按文件
// mtime+size 复用上次扫描结果，重复扫描只重读变化文件。
//
// 源文件一律只读；本模块绝不写入 Claude 数据目录。缓存只写本插件自己的
// 缓存目录（resolveCacheDir）。
//
// 发现约定沿用 Demogorgon314/dsh-resume-plugin（MIT，见 THIRD_PARTY_NOTICES.md）：
// projects/<slug>/<sessionId>.jsonl、custom-title→customTitle、ai-title→aiTitle、
// gitBranch 字段。

import { createReadStream, existsSync } from 'node:fs'
import { readdir, readFile, stat, mkdir, writeFile, rename, unlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { parseFrontmatter, extractMetadataType } from './frontmatter.mjs'

const execFileAsync = promisify(execFile)

/** 索引结构版本；结构变化时 bump（旧缓存直接弃用重扫）。 */
export const INDEX_VERSION = 1

/** 单个 transcript 超过该字节数时标记 oversized（仍流式扫描，不整读内存）。 */
export const DEFAULT_MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024

/** 标题兜底用首条用户提问的截断长度。 */
export const TITLE_FALLBACK_MAX = 120

/** git 子进程超时（毫秒），可用插件配置 gitTimeoutMs 覆盖。 */
export const DEFAULT_GIT_TIMEOUT_MS = 5000

/** 全量扫描的项目并发上限（C1），可用插件配置 scanConcurrency 覆盖。 */
export const DEFAULT_SCAN_CONCURRENCY = 8

/**
 * 定位 Claude 数据根目录（F1）。
 * @param env - 环境对象，缺省 process.env。
 * @param home - 用户主目录，缺省 os.homedir()。
 * @returns `$CLAUDE_CONFIG_DIR`（支持 `~` 前缀）或 `~/.claude` 的绝对路径。
 */
export function locateClaudeHome(env = process.env, home = homedir()) {
  const raw = env.CLAUDE_CONFIG_DIR
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const expanded = raw.startsWith('~')
      ? path.join(home, raw.slice(1).replace(/^[\\/]+/, ''))
      : raw
    return path.resolve(expanded)
  }
  return path.join(home, '.claude')
}

/**
 * 解析 ISO 时间戳；无效输入返回 null（调用方回退到文件 mtime）。
 * @param iso - ISO-8601 字符串。
 * @returns Unix epoch 毫秒或 null。
 */
export function parseTimestamp(iso) {
  if (typeof iso !== 'string') return null
  const n = Date.parse(iso)
  return Number.isFinite(n) ? n : null
}

/**
 * 标题归一化：单行、截断。
 * @param text - 原始标题。
 * @param limit - 最大长度（码点）。
 * @returns 归一化标题。
 */
export function normalizeTitle(text, limit = TITLE_FALLBACK_MAX) {
  const oneLine = String(text ?? '').replace(/\s+/g, ' ').trim()
  return oneLine.slice(0, limit)
}

/**
 * 读取一个技能文件并解析 frontmatter。
 * @param file - SKILL.md 或扁平 .md 的绝对路径。
 * @returns 技能条目，或 null（不存在/空体/不可读）。
 */
export async function readSkillFile(file) {
  try {
    const content = await readFile(file, 'utf8')
    const { meta, body } = parseFrontmatter(content)
    if (body.trim().length === 0) return null
    const level = meta.level ? Number.parseInt(meta.level, 10) : undefined
    return {
      name: meta.name || path.basename(file).replace(/\.md$/, ''),
      description: meta.description ?? '',
      ...(Number.isFinite(level) ? { level } : {}),
      ...(meta['argument-hint'] ? { argumentHint: meta['argument-hint'] } : {}),
      path: file,
    }
  } catch {
    return null
  }
}

/**
 * 扫描一个技能根目录：`<root>/<name>/SKILL.md` 目录束与 `<root>/<name>.md`
 * 扁平文件两种形态（Claude Code 布局）。
 * @param skillsDir - 技能根目录。
 * @returns 按名称排序的技能条目；目录不存在返回空数组。
 */
export async function scanSkills(skillsDir) {
  let entries
  try {
    entries = await readdir(skillsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const skills = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skill = await readSkillFile(path.join(skillsDir, entry.name, 'SKILL.md'))
      if (skill) skills.push(skill)
    } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'MEMORY.md') {
      const skill = await readSkillFile(path.join(skillsDir, entry.name))
      if (skill) skills.push(skill)
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 读取一个 memory 条目（名称/类型/路径，不载入正文——注入阶段再读）。
 * @param file - memory/*.md 的绝对路径。
 * @returns 条目，或 null（不可读/空体）。
 */
export async function readMemoryEntry(file) {
  try {
    const content = await readFile(file, 'utf8')
    const { meta, body } = parseFrontmatter(content)
    if (body.trim().length === 0) return null
    return {
      name: meta.name || path.basename(file).replace(/\.md$/, ''),
      type: extractMetadataType(meta),
      path: file,
    }
  } catch {
    return null
  }
}

/**
 * 探测一个文件的存在与大小；不存在返回 null。
 * @param file - 绝对路径。
 * @returns `{ path, sizeBytes }` 或 null。
 */
export async function maybeFile(file) {
  try {
    const s = await stat(file)
    if (s.isFile()) return { path: file, sizeBytes: s.size }
  } catch {
    // ENOENT/不可读：返回 null，由调用方表达「不存在」。
  }
  return null
}

/**
 * git 仓库状态（分支 + 未提交变更行数）。目录没有 .git 标记时不启动 git。
 * `knownBranch`（transcript 自带的 gitBranch 字段，C2）已给出分支时跳过
 * `rev-parse`，只跑一次 `status --porcelain` 算脏行。
 * @param cwd - 项目目录。
 * @param exec - 可注入的子进程执行器（测试用）。
 * @param timeoutMs - 子进程超时（默认 DEFAULT_GIT_TIMEOUT_MS）。
 * @param knownBranch - 已知分支名（可选）。
 * @returns `{ isRepo: true, branch, dirtyCount }` 或 null（非 git 仓库）。
 */
export async function gitStatus(cwd, { exec = execFileAsync, timeoutMs = DEFAULT_GIT_TIMEOUT_MS, knownBranch } = {}) {
  if (!existsSync(path.join(cwd, '.git'))) return null
  try {
    let branch = typeof knownBranch === 'string' && knownBranch.length > 0 ? knownBranch : null
    if (branch === null) {
      const branchResult = await exec('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
        timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20,
      })
      branch = branchResult.stdout.trim() || null
    }
    const dirtyResult = await exec('git', ['-C', cwd, 'status', '--porcelain', '--untracked-files=no'], {
      timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20,
    })
    const dirtyCount = dirtyResult.stdout.split('\n').filter((l) => l.trim().length > 0).length
    return { isRepo: true, branch, dirtyCount }
  } catch {
    // git 不可用/超时/非仓库：isRepo 但状态未知。
    return { isRepo: true, branch: typeof knownBranch === 'string' ? knownBranch : null, dirtyCount: null }
  }
}

/**
 * 流式扫描单个 transcript（F2.b）：逐行解析头部元数据与计数，不整读内存。
 * 未知字段宽容跳过；畸形行计数。
 * @param file - transcript 绝对路径。
 * @param maxBytes - oversized 判定阈值。
 * @param signal - 可选 AbortSignal；中止时抛出 signal.reason。
 * @returns 会话头记录；文件不可读时返回 `{ file, error }`。
 */
export async function scanTranscriptFile(file, { maxBytes = DEFAULT_MAX_TRANSCRIPT_BYTES, signal } = {}) {
  signal?.throwIfAborted()
  let statResult
  try {
    statResult = await stat(file)
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err
    return { file, error: String((err && err.message) || err) }
  }
  const sizeBytes = statResult.size

  const head = {
    file,
    sizeBytes,
    mtimeMs: statResult.mtimeMs,
    ctimeMs: statResult.ctimeMs,
    oversized: sizeBytes > maxBytes,
    messages: 0,
    toolCalls: 0,
    turns: 0,
    malformed: 0,
    typeCounts: {},
  }
  let sessionId = null
  let cwd = null
  let model = null
  let gitBranch = null
  let aiTitle = null
  let customTitle = null
  let firstPrompt = null
  let firstTime = null
  let lastTime = null

  const stream = createReadStream(file, { encoding: 'utf8', ...(signal ? { signal } : {}) })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    signal?.throwIfAborted()
    const trimmed = line.trim()
    if (!trimmed) continue
    let rec = null
    try {
      rec = JSON.parse(trimmed)
    } catch {
      head.malformed++
      continue
    }
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
      head.malformed++
      continue
    }

    if (typeof rec.sessionId === 'string' && sessionId === null) sessionId = rec.sessionId
    if (typeof rec.cwd === 'string' && cwd === null) cwd = rec.cwd
    if (typeof rec.message?.model === 'string' && model === null) model = rec.message.model
    if (typeof rec.gitBranch === 'string' && gitBranch === null) gitBranch = rec.gitBranch
    const ts = parseTimestamp(rec.timestamp)
    if (ts !== null) {
      if (firstTime === null || ts < firstTime) firstTime = ts
      if (lastTime === null || ts > lastTime) lastTime = ts
    }

    const type = typeof rec.type === 'string' ? rec.type : 'unknown'
    head.typeCounts[type] = (head.typeCounts[type] ?? 0) + 1

    if (type === 'custom-title' && customTitle === null && typeof rec.customTitle === 'string') {
      customTitle = rec.customTitle
    } else if (type === 'ai-title' && aiTitle === null && typeof rec.aiTitle === 'string') {
      aiTitle = rec.aiTitle
    }
    if (type === 'user') {
      head.messages++
      if (typeof rec.message?.content === 'string') head.turns++
      if (firstPrompt === null && typeof rec.message?.content === 'string') {
        firstPrompt = rec.message.content
      }
    } else if (type === 'assistant') {
      head.messages++
      const blocks = Array.isArray(rec.message?.content) ? rec.message.content : []
      head.toolCalls += blocks.filter((b) => b && b.type === 'tool_use').length
    }
  }
  stream.destroy()

  // 标题优先级：custom-title > ai-title > 首条用户提问（与 resume-plugin 一致）。
  const titleFallback = normalizeTitle(customTitle ?? aiTitle ?? firstPrompt)
  return {
    ...head,
    file,
    sessionId: sessionId ?? path.basename(file).replace(/\.jsonl$/i, ''),
    ...(cwd !== null ? { cwd } : {}),
    ...(model !== null ? { model } : {}),
    ...(gitBranch !== null ? { gitBranch } : {}),
    ...(titleFallback.length > 0 ? { title: titleFallback } : {}),
    createdAt: firstTime,
    lastActivity: lastTime,
  }
}

/**
 * 扫描一个项目目录：全部 transcript + memory + 项目级 .claude 上下文 + git。
 * @param projectDir - `projects/<slug>` 绝对路径。
 * @param opts - `scanFile`/`gitExec`/`scanGit`/`maxBytes`/`gitTimeoutMs`/`signal`。
 * @returns 项目索引条目。
 */
export async function scanProjectDir(projectDir, opts = {}) {
  const slug = path.basename(projectDir)
  const scanFile = opts.scanFile ?? scanTranscriptFile
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_TRANSCRIPT_BYTES
  const signal = opts.signal

  let entries
  try {
    signal?.throwIfAborted()
    entries = await readdir(projectDir, { recursive: true, withFileTypes: true })
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err
    return { slug, dir: projectDir, error: String((err && err.message) || err), sessions: [] }
  }

  const files = entries
    .filter((e) => e.isFile() && /\.jsonl$/i.test(e.name))
    .map((e) => path.join(e.parentPath ?? projectDir, e.name))
    .sort()

  const sessions = []
  for (const file of files) {
    signal?.throwIfAborted()
    sessions.push(await scanFile(file, { maxBytes, signal }))
  }
  sessions.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0))

  const cwd = sessions.find((s) => s.cwd && typeof s.cwd === 'string')?.cwd ?? null
  const dirExists = cwd !== null && existsSync(cwd)
  const transcriptBranch = sessions.find((s) => typeof s.gitBranch === 'string')?.gitBranch ?? null

  // git 三级开关（C2）：false 关；'branch' 只用 transcript 自带 gitBranch 字段
  // （零 git 子进程）；true（默认）复用它跳过 rev-parse，只跑 status --porcelain。
  let gitProbe = null
  if (opts.scanGit !== false && dirExists) {
    if (opts.scanGit === 'branch') {
      const hasRepo = transcriptBranch !== null || existsSync(path.join(cwd, '.git'))
      if (hasRepo) gitProbe = { isRepo: true, branch: transcriptBranch, dirtyCount: null }
    } else {
      gitProbe = gitStatus(cwd, {
        exec: opts.gitExec ?? execFileAsync,
        timeoutMs: opts.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
        ...(transcriptBranch !== null ? { knownBranch: transcriptBranch } : {}),
      })
    }
  }

  const memories = []
  try {
    signal?.throwIfAborted()
    const memoryDir = path.join(projectDir, 'memory')
    const memEntries = await readdir(memoryDir, { withFileTypes: true })
    for (const entry of memEntries) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'MEMORY.md') continue
      const mem = await readMemoryEntry(path.join(memoryDir, entry.name))
      if (mem) memories.push(mem)
    }
  } catch {
    // 无 memory 目录：留空。
  }
  memories.sort((a, b) => a.name.localeCompare(b.name))

  const projectClaudeMd = dirExists ? await maybeFile(path.join(cwd, '.claude', 'CLAUDE.md')) : null
  const projectSettings = dirExists ? await maybeFile(path.join(cwd, '.claude', 'settings.json')) : null

  return {
    slug,
    dir: projectDir,
    ...(cwd !== null ? { cwd } : {}),
    dirExists,
    ...(gitProbe ? { git: await gitProbe } : {}),
    sessions,
    memories,
    ...(projectClaudeMd ? { projectClaudeMd } : {}),
    ...(projectSettings ? { projectSettings } : {}),
  }
}

/**
 * 扫描个人上下文（F2.c）：全局 CLAUDE.md、settings.json、skills 目录。
 * @param claudeHome - Claude 数据根目录。
 * @returns personal 索引段。
 */
export async function scanPersonal(claudeHome) {
  return {
    globalClaudeMd: await maybeFile(path.join(claudeHome, 'CLAUDE.md')),
    settings: await maybeFile(path.join(claudeHome, 'settings.json')),
    skills: await scanSkills(path.join(claudeHome, 'skills')),
  }
}

/**
 * 全量/增量扫描 Claude 数据根目录（F2/F4）。
 * @param claudeHome - Claude 数据根目录。
 * @param opts - `cache`（上次 {version, files}）、`scanFile`、`gitExec`、
 *   `scanGit`（true | 'branch' | false）、`maxBytes`、`excludeProjects`（slug
 *   或子串数组）、`gitTimeoutMs`、`concurrency`（项目并发上限，C1）、`signal`。
 * @returns `{ index, files }`：files 为本次书签（mtime+size+会话头），供下次增量。
 */
export async function scanClaudeHome(claudeHome, opts = {}) {
  const cached = opts.cache && opts.cache.version === INDEX_VERSION ? opts.cache.files ?? {} : {}
  const exclude = opts.excludeProjects ?? []
  const signal = opts.signal
  const excluded = (slug) => exclude.some((x) => typeof x === 'string' && slug.includes(x))
  signal?.throwIfAborted()

  // 增量复用（F4）：mtime+size 未变的文件直接复用缓存会话头，不重读内容。
  const baseScanFile = opts.scanFile ?? scanTranscriptFile
  const scanFileCached = async (file, scanOpts) => {
    let st
    try {
      st = await stat(file)
    } catch (err) {
      if (opts.signal?.aborted) throw opts.signal.reason ?? err
      return { file, error: String((err && err.message) || err) }
    }
    const prev = cached[file]
    if (prev && !prev.error && prev.mtimeMs === st.mtimeMs && prev.ctimeMs === st.ctimeMs && prev.sizeBytes === st.size) {
      return prev
    }
    return baseScanFile(file, scanOpts)
  }

  const projectsDir = path.join(claudeHome, 'projects')
  let slugs = []
  try {
    signal?.throwIfAborted()
    slugs = (await readdir(projectsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err
    // 无 projects 目录：索引为空项目列表。
  }

  const files = {}
  const targets = []
  for (const slug of slugs) {
    if (excluded(slug)) continue
    signal?.throwIfAborted()
    targets.push(slug)
  }

  // 并行项目扫描（C1）：并发上限 scanConcurrency（默认 8），书签/索引按
  // target 顺序写入槽位，输出确定性不变；中止时任一 worker 抛出 signal.reason。
  const concurrency = Number.isInteger(opts.concurrency) && opts.concurrency > 0
    ? opts.concurrency
    : DEFAULT_SCAN_CONCURRENCY
  const projects = new Array(targets.length)
  let cursor = 0
  const workers = []
  for (let w = 0; w < Math.min(concurrency, targets.length); w++) {
    workers.push((async () => {
      for (;;) {
        const i = cursor++
        if (i >= targets.length) return
        signal?.throwIfAborted()
        const projectDir = path.join(projectsDir, targets[i])
        let project
        try {
          project = await scanProjectDir(projectDir, { ...opts, scanFile: scanFileCached })
        } catch (err) {
          if (signal?.aborted) throw signal.reason ?? err
          project = { slug: targets[i], dir: projectDir, error: String((err && err.message) || err), sessions: [] }
        }
        // 增量书签：仅当会话头是本次扫描产物时记录（跳过 error 会话）。
        for (const session of project.sessions) {
          if (!session.error) files[session.file] = session
        }
        projects[i] = project
      }
    })())
  }
  await Promise.all(workers)
  projects.sort((a, b) => latestOf(b) - latestOf(a))

  // 删除文件书签报告（C5）：上次缓存里有、本次未再出现的源文件计数。
  const cachedKeys = Object.keys(cached)
  const removedCount = cachedKeys.length > 0
    ? cachedKeys.filter((f) => !(f in files)).length
    : 0

  const personal = await scanPersonal(claudeHome)
  return {
    index: {
      version: INDEX_VERSION,
      claudeHome,
      scannedAt: new Date().toISOString(),
      projects,
      personal,
      ...(removedCount > 0 ? { removedBookmarks: removedCount } : {}),
    },
    files,
  }
}

function latestOf(project) {
  for (const session of project.sessions) {
    if (typeof session.lastActivity === 'number') return session.lastActivity
  }
  return 0
}

// ── 增量缓存 ────────────────────────────────────────────────────────────────

/**
 * 本插件缓存目录：`$DSH_HOME/claude-move`，缺省 `~/.dsh/claude-move`。
 * @param env - 环境对象，缺省 process.env。
 * @returns 缓存目录绝对路径。
 */
export function resolveCacheDir(env = process.env) {
  const base = env.DSH_HOME || path.join(homedir(), '.dsh')
  return path.join(base, 'claude-move')
}

/**
 * 读取索引缓存；缺失/损坏返回 null（下次全量）。
 * @param cacheDir - resolveCacheDir 的结果。
 * @returns `{ version, claudeHome, files }` 或 null。
 */
export async function loadCache(cacheDir) {
  try {
    const parsed = JSON.parse(await readFile(path.join(cacheDir, 'index.json'), 'utf8'))
    if (parsed && typeof parsed === 'object' && Number.isInteger(parsed.version)) return parsed
  } catch {
    // 缺失或损坏：null 表示无缓存。
  }
  return null
}

/**
 * 原子写一个 JSON 文件：先写 `<file>.tmp` 再 rename 覆盖（同卷原子替换）。
 * 并发读方要么看到完整旧文件、要么看到完整新文件，绝不读到半截 JSON。
 * @param file - 目标绝对路径。
 * @param value - JSON 可序列化值。
 */
async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, JSON.stringify(value), 'utf8')
  await rename(tmp, file)
}

/**
 * 写索引缓存。
 * @param cacheDir - resolveCacheDir 的结果。
 * @param cache - `{ version, claudeHome, files }`。
 */
export async function saveCache(cacheDir, cache) {
  await writeJsonAtomic(path.join(cacheDir, 'index.json'), cache)
}

/**
 * 读取源 sessionId → DSH 会话 id 的导入映射（导入阶段写入）。
 * @param cacheDir - resolveCacheDir 的结果。
 * @returns 映射对象，缺失返回空对象。
 */
export async function loadImports(cacheDir) {
  try {
    const parsed = JSON.parse(await readFile(path.join(cacheDir, 'imports.json'), 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    // 缺失或损坏：空映射。
  }
  return {}
}

/**
 * 写导入映射。
 * @param cacheDir - resolveCacheDir 的结果。
 * @param imports - 源 sessionId → DSH 会话 id。
 */
export async function saveImports(cacheDir, imports) {
  await writeJsonAtomic(path.join(cacheDir, 'imports.json'), imports)
}

/**
 * 重置本插件缓存（D5）：只删除 index.json/imports.json 两个数据文件及其
 * 临时文件，绝不递归删除目录。已导入的 DSH 会话数据不受影响。
 * @param cacheDir - resolveCacheDir 的结果。
 */
export async function resetCacheFiles(cacheDir) {
  for (const name of ['index.json', 'index.json.tmp', 'imports.json', 'imports.json.tmp']) {
    try {
      await unlink(path.join(cacheDir, name))
    } catch {
      // 文件不存在即视为已清。
    }
  }
}
