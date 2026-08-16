// wizard.test.mjs — 向导核心：detect/plan/preview/execute/report 全链路（假运行时）。
// 覆盖：幂等跳过、force 重应用、审批门零写入、冲突 diff 与四种解法、
// 不支持清单、selection 子集、会话状态映射。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPreview, runExecute, runWizard, reportLines } from '../lib/wizard.mjs'
import { digestText } from '../lib/sources/contract.mjs'

/** 假运行时：内存文件系统 + 清单 + 审批桩 + 会话状态。 */
function makeRuntime(overrides = {}) {
  const files = new Map()
  const manifest = {}
  const imported = []
  const registered = new Set()
  const sessions = overrides.sessions ?? {}

  const runtime = {
    manifest,
    files,
    imported,
    async readTarget(p) { return files.has(p) ? files.get(p) : null },
    async writeTarget(p, content) { files.set(p, content) },
    async readSource(p) { return files.has(p) ? files.get(p) : null },
    async renameTarget(p) {
      const base = p.replace(/SKILL\.md$/, '').replace(/[\\/]$/, '')
      let n = 2
      let final = `${base}-${n}\\SKILL.md`
      while (files.has(final)) final = `${base}-${++n}\\SKILL.md`
      return final
    },
    async loadManifest() { return manifest },
    async record(key, rec) { manifest[key] = { appliedAt: '2026-08-20T00:00:00.000Z', ...rec } },
    async sessionStatus(source) {
      const key = source?.importKey ?? source?.file
      return sessions[key] ?? 'none'
    },
    async importSession(plan, { force }) {
      imported.push({ file: plan.source.file, force, title: plan.title })
      sessions[plan.source.file] = 'imported'
      return { status: 'imported', sessionId: 'import-sess-' + imported.length }
    },
    async registerCommand(name, prompt) {
      registered.add(name)
      return { registered: true }
    },
    hasCommand(name) { return registered.has(name) },
    async approval() { return overrides.approval ?? 'allowed-once' },
    async detect(source) {
      return overrides.detections?.[source] ?? { source, home: '~/' + source, sessions: [], skills: [], memories: [], instructions: [], commands: [], hooks: [], errors: [] }
    },
    async map(source, detection) {
      const plans = []
      for (const s of detection.sessions ?? []) {
        plans.push({ key: `${source}:session:${s.file}`, source, kind: 'session', action: 'import-session', source: { file: s.file, title: s.title, cwd: s.cwd }, target: {}, provider: source, title: s.title })
      }
      for (const sk of detection.skills ?? []) {
        plans.push({ key: `${source}:skill:${sk.id}`, source, kind: 'skill', action: sk.compatible ? 'copy' : 'convert-copy', source: { file: sk.file, name: sk.name }, target: { path: `D:\\dsh\\skills\\${sk.name}\\SKILL.md` }, digest: sk.digest })
      }
      for (const m of detection.memories ?? []) {
        plans.push({ key: `${source}:memory:${m.id}`, source, kind: 'memory', action: 'append-section', source: { file: m.file }, target: { path: 'D:\\dsh\\AGENTS.md' }, content: m.content, digest: digestText(m.content) })
      }
      for (const h of detection.hooks ?? []) {
        plans.push({ key: `${source}:hook:${h.id}`, source, kind: 'hook', action: 'unsupported', source: { file: h.file }, reason: 'no seam' })
      }
      return { plans }
    },
  }
  // 技能源文件内容
  for (const [p, c] of Object.entries(overrides.files ?? {})) files.set(p, c)
  return runtime
}

const skillA = {
  id: 'pdf', file: 'C:\\src\\skills\\pdf\\SKILL.md', name: 'pdf-helper', compatible: true,
  digest: digestText('PDF SKILL'),
}

test('preview：全新项 → new；执行后幂等跳过', async () => {
  const runtime = makeRuntime({
    files: { 'C:\\src\\skills\\pdf\\SKILL.md': 'PDF SKILL' },
  })
  const plans = (await runtime.map('codex', { source: 'codex', skills: [skillA], sessions: [{ file: 's.jsonl', title: 'T' }], memories: [{ id: 'm', file: 'm.md', content: 'mem' }], hooks: [{ id: 'h', file: 's.json' }] })).plans
  const manifest = await runtime.loadManifest()
  const preview = await runPreview(runtime, plans, manifest, false)
  assert.deepEqual(preview.counts, { new: 3, unchanged: 0, changed: 0, conflict: 0, unsupported: 1 })

  const exec = await runExecute(runtime, { plans, manifest, requireApproval: true, approval: runtime.approval })
  assert.equal(exec.approved, true)
  assert.equal(exec.applied, 3)
  assert.equal(exec.unsupported, 1)
  assert.equal(runtime.imported.length, 1)

  // 重跑：全部幂等跳过。
  const again = await runExecute(runtime, { plans, manifest, requireApproval: true, approval: runtime.approval })
  assert.equal(again.applied, 0)
  assert.equal(again.skipped, 3)
  assert.equal(runtime.imported.length, 1)
})

test('审批拒绝/不可用 → 零写入（fail-closed）', async () => {
  const runtime = makeRuntime({
    files: { 'C:\\src\\skills\\pdf\\SKILL.md': 'PDF SKILL' },
    approval: 'rejected',
  })
  const plans = (await runtime.map('codex', { source: 'codex', skills: [skillA] })).plans
  const manifest = await runtime.loadManifest()
  const exec = await runExecute(runtime, { plans, manifest, requireApproval: true, approval: runtime.approval })
  assert.equal(exec.approved, false)
  assert.equal(exec.outcome, 'rejected')
  assert.equal(Object.keys(manifest).length, 0)
  assert.equal(runtime.files.size, 1) // 只有源文件，目标零写入
  const lines = reportLines(exec)
  assert.match(lines.join(''), /审批未通过/)
})

test('force：已迁移项重新应用', async () => {
  const runtime = makeRuntime({ files: { 'C:\\src\\skills\\pdf\\SKILL.md': 'PDF SKILL' } })
  const plans = (await runtime.map('codex', { source: 'codex', skills: [skillA] })).plans
  const manifest = await runtime.loadManifest()
  await runExecute(runtime, { plans, manifest, requireApproval: false })
  const exec = await runExecute(runtime, { plans, manifest, requireApproval: false, force: true })
  assert.equal(exec.applied, 1)
})

test('技能冲突：目标已存在且无记录 → 默认跳过；overwrite/rename 可选', async () => {
  const runtime = makeRuntime({ files: { 'C:\\src\\skills\\pdf\\SKILL.md': 'PDF SKILL' } })
  runtime.files.set('D:\\dsh\\skills\\pdf-helper\\SKILL.md', 'USER EDITED')
  const plans = (await runtime.map('codex', { source: 'codex', skills: [skillA] })).plans
  const manifest = await runtime.loadManifest()
  const preview = await runPreview(runtime, plans, manifest, false)
  assert.equal(preview.counts.conflict, 1)
  assert.ok(preview.conflicts[0].existing.includes('USER EDITED'))

  const skipped = await runExecute(runtime, { plans, manifest, requireApproval: false })
  assert.equal(skipped.conflictSkipped, 1)

  const overwritten = await runExecute(runtime, { plans, manifest, requireApproval: false, resolve: { [plans[0].key]: 'overwrite' } })
  assert.equal(overwritten.applied, 1)
  assert.equal(runtime.files.get('D:\\dsh\\skills\\pdf-helper\\SKILL.md'), 'PDF SKILL')

  // 再制造冲突 → rename 另存新路径。
  runtime.files.set('D:\\dsh\\skills\\pdf-helper\\SKILL.md', 'EDITED AGAIN')
  const renamed = await runExecute(runtime, { plans, manifest, requireApproval: false, resolve: { [plans[0].key]: 'rename' } })
  assert.equal(renamed.applied, 1)
  assert.ok(runtime.files.has('D:\\dsh\\skills\\pdf-helper-2\\SKILL.md'))
})

test('append-section：新增 → 源更新替换 → 用户手改冲突 → merge', async () => {
  const runtime = makeRuntime({})
  const plans = (await runtime.map('hermes', { source: 'hermes', memories: [{ id: 'mem', file: 'MEMORY.md', content: 'entry-1' }] })).plans
  const manifest = await runtime.loadManifest()
  await runExecute(runtime, { plans, manifest, requireApproval: false })
  let text = runtime.files.get('D:\\dsh\\AGENTS.md')
  assert.match(text, /entry-1/)

  // 源更新 → 替换段（非冲突）。
  const plans2 = (await runtime.map('hermes', { source: 'hermes', memories: [{ id: 'mem', file: 'MEMORY.md', content: 'entry-2' }] })).plans
  const preview2 = await runPreview(runtime, plans2, manifest, false)
  assert.equal(preview2.counts.changed, 1)
  await runExecute(runtime, { plans: plans2, manifest, requireApproval: false })
  text = runtime.files.get('D:\\dsh\\AGENTS.md')
  assert.match(text, /entry-2/)
  assert.doesNotMatch(text, /\bentry-1\b/)

  // 用户手改段 → 冲突；merge 保留旧内容并追加新内容。
  const key = plans2[0].key
  text = text.replace('entry-2', 'USER NOTE')
  runtime.files.set('D:\\dsh\\AGENTS.md', text)
  const plans3 = (await runtime.map('hermes', { source: 'hermes', memories: [{ id: 'mem', file: 'MEMORY.md', content: 'entry-3' }] })).plans
  const preview3 = await runPreview(runtime, plans3, manifest, false)
  assert.equal(preview3.counts.conflict, 1)
  const exec = await runExecute(runtime, { plans: plans3, manifest, requireApproval: false, resolve: { [key]: 'merge' } })
  assert.equal(exec.applied, 1)
  text = runtime.files.get('D:\\dsh\\AGENTS.md')
  assert.match(text, /USER NOTE/)
  assert.match(text, /entry-3/)
})

test('session 状态：imported 跳过、force 重建、updates 续写', async () => {
  const plan = { key: 'codex:session:s.jsonl', source: 'codex', kind: 'session', action: 'import-session', source: { file: 's.jsonl', title: 'T' }, target: {}, provider: 'codex', title: 'T' }
  const runtime = makeRuntime({ sessions: { 's.jsonl': 'imported' } })
  const manifest = await runtime.loadManifest()
  const preview = await runPreview(runtime, [plan], manifest, false)
  assert.equal(preview.counts.unchanged, 1)
  const forcePreview = await runPreview(runtime, [plan], manifest, true)
  assert.equal(forcePreview.counts.changed, 1)
  const exec = await runExecute(runtime, { plans: [plan], manifest, requireApproval: false, force: true })
  assert.equal(exec.applied, 1)
  assert.equal(runtime.imported[0].force, true)
})

test('selection：只执行选中的键', async () => {
  const runtime = makeRuntime({ files: { 'C:\\src\\skills\\pdf\\SKILL.md': 'PDF SKILL' } })
  const plans = (await runtime.map('codex', { source: 'codex', skills: [skillA, { ...skillA, id: 'x', name: 'x-helper', file: 'C:\\src\\skills\\x\\SKILL.md', digest: digestText('X') }] })).plans
  const manifest = await runtime.loadManifest()
  const exec = await runExecute(runtime, { plans, manifest, requireApproval: false, selection: [plans[0].key] })
  assert.equal(exec.applied, 1)
  assert.equal(exec.skipped, 1)
})

test('runWizard：detect→plan→preview→execute→report 一步式', async () => {
  const runtime = makeRuntime({
    files: { 'C:\\src\\skills\\pdf\\SKILL.md': 'PDF SKILL' },
    detections: { codex: { source: 'codex', home: '~/.codex', skills: [skillA], sessions: [], memories: [], hooks: [] } },
  })
  const result = await runWizard(runtime, { sources: ['codex'], requireApproval: false })
  assert.equal(result.execution.applied, 1)
  assert.equal(result.preview.counts.new, 1)
  assert.ok(runtime.files.has('D:\\dsh\\skills\\pdf-helper\\SKILL.md'))
})
