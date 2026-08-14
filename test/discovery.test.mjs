// discovery.test.mjs — 发现层单元测试（零 DSH 依赖）：路径定位、流式扫描、
// 技能/记忆/个人上下文、git 状态、增量缓存与导入映射。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import {
  INDEX_VERSION,
  locateClaudeHome,
  parseTimestamp,
  normalizeTitle,
  scanSkills,
  gitStatus,
  scanTranscriptFile,
  scanProjectDir,
  scanClaudeHome,
  resolveCacheDir,
  loadCache,
  saveCache,
  loadImports,
  saveImports,
} from '../lib/discovery.mjs'
import { parseFrontmatter, extractMetadataType } from '../lib/frontmatter.mjs'

async function makeTempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-move-test-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  return dir
}

function claudeLine(type, extra = {}) {
  return JSON.stringify({
    type,
    timestamp: '2026-08-01T10:00:00.000Z',
    sessionId: 'sess-1',
    cwd: 'C:\\work\\demo',
    message: { model: 'claude-sonnet-4-5' },
    ...extra,
  })
}

test('locateClaudeHome：CLAUDE_CONFIG_DIR 优先、~ 展开、缺省 ~/.claude', () => {
  assert.equal(locateClaudeHome({ CLAUDE_CONFIG_DIR: '/opt/claude' }, '/home/u'), path.resolve('/opt/claude'))
  assert.equal(locateClaudeHome({ CLAUDE_CONFIG_DIR: '~/claude' }, '/home/u'), path.resolve(path.join('/home/u', 'claude')))
  assert.equal(locateClaudeHome({}, '/home/u'), path.join('/home/u', '.claude'))
})

test('parseTimestamp / normalizeTitle：无效输入与换行归一', () => {
  assert.equal(parseTimestamp('2026-08-01T10:00:00Z'), Date.parse('2026-08-01T10:00:00Z'))
  assert.equal(parseTimestamp('not-a-date'), null)
  assert.equal(parseTimestamp(42), null)
  assert.equal(normalizeTitle('  a\n  b  '), 'a b')
  assert.equal(normalizeTitle('x'.repeat(300)).length, 120)
})

test('scanTranscriptFile：元数据、计数、标题优先级、畸形行', async (t) => {
  const dir = await makeTempDir(t)
  const file = path.join(dir, 'sess-1.jsonl')
  await writeFile(file, [
    claudeLine('ai-title', { aiTitle: '来自 ai-title' }),
    claudeLine('user', { message: { content: '第一个问题' } }),
    claudeLine('assistant', {
      message: {
        content: [
          { type: 'text', text: '回答' },
          { type: 'thinking', thinking: '思考' },
          { type: 'tool_use', id: 'call-1', name: 'Read', input: { file_path: 'a' } },
        ],
      },
    }),
    claudeLine('user', { message: { content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'ok' }] } }),
    claudeLine('custom-title', { customTitle: '自定义标题' }),
    claudeLine('permission', { permission: {} }),
    '{ 畸形行',
  ].join('\n') + '\n', 'utf8')

  const head = await scanTranscriptFile(file)
  assert.equal(head.sessionId, 'sess-1')
  assert.equal(head.cwd, 'C:\\work\\demo')
  assert.equal(head.model, 'claude-sonnet-4-5')
  assert.equal(head.title, '自定义标题', 'custom-title 优先于 ai-title')
  assert.equal(head.messages, 3, 'user 提问 + assistant + tool_result 各计一次')
  assert.equal(head.toolCalls, 1)
  assert.equal(head.malformed, 1)
  assert.equal(head.typeCounts.permission, 1)
  assert.ok(head.createdAt > 0)
  assert.ok(head.lastActivity > 0)
  assert.equal(typeof head.mtimeMs, 'number')
})

test('scanTranscriptFile：无标题时回退首条用户提问；不可读文件返回 error', async (t) => {
  const dir = await makeTempDir(t)
  const file = path.join(dir, 'plain.jsonl')
  await writeFile(file, claudeLine('user', { message: { content: '回退标题源' } }) + '\n', 'utf8')
  const head = await scanTranscriptFile(file)
  assert.equal(head.title, '回退标题源')

  const missing = await scanTranscriptFile(path.join(dir, 'nope.jsonl'))
  assert.ok(missing.error)
})

test('scanSkills：目录束 + 扁平文件 + frontmatter；缺失目录为空', async (t) => {
  const dir = await makeTempDir(t)
  const skills = path.join(dir, 'skills')
  await mkdir(path.join(skills, 'bundle'), { recursive: true })
  await writeFile(path.join(skills, 'bundle', 'SKILL.md'), '---\nname: bundle-skill\ndescription: 束技能\nlevel: 2\n---\n\n# 正文\n', 'utf8')
  await writeFile(path.join(skills, 'flat.md'), '---\nname: flat-skill\ndescription: 扁平技能\n---\n\n扁平正文\n', 'utf8')
  await mkdir(path.join(skills, 'empty-dir'))

  const list = await scanSkills(skills)
  assert.deepEqual(list.map((s) => s.name), ['bundle-skill', 'flat-skill'])
  assert.equal(list[0].level, 2)
  assert.equal(await (await scanSkills(path.join(dir, 'nope'))).length, 0)
})

test('gitStatus：非 git 目录不启动 git；git 目录读分支与脏行数；git 失败降级', async (t) => {
  const dir = await makeTempDir(t)
  assert.equal(await gitStatus(dir, { exec: async () => { throw new Error('不应被调用') } }), null)

  const repo = path.join(dir, 'repo')
  await mkdir(repo)
  await writeFile(path.join(repo, '.git'), '')
  const fakeExec = async (cmd, args) => {
    if (args.includes('rev-parse')) return { stdout: 'feature/x\n' }
    // --untracked-files=no：未跟踪文件不出现在 status --porcelain 输出里。
    return { stdout: ' M a.txt\n' }
  }
  assert.deepEqual(await gitStatus(repo, { exec: fakeExec }), { isRepo: true, branch: 'feature/x', dirtyCount: 1 })

  const failing = await gitStatus(repo, { exec: async () => { throw new Error('no git') } })
  assert.deepEqual(failing, { isRepo: true, branch: null, dirtyCount: null })
})

test('scanClaudeHome：项目分组、按最近活动排序、memory/personal/排除', async (t) => {
  const home = await makeTempDir(t)
  const projects = path.join(home, 'projects')
  await mkdir(path.join(projects, 'demo-a', 'memory'), { recursive: true })
  await mkdir(path.join(projects, 'demo-b'), { recursive: true })
  await writeFile(path.join(projects, 'demo-a', 'a1.jsonl'), claudeLine('user', {
    sessionId: 'a1', cwd: 'C:\\work\\a', timestamp: '2026-08-10T10:00:00.000Z', message: { content: 'a1 问题' },
  }) + '\n', 'utf8')
  await writeFile(path.join(projects, 'demo-a', 'a2.jsonl'), claudeLine('user', {
    sessionId: 'a2', cwd: 'C:\\work\\a', timestamp: '2026-08-01T10:00:00.000Z', message: { content: 'a2 问题' },
  }) + '\n', 'utf8')
  await writeFile(path.join(projects, 'demo-a', 'memory', 'note.md'), '---\nname: note\nmetadata: type: feedback\n---\n\n记住这条。\n', 'utf8')
  await writeFile(path.join(projects, 'demo-b', 'b1.jsonl'), claudeLine('user', {
    sessionId: 'b1', cwd: 'C:\\work\\b', timestamp: '2026-08-05T10:00:00.000Z', message: { content: 'b1 问题' },
  }) + '\n', 'utf8')
  await writeFile(path.join(home, 'CLAUDE.md'), '# 全局指令\n', 'utf8')
  await writeFile(path.join(home, 'settings.json'), '{ "model": "opus" }', 'utf8')
  await mkdir(path.join(home, 'skills', 'sk1'), { recursive: true })
  await writeFile(path.join(home, 'skills', 'sk1', 'SKILL.md'), '---\nname: sk1\ndescription: 技能一\n---\n\n# sk1\n', 'utf8')

  const { index, files } = await scanClaudeHome(home, { scanGit: false })
  assert.equal(index.version, INDEX_VERSION)
  assert.equal(index.projects.length, 2)
  assert.equal(index.projects[0].slug, 'demo-a', '最近活动项目在前')
  assert.equal(index.projects[0].sessions[0].sessionId, 'a1', '会话按最近活动排序')
  assert.equal(index.projects[0].sessions[0].title, 'a1 问题')
  assert.equal(index.projects[0].memories[0].type, 'feedback')
  assert.ok(index.projects[0].projectClaudeMd === undefined, '项目目录不存在则不探测 .claude/CLAUDE.md')
  assert.ok(index.personal.globalClaudeMd)
  assert.ok(index.personal.settings)
  assert.equal(index.personal.skills.length, 1)
  assert.equal(Object.keys(files).length, 3)

  const excluded = await scanClaudeHome(home, { scanGit: false, excludeProjects: ['demo-b'] })
  assert.deepEqual(excluded.index.projects.map((p) => p.slug), ['demo-a'])
})

test('scanClaudeHome：增量缓存只重读变化文件', async (t) => {
  const home = await makeTempDir(t)
  const projectDir = path.join(home, 'projects', 'demo-a')
  await mkdir(projectDir, { recursive: true })
  const f1 = path.join(projectDir, 'a1.jsonl')
  const f2 = path.join(projectDir, 'a2.jsonl')
  await writeFile(f1, claudeLine('user', { sessionId: 'a1', message: { content: 'q1' } }) + '\n', 'utf8')
  await writeFile(f2, claudeLine('user', { sessionId: 'a2', message: { content: 'q2' } }) + '\n', 'utf8')

  let reads = 0
  const countingScan = async (file, opts) => {
    reads++
    return scanTranscriptFile(file, opts)
  }
  const first = await scanClaudeHome(home, { scanGit: false, scanFile: countingScan })
  assert.equal(reads, 2)
  assert.equal(first.files[f1].sessionId, 'a1')

  const second = await scanClaudeHome(home, {
    scanGit: false, scanFile: countingScan, cache: { version: INDEX_VERSION, files: first.files },
  })
  assert.equal(reads, 2, '未变化文件全部复用缓存')

  await writeFile(f2, claudeLine('user', { sessionId: 'a2', message: { content: 'q2' } }) + '\n' + claudeLine('assistant', { message: { content: [{ type: 'text', text: '新回复' }] } }) + '\n', 'utf8')
  const third = await scanClaudeHome(home, {
    scanGit: false, scanFile: countingScan, cache: { version: INDEX_VERSION, files: second.files },
  })
  assert.equal(reads, 3, '只重读变化的 a2.jsonl')
  assert.equal(third.files[f2].messages, 2)
})

test('缓存与导入映射：roundtrip、损坏回退', async (t) => {
  const dir = await makeTempDir(t)
  assert.equal(await loadCache(dir), null)
  await saveCache(dir, { version: INDEX_VERSION, claudeHome: 'X', files: { a: { x: 1 } } })
  const cache = await loadCache(dir)
  assert.equal(cache.claudeHome, 'X')
  await writeFile(path.join(dir, 'index.json'), '{broken', 'utf8')
  assert.equal(await loadCache(dir), null)

  assert.deepEqual(await loadImports(dir), {})
  await saveImports(dir, { 'sess-1': 'import-sess-1' })
  assert.deepEqual(await loadImports(dir), { 'sess-1': 'import-sess-1' })
})

test('resolveCacheDir：DSH_HOME 优先，缺省 ~/.dsh/claude-move', () => {
  assert.equal(resolveCacheDir({ DSH_HOME: '/tmp/dsh' }), path.join('/tmp/dsh', 'claude-move'))
  assert.equal(resolveCacheDir({}), path.join(homedir(), '.dsh', 'claude-move'))
})

test('frontmatter：解析、CRLF、无 frontmatter、metadata 类型提取', () => {
  const { meta, body } = parseFrontmatter('---\r\nname: 记忆名\r\ndescription: 描述\r\n---\r\n\r\n正文\r\n')
  assert.equal(meta.name, '记忆名')
  assert.equal(meta.description, '描述')
  assert.equal(body, '正文')

  const plain = parseFrontmatter('# 无 frontmatter\n正文')
  assert.deepEqual(plain.meta, {})
  assert.equal(plain.body, '# 无 frontmatter\n正文')

  assert.equal(extractMetadataType({ type: 'project' }), 'project')
  assert.equal(extractMetadataType({ metadata: 'type: feedback' }), 'feedback')
  assert.equal(extractMetadataType({}), 'unknown')
})

test('scanProjectDir：目录不可读时返回 error 条目', async (t) => {
  const dir = await makeTempDir(t)
  const project = await scanProjectDir(path.join(dir, 'projects', 'nope'))
  assert.ok(project.error)
  assert.deepEqual(project.sessions, [])
})

test('scanClaudeHome：并行项目扫描受并发上限约束且输出确定（C1）', async (t) => {
  const home = await makeTempDir(t)
  const projects = path.join(home, 'projects')
  for (let i = 0; i < 5; i++) {
    await mkdir(path.join(projects, `demo-${i}`), { recursive: true })
    await writeFile(path.join(projects, `demo-${i}`, 's.jsonl'), claudeLine('user', {
      sessionId: `s-${i}`, cwd: `C:\\work\\${i}`,
      timestamp: `2026-08-0${i + 1}T10:00:00.000Z`, message: { content: `q${i}` },
    }) + '\n', 'utf8')
  }

  let running = 0
  let maxRunning = 0
  const scanFile = async (file, opts) => {
    running++
    maxRunning = Math.max(maxRunning, running)
    await new Promise((resolve) => setTimeout(resolve, 15))
    try {
      return await scanTranscriptFile(file, opts)
    } finally {
      running--
    }
  }
  const { index, files } = await scanClaudeHome(home, { scanGit: false, scanFile, concurrency: 3 })
  assert.ok(maxRunning <= 3, `并发不超过上限（实测 ${maxRunning}）`)
  assert.ok(maxRunning > 1, '实际并行执行')
  assert.deepEqual(index.projects.map((p) => p.slug), ['demo-4', 'demo-3', 'demo-2', 'demo-1', 'demo-0'], '按最近活动排序确定性不变')
  assert.equal(Object.keys(files).length, 5, '书签完整')

  // 串行与并发结果一致。
  const serial = await scanClaudeHome(home, { scanGit: false, concurrency: 1 })
  assert.deepEqual(serial.index.projects.map((p) => p.slug), index.projects.map((p) => p.slug))
})

test('scanTranscriptFile 捕获 gitBranch；scanProjectDir 三级 scanGit（C2）', async (t) => {
  const home = await makeTempDir(t)
  const cwd = await makeTempDir(t) // 真实存在的目录：dirExists 才允许 git 探测
  const projectDir = path.join(home, 'projects', 'demo-a')
  await mkdir(projectDir, { recursive: true })
  await writeFile(path.join(projectDir, 's.jsonl'), claudeLine('user', {
    sessionId: 's-1', cwd, gitBranch: 'feature/x', message: { content: 'q' },
  }) + '\n', 'utf8')

  const head = await scanTranscriptFile(path.join(projectDir, 's.jsonl'), {})
  assert.equal(head.gitBranch, 'feature/x', '捕获 transcript 自带分支字段')

  // scanGit=false：不探测 git，也不启动子进程。
  const off = await scanProjectDir(projectDir, { scanGit: false, gitExec: async () => { throw new Error('不应被调用') } })
  assert.equal(off.git, undefined)

  // scanGit='branch'：零 git 子进程，只用 transcript 字段。
  const branchOnly = await scanProjectDir(projectDir, { scanGit: 'branch', gitExec: async () => { throw new Error('不应被调用') } })
  assert.deepEqual(branchOnly.git, { isRepo: true, branch: 'feature/x', dirtyCount: null })

  // scanGit=true（默认）：复用 gitBranch 跳过 rev-parse，只跑一次 status。
  await writeFile(path.join(cwd, '.git'), '', 'utf8')
  const calls = []
  const exec = async (_cmd, args) => {
    calls.push([...args])
    return { stdout: ' M a.txt\n' }
  }
  const full = await scanProjectDir(projectDir, { scanGit: true, gitExec: exec })
  assert.deepEqual(full.git, { isRepo: true, branch: 'feature/x', dirtyCount: 1 })
  assert.equal(calls.filter((a) => a.includes('rev-parse')).length, 0, '已知分支跳过 rev-parse')
  assert.equal(calls.filter((a) => a.includes('status')).length, 1, '只跑 status 算脏行')
})

test('gitStatus：knownBranch 跳过 rev-parse、分支缺失时照常探测', async (t) => {
  const dir = await makeTempDir(t)
  const repo = path.join(dir, 'repo')
  await mkdir(repo)
  await writeFile(path.join(repo, '.git'), '')
  const calls = []
  const exec = async (_cmd, args) => {
    calls.push([...args])
    if (args.includes('rev-parse')) return { stdout: 'main\n' }
    return { stdout: '\n' }
  }
  assert.deepEqual(await gitStatus(repo, { exec, knownBranch: 'feature/y' }), { isRepo: true, branch: 'feature/y', dirtyCount: 0 })
  assert.equal(calls.filter((a) => a.includes('rev-parse')).length, 0)
  assert.deepEqual(await gitStatus(repo, { exec }), { isRepo: true, branch: 'main', dirtyCount: 0 })
})

test('scanClaudeHome：删除文件的书签计数报告（C5）', async (t) => {
  const home = await makeTempDir(t)
  const projectDir = path.join(home, 'projects', 'demo-a')
  await mkdir(projectDir, { recursive: true })
  const f1 = path.join(projectDir, 'a1.jsonl')
  await writeFile(f1, claudeLine('user', { sessionId: 'a1', message: { content: 'q' } }) + '\n', 'utf8')

  const first = await scanClaudeHome(home, { scanGit: false })
  assert.equal(first.index.removedBookmarks, undefined, '首次扫描无删除报告')

  await rm(f1)
  const second = await scanClaudeHome(home, {
    scanGit: false, cache: { version: INDEX_VERSION, files: first.files },
  })
  assert.equal(second.index.removedBookmarks, 1, '删除的源文件书签计数')
  assert.deepEqual(second.files, {}, '书签随扫描清理')
})
