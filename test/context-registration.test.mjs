// context-registration.test.mjs — Phase 3 集成：memory/CLAUDE.md 段、技能 provider
// 注册与开关、settingsSuggestions 注入扫描结果。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply, memoryDirsSync, makeClaudeState, runScan, cwdMemoryDirSync } from '../index.mjs'

async function makeTempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-move-ctx-reg-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  return dir
}

function makeRichCtx(services = { systemPrompt: true, skills: true }) {
  const registered = []
  const contextSections = []
  const sections = []
  const skillProviderFactories = []
  const ctx = {
    tools: { register: (d) => { registered.push(d); return () => {} } },
    on: () => () => {},
    get(service) {
      if (service === 'systemPrompt' && services.systemPrompt) {
        return {
          context: (c) => { contextSections.push(c); return () => {} },
          section: (s) => { sections.push(s); return () => {} },
        }
      }
      if (service === 'skills' && services.skills) {
        return {
          registerProvider: (factory) => { skillProviderFactories.push(factory); return () => {} },
        }
      }
      return undefined
    },
  }
  return { ctx, registered, contextSections, sections, skillProviderFactories }
}

test('apply 注册 memory 上下文、CLAUDE.md 段与技能 provider（默认开启）', async (t) => {
  const home = await makeTempDir(t)
  await mkdir(path.join(home, 'projects', 'p1', 'memory'), { recursive: true })
  await writeFile(path.join(home, 'projects', 'p1', 'memory', 'a.md'), '---\nmetadata: type: feedback\n---\n\n反馈记忆内容\n', 'utf8')
  await writeFile(path.join(home, 'CLAUDE.md'), '# 全局指令正文\n', 'utf8')

  const projectCwd = await makeTempDir(t)
  await mkdir(path.join(projectCwd, '.claude'), { recursive: true })
  await writeFile(path.join(projectCwd, '.claude', 'CLAUDE.md'), '# 项目指令正文\n', 'utf8')

  const { ctx, contextSections, sections, skillProviderFactories } = makeRichCtx()
  apply(ctx, { claudeHome: home })

  assert.equal(contextSections.length, 1)
  assert.equal(contextSections[0].name, 'claude-move:memory')
  assert.ok(contextSections[0].text({}).includes('反馈记忆内容'))

  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'claude-move:instructions')
  assert.equal(sections[0].order, -90)
  const text = sections[0].text({ agent: { session: { header: { cwd: projectCwd } } } })
  assert.ok(text.indexOf('项目指令正文') < text.indexOf('全局指令正文'), '项目级优先')

  assert.equal(skillProviderFactories.length, 1)
  const provider = skillProviderFactories[0]({ invalidate: () => {} })
  const candidates = await provider.list()
  assert.equal(candidates.length, 0, 'home 下无 skills 目录')
})

test('配置开关：enableMemory/enableInstructions/enableSkills=false 时不注册', () => {
  const { ctx, contextSections, sections, skillProviderFactories } = makeRichCtx()
  apply(ctx, { enableMemory: false, enableInstructions: false, enableSkills: false })
  assert.equal(contextSections.length, 0)
  assert.equal(sections.length, 0)
  assert.equal(skillProviderFactories.length, 0)
})

test('服务缺失时按可选依赖跳过（不抛错）', () => {
  const { ctx, contextSections, sections, skillProviderFactories } = makeRichCtx({ systemPrompt: false, skills: false })
  apply(ctx, {})
  assert.equal(contextSections.length, 0)
  assert.equal(sections.length, 0)
  assert.equal(skillProviderFactories.length, 0)
})

test('memoryDirsSync：按 projects 目录 mtime 缓存、新项目即时可见', async (t) => {
  const home = await makeTempDir(t)
  const state = makeClaudeState({ claudeHome: home })
  assert.deepEqual(memoryDirsSync(state), [])

  await mkdir(path.join(home, 'projects', 'p1', 'memory'), { recursive: true })
  const dirs = memoryDirsSync(state)
  assert.equal(dirs.length, 1)
  assert.equal(memoryDirsSync(state), dirs, 'mtime 未变复用同一数组')

  // 目录列表缓存按父目录 mtime+ctime 失效；同 tick 连建目录需等时间戳前进（与文件缓存同一契约）。
  await new Promise((resolve) => setTimeout(resolve, 25))
  await mkdir(path.join(home, 'projects', 'p2', 'memory'), { recursive: true })
  const dirs2 = memoryDirsSync(state)
  assert.equal(dirs2.length, 2, '新增项目目录立即可见')
})

test('runScan 结果携带 settingsSuggestions（F14）', async (t) => {
  const home = await makeTempDir(t)
  const dshHome = await makeTempDir(t)
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  t.after(() => {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
  })

  await writeFile(path.join(home, 'settings.json'), JSON.stringify({
    permissions: { allow: ['Read(./public/**)'], deny: ['Bash(rm -rf *)'] },
    model: 'opus',
    env: { A: 'b' },
  }), 'utf8')

  const ctx = { get: () => undefined, tools: { register: () => () => {} } }
  const index = await runScan(ctx, { claudeHome: home }, {})
  const { suggestions, unmapped } = index.settingsSuggestions
  assert.ok(suggestions.some((s) => s.kind === 'model' && s.target === 'opus'))
  assert.ok(suggestions.some((s) => s.action === 'deny' && s.target === 'rm -rf *'))
  assert.ok(unmapped.some((u) => u.includes('env')))
})

test('memory 注入按当前 cwd 优先：memoryScope 语义与 cwd 定位（B3）', async (t) => {
  const dshHome = await makeTempDir(t)
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  t.after(() => {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
  })

  const home = await makeTempDir(t)
  const p1 = await makeTempDir(t)
  const p2 = await makeTempDir(t)
  await mkdir(path.join(home, 'projects', 'p1', 'memory'), { recursive: true })
  await mkdir(path.join(home, 'projects', 'p2', 'memory'), { recursive: true })
  await writeFile(path.join(home, 'projects', 'p1', 'memory', 'a.md'), '---\nmetadata: type: feedback\n---\n\nP1 记忆\n', 'utf8')
  await writeFile(path.join(home, 'projects', 'p2', 'memory', 'b.md'), '---\nmetadata: type: feedback\n---\n\nP2 记忆\n', 'utf8')

  // 书签缓存：cwd → 项目目录映射（与真实扫描产物同形）。
  await mkdir(path.join(dshHome, 'claude-move'), { recursive: true })
  await writeFile(path.join(dshHome, 'claude-move', 'index.json'), JSON.stringify({
    version: 1, claudeHome: home,
    files: {
      [path.join(home, 'projects', 'p1', 's1.jsonl')]: { cwd: p1 },
      [path.join(home, 'projects', 'p2', 's2.jsonl')]: { cwd: p2 },
    },
  }), 'utf8')

  const state = makeClaudeState({ claudeHome: home })
  assert.equal(cwdMemoryDirSync(state, p1), path.join(home, 'projects', 'p1', 'memory'))
  assert.equal(cwdMemoryDirSync(state, path.join(home, 'nope')), null, '无对应项目返回 null')
  assert.equal(cwdMemoryDirSync(state, null), null)

  const { ctx, contextSections } = makeRichCtx()
  apply(ctx, { claudeHome: home })
  const text = (cwd) => contextSections[0].text({ agent: { session: { header: { cwd } } } })
  assert.ok(text(p1).includes('P1 记忆'))
  assert.ok(!text(p1).includes('P2 记忆'), 'current-project 默认只注入当前项目')
  assert.ok(text(path.join(home, 'unknown-cwd')).includes('P1 记忆'), '无对应项目回退全部目录')

  const { ctx: ctx2, contextSections: cs2 } = makeRichCtx()
  apply(ctx2, { claudeHome: home, memoryScope: 'all' })
  const allText = cs2[0].text({ agent: { session: { header: { cwd: p2 } } } })
  assert.ok(allText.indexOf('P2 记忆') < allText.indexOf('P1 记忆'), 'all 时当前项目排最前')
})
