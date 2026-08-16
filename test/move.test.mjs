// move.test.mjs — 四合一迁移向导集成测试：真实临时四源数据 + mock DSH ctx，
// 走 apply → move_detect/preview/run 全链路：检测计数、幂等重跑、force、
// 冲突解法、审批拒绝零写入、AGENTS.md 管理段、skills 落盘、会话导入。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { apply } from '../index.mjs'
import { loadManifest } from '../lib/manifest.mjs'

/** 模拟 sessionPersistence（内存态）。 */
function makePersistence() {
  const sessions = new Map()
  return {
    sessions,
    async list() { return [...sessions.values()].map((s) => s.meta) },
    async create(meta) {
      if (sessions.has(meta.id)) throw new Error('duplicate session ' + meta.id)
      sessions.set(meta.id, { meta, events: [] })
    },
    async append(id, events) {
      const s = sessions.get(id)
      if (!s) throw new Error('unknown session ' + id)
      s.events.push(...events)
    },
  }
}

/** 真实文件系统 passthrough（wizard 运行时的 requireFs）。 */
function makeRealFs() {
  return {
    async resolve(p) { return { targetKey: p, displayPath: p } },
    async stat(target) {
      const { stat } = await import('node:fs/promises')
      const st = await stat(target.targetKey)
      return { type: st.isDirectory() ? 'directory' : 'file', size: st.size, mtimeMs: st.mtimeMs }
    },
    async readText(target) { return readFile(target.targetKey, 'utf8') },
    async listDir(target) {
      const entries = await readdir(target.targetKey, { withFileTypes: true })
      return entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        target: { targetKey: path.join(target.targetKey, e.name), displayPath: path.join(target.targetKey, e.name) },
        version: 1,
      }))
    },
    processPath(target) { return target.targetKey },
  }
}

/** mock ctx：tools/commands/systemPrompt/skills/sessionPersistence/workspaceRegistry/approval。 */
function makeCtx(overrides = {}) {
  const persistence = makePersistence()
  const registered = []
  const commandDefs = []
  const workspaces = new Map()
  const attached = []
  const workspaceRegistry = {
    async resolveByPath(p) { return workspaces.get(p) ?? null },
    async create(p, title) {
      const ws = { path: p, title, attachSession: async (id) => attached.push({ ws: p, id }) }
      workspaces.set(p, ws)
      return ws
    },
  }
  const commands = overrides.commands ?? { register(def) { commandDefs.push(def); return () => {} } }
  const ctx = {
    fs: makeRealFs(),
    commands,
    systemPrompt: overrides.systemPrompt ?? { context: () => {}, section: () => {} },
    skills: overrides.skills ?? { registerProvider: () => {} },
    on: () => () => {},
    get(service) {
      if (service === 'workspaceRegistry') return workspaceRegistry
      if (service === 'sessionPersistence') return persistence
      if (service === 'fs') return ctx.fs
      if (service === 'commands') return commands
      if (service === 'approval') return overrides.approval
      return undefined
    },
    tools: { register(def) { registered.push(def); return () => {} } },
    ...overrides,
  }
  return { ctx, persistence, registered, commandDefs, workspaces, attached }
}

const codexRollout = [
  JSON.stringify({ timestamp: '2026-08-01T10:00:00.000Z', type: 'session_meta', payload: { id: 'codex-sess-1', cwd: 'D:\\repo\\app', timestamp: '2026-08-01T10:00:00.000Z' } }),
  JSON.stringify({ timestamp: '2026-08-01T10:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5-codex' } }),
  JSON.stringify({ timestamp: '2026-08-01T10:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the build' }] } }),
  JSON.stringify({ timestamp: '2026-08-01T10:00:03.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] } }),
].join('\n') + '\n'

/** 搭四源最小样例数据（干净 profile 模拟）。 */
async function buildSourceHomes(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'move-homes-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  // Codex
  const codex = path.join(root, '.codex')
  const sessionsDir = path.join(codex, 'sessions', '2026', '08', '01')
  await mkdir(sessionsDir, { recursive: true })
  await mkdir(path.join(codex, 'skills', 'k-skill'), { recursive: true })
  await mkdir(path.join(codex, 'hooks', 'commit'), { recursive: true })
  await writeFile(path.join(sessionsDir, 'rollout-2026-08-01T10-00-00-codex-sess-1.jsonl'), codexRollout)
  await writeFile(path.join(codex, 'skills', 'k-skill', 'SKILL.md'), '---\nname: k-skill\ndescription: K skill\n---\n\n# Steps\n1. go\n')
  await writeFile(path.join(codex, 'AGENTS.md'), '# Codex rules\nShip it.\n')
  await writeFile(path.join(codex, 'hooks', 'commit', 'command.md'), 'Write a commit message for this change.\n')
  await writeFile(path.join(codex, 'auth.json'), '{"OPENAI_API_KEY":"sk-secret"}') // 白名单外

  // Hermes
  const hermes = path.join(root, '.hermes')
  await mkdir(path.join(hermes, 'skills', 'devops', 'deploy'), { recursive: true })
  await mkdir(path.join(hermes, 'memories'), { recursive: true })
  await writeFile(path.join(hermes, 'skills', 'devops', 'deploy', 'SKILL.md'), '---\nname: deploy-runbook\ndescription: Deploy steps\n---\n\n# Runbook\n1. deploy\n')
  await writeFile(path.join(hermes, 'memories', 'MEMORY.md'), 'User prefers tabs. § Project uses pnpm.\n')
  await writeFile(path.join(hermes, 'config.yaml'), 'secrets: yes') // 白名单外

  // OpenCode（db + config）
  const opencode = path.join(root, 'opencode-data')
  const opencodeConfig = path.join(root, 'opencode-config')
  await mkdir(opencode, { recursive: true })
  await mkdir(opencodeConfig, { recursive: true })
  const db = new DatabaseSync(path.join(opencode, 'opencode.db'))
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
  `)
  db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?)').run('ses_oc', 'OC session', 'D:\\repo\\oc', 100, 900, null)
  db.prepare('INSERT INTO message VALUES (?,?,?,?,?)').run('msg_1', 'ses_oc', 100, 100, JSON.stringify({ role: 'user' }))
  db.prepare('INSERT INTO part VALUES (?,?,?,?,?,?)').run('prt_1', 'msg_1', 'ses_oc', 100, 100, JSON.stringify({ type: 'text', text: 'What now?' }))
  db.prepare('INSERT INTO message VALUES (?,?,?,?,?)').run('msg_2', 'ses_oc', 200, 200, JSON.stringify({ role: 'assistant', modelID: 'm1' }))
  db.prepare('INSERT INTO part VALUES (?,?,?,?,?,?)').run('prt_2', 'msg_2', 'ses_oc', 200, 200, JSON.stringify({ type: 'text', text: 'Plan.' }))
  db.close()
  await mkdir(path.join(opencodeConfig, 'agent'), { recursive: true })
  await mkdir(path.join(opencodeConfig, 'command'), { recursive: true })
  await writeFile(path.join(opencodeConfig, 'agent', 'reviewer.md'), '# Reviewer\n\nYou review.\n')
  await writeFile(path.join(opencodeConfig, 'command', 'test.md'), 'Run tests for this change.\n')
  await writeFile(path.join(opencodeConfig, 'AGENTS.md'), '# OC rules\nReview twice.\n')
  await writeFile(path.join(opencode, 'auth.json'), '{"key":"sk-oc"}') // 白名单外

  // Claude
  const claude = path.join(root, '.claude')
  const project = path.join(claude, 'projects', 'demo')
  await mkdir(path.join(project, 'memory'), { recursive: true })
  await mkdir(path.join(claude, 'skills', 'claude-skill'), { recursive: true })
  await writeFile(path.join(project, 'sess-1.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: '2026-08-01T09:00:00.000Z', sessionId: 'claude-1', cwd: 'D:\\repo\\c', message: { content: 'Hello' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-08-01T09:00:01.000Z', message: { model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'Hi.' }] } }),
  ].join('\n') + '\n')
  await writeFile(path.join(project, 'memory', 'notes.md'), '---\ntype: project\n---\nCLI-first.\n')
  await writeFile(path.join(claude, 'skills', 'claude-skill', 'SKILL.md'), '---\nname: claude-skill\ndescription: Claude skill\n---\n\n# S\n')
  await writeFile(path.join(claude, 'CLAUDE.md'), '# Claude rules\nTerse.\n')
  await writeFile(path.join(claude, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'true' }] }] } }))

  return { root, codex, hermes, opencode, opencodeConfig, claude }
}

async function withTempDshHome(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'move-dsh-'))
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  t.after(async () => {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

test('全链路：detect → preview → run → 幂等重跑 → force', async (t) => {
  const homes = await buildSourceHomes(t)
  const dshHome = await withTempDshHome(t)
  const skillsDir = path.join(dshHome, 'skills')
  const agentsMd = path.join(dshHome, 'AGENTS.md')
  const { ctx, persistence, registered } = makeCtx()
  apply(ctx, {
    requireApproval: false,
    claudeHome: homes.claude,
    codexHome: homes.codex,
    opencodeDataHome: homes.opencode,
    opencodeConfigHome: homes.opencodeConfig,
    hermesHome: homes.hermes,
    skillsDir,
    agentsMdPath: agentsMd,
  })

  const detect = registered.find((d) => d.name === 'move_detect')
  const previewTool = registered.find((d) => d.name === 'move_preview')
  const run = registered.find((d) => d.name === 'move_run')

  const index = await detect.execute({})
  assert.equal(index.stats.sessions, 3)   // claude + codex + opencode
  assert.equal(index.stats.skills, 4)     // claude-skill + k-skill + deploy-runbook + reviewer
  assert.equal(index.stats.memories, 2)   // claude notes + hermes MEMORY.md
  assert.equal(index.stats.instructions, 3) // CLAUDE.md + AGENTS.md(codex) + AGENTS.md(opencode)
  assert.equal(index.stats.commands, 2)   // codex commit + opencode test

  const preview = await previewTool.execute({})
  console.log('DEBUG previews:', preview.previews.map((p) => p.source + '/' + p.kind + ':' + p.status).join(', '))
  assert.equal(preview.counts.new, 14)    // 3 会话 + 4 技能 + 2 记忆 + 3 指令段 + 2 命令
  assert.equal(preview.counts.unsupported, 1) // claude settings hooks
  assert.equal(preview.counts.conflict, 0)

  const exec = await run.execute({})
  assert.equal(exec.approved, true)
  assert.equal(exec.applied, 14)
  assert.equal(exec.unsupported, 1)

  // 会话落盘（含工作区挂接）。
  assert.equal(persistence.sessions.size, 3)
  // 技能目录落盘。
  assert.ok(existsSync(path.join(skillsDir, 'k-skill', 'SKILL.md')))
  assert.ok(existsSync(path.join(skillsDir, 'deploy-runbook', 'SKILL.md')))
  assert.ok(existsSync(path.join(skillsDir, 'reviewer', 'SKILL.md')))
  assert.ok(existsSync(path.join(skillsDir, 'claude-skill', 'SKILL.md')))
  // AGENTS.md 管理段。
  const agentsText = await readFile(agentsMd, 'utf8')
  assert.match(agentsText, /User prefers tabs/)
  assert.match(agentsText, /Codex rules/)
  assert.match(agentsText, /Claude rules/)
  assert.match(agentsText, /OC rules/)
  assert.match(agentsText, /CLI-first/)
  // move.json 幂等清单。
  const manifest = await loadManifest()
  assert.ok(Object.keys(manifest).length >= 10)

  // 幂等重跑：全部跳过。
  const again = await run.execute({});
  console.log('DEBUG-AGAIN', JSON.stringify(again.results.map(function (r) { return r.key + ':' + r.status })))
  assert.equal(again.applied, 0)
  assert.equal(again.skipped, 14)

  // force：非冲突项重新应用（会话另存新副本，技能/段重写）。
  const forced = await run.execute({ force: true })
  assert.ok(forced.applied >= 7)
  assert.ok(persistence.sessions.size >= 6) // 3 原有 + 3 force 副本

  // 会话元数据：工作区 cwd 指向 imports/<source>。
  const codexSession = [...persistence.sessions.values()].find((s) => s.meta.id.startsWith('import-codex'))
  assert.ok(codexSession)
  assert.match(codexSession.meta.cwd, /imports[\\/]codex/)
})

test('冲突：目标被手工修改 → preview 报冲突 → resolve=overwrite 应用', async (t) => {
  const homes = await buildSourceHomes(t)
  const dshHome = await withTempDshHome(t)
  const skillsDir = path.join(dshHome, 'skills')
  const { ctx, registered } = makeCtx()
  apply(ctx, {
    requireApproval: false,
    claudeHome: homes.claude,
    codexHome: homes.codex,
    opencodeDataHome: homes.opencode,
    opencodeConfigHome: homes.opencodeConfig,
    hermesHome: homes.hermes,
    skillsDir,
    agentsMdPath: path.join(dshHome, 'AGENTS.md'),
  })
  const previewTool = registered.find((d) => d.name === 'move_preview')
  const run = registered.find((d) => d.name === 'move_run')

  // 预置目标技能（无迁移记录 → 冲突）。
  await mkdir(path.join(skillsDir, 'k-skill'), { recursive: true })
  await writeFile(path.join(skillsDir, 'k-skill', 'SKILL.md'), 'USER EDITED\n')
  const preview = await previewTool.execute({ source: 'codex' })
  assert.equal(preview.counts.conflict, 1)
  const key = preview.conflicts[0].key

  // 默认跳过。
  const skipped = await run.execute({ source: 'codex' })
  assert.equal(skipped.conflictSkipped, 1)

  // overwrite。
  const overwritten = await run.execute({ source: 'codex', resolve: { [key]: 'overwrite' } })
  assert.equal(overwritten.conflictSkipped, 0)
  assert.ok(overwritten.applied >= 1)
  const content = await readFile(path.join(skillsDir, 'k-skill', 'SKILL.md'), 'utf8')
  assert.match(content, /K skill/)
})

test('审批拒绝 → 零写入；requireApproval=false 放行', async (t) => {
  const homes = await buildSourceHomes(t)
  const dshHome = await withTempDshHome(t)
  const skillsDir = path.join(dshHome, 'skills')
  const agent = { id: 'agent-1' }
  const approval = { request: async () => 'rejected' }
  const { ctx, registered, persistence } = makeCtx({ approval })
  apply(ctx, {
    requireApproval: true,
    claudeHome: homes.claude,
    codexHome: homes.codex,
    opencodeDataHome: homes.opencode,
    opencodeConfigHome: homes.opencodeConfig,
    hermesHome: homes.hermes,
    skillsDir,
    agentsMdPath: path.join(dshHome, 'AGENTS.md'),
  })
  const run = registered.find((d) => d.name === 'move_run')
  const exec = await run.execute({}, { agent })
  assert.equal(exec.approved, false)
  assert.equal(exec.outcome, 'rejected')
  assert.equal(persistence.sessions.size, 0)
  assert.equal(existsSync(skillsDir), false)
  const manifest = await loadManifest()
  assert.equal(Object.keys(manifest).length, 0)
})

test('命令注册：codex command.md 纯提示词 → DSH 命令；apply 时按 manifest 重建', async (t) => {
  const homes = await buildSourceHomes(t)
  const dshHome = await withTempDshHome(t)
  const { ctx, registered, commandDefs } = makeCtx()
  apply(ctx, {
    requireApproval: false,
    claudeHome: homes.claude,
    codexHome: homes.codex,
    opencodeDataHome: homes.opencode,
    opencodeConfigHome: homes.opencodeConfig,
    hermesHome: homes.hermes,
    skillsDir: path.join(dshHome, 'skills'),
    agentsMdPath: path.join(dshHome, 'AGENTS.md'),
  })
  const run = registered.find((d) => d.name === 'move_run')
  await run.execute({})
  const commit = commandDefs.find((d) => d.name === 'commit')
  assert.ok(commit)
  assert.match(commit.description, /commit message/)
  const opentest = commandDefs.find((d) => d.name === 'test')
  assert.ok(opentest)

  // 重启（新 apply）→ manifest 重建命令。
  const { ctx: ctx2, registered: reg2, commandDefs: defs2 } = makeCtx()
  apply(ctx2, {
    requireApproval: false,
    claudeHome: homes.claude,
    codexHome: homes.codex,
    opencodeDataHome: homes.opencode,
    opencodeConfigHome: homes.opencodeConfig,
    hermesHome: homes.hermes,
    skillsDir: path.join(dshHome, 'skills'),
    agentsMdPath: path.join(dshHome, 'AGENTS.md'),
  })
  await new Promise((r) => setTimeout(r, 50)) // manifest 重建为异步
  assert.ok(defs2.find((d) => d.name === 'commit'))
  assert.ok(defs2.find((d) => d.name === 'test'))
})
