// hermes-parser.test.mjs — Hermes 源解析器：定位/白名单/嵌套技能/记忆检出。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { locateHome, whitelist, detect, source } from '../../lib/sources/hermes/parser.mjs'
import { assertAllowedRead, digestText } from '../../lib/sources/contract.mjs'

async function makeTempHome(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hermes-move-test-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  return dir
}

test('locateHome：HERMES_HOME 优先、空值回退默认 ~/.hermes', () => {
  assert.equal(source, 'hermes')
  assert.equal(locateHome({ HERMES_HOME: 'D:\\hermes' }, 'C:\\Users\\me'), path.resolve('D:\\hermes'))
  assert.equal(locateHome({}, 'C:\\Users\\me'), path.join('C:\\Users\\me', '.hermes'))
  assert.equal(locateHome({ HERMES_HOME: '   ' }, 'C:\\Users\\me'), path.join('C:\\Users\\me', '.hermes'))
})

test('whitelist：config.yaml/.env/state.db 越界读抛错，白名单内放行', () => {
  const home = 'D:\\hermes-home'
  const roots = whitelist(home)
  for (const bad of ['config.yaml', '.env', 'state.db']) {
    assert.throws(() => assertAllowedRead(roots, path.join(home, bad)), /读取越界/)
  }
  assert.equal(assertAllowedRead(roots, path.join(home, 'skills', 'devops')), path.resolve(home, 'skills', 'devops'))
  assert.equal(assertAllowedRead(roots, path.join(home, 'memories', 'MEMORY.md')), path.resolve(home, 'memories', 'MEMORY.md'))
})

test('detect：嵌套类别 skills 检出，兼容/缺描述分类，.hub 与 README 跳过', async (t) => {
  const home = await makeTempHome(t)
  const skillsRoot = path.join(home, 'skills')
  // 兼容技能：devops/deploy-k8s（frontmatter name+description 齐）。
  await mkdir(path.join(skillsRoot, 'devops', 'deploy-k8s'), { recursive: true })
  await writeFile(path.join(skillsRoot, 'devops', 'deploy-k8s', 'SKILL.md'),
    '---\nname: Deploy K8s\ndescription: Deploy to k8s clusters\n---\n\n# Steps\n', 'utf8')
  // 不兼容技能：qa/smoke-tests（缺 description）。
  await mkdir(path.join(skillsRoot, 'qa', 'smoke-tests'), { recursive: true })
  await writeFile(path.join(skillsRoot, 'qa', 'smoke-tests', 'SKILL.md'),
    '---\nname: smoke-tests\n---\n\n# Run smoke tests\n', 'utf8')
  // 隐藏目录与隐藏清单文件应跳过。
  await mkdir(path.join(skillsRoot, '.hub'), { recursive: true })
  await writeFile(path.join(skillsRoot, '.hub', 'SKILL.md'),
    '---\nname: hub-skill\ndescription: bundled\n---\n\nx\n', 'utf8')
  await writeFile(path.join(skillsRoot, '.bundled_manifest'), 'bundled\n', 'utf8')
  await writeFile(path.join(skillsRoot, 'devops', 'README.md'), '# category index\n', 'utf8')

  const detection = await detect(home)
  assert.equal(detection.source, 'hermes')
  assert.equal(detection.homeExists, true)
  assert.equal(detection.sessions.length, 0)
  assert.deepEqual(detection.errors, [])
  assert.equal(detection.skills.length, 2)

  const byId = Object.fromEntries(detection.skills.map((s) => [s.id, s]))
  const deploy = byId['devops/deploy-k8s']
  const smoke = byId['qa/smoke-tests']
  assert.ok(deploy, '嵌套类别技能以相对路径为 id')
  assert.ok(smoke)
  assert.equal(deploy.compatible, true)
  assert.equal(deploy.name, 'Deploy K8s')
  assert.equal(deploy.description, 'Deploy to k8s clusters')
  assert.equal(deploy.digest, digestText('---\nname: Deploy K8s\ndescription: Deploy to k8s clusters\n---\n\n# Steps\n'))
  assert.equal(smoke.compatible, false)
  assert.equal(smoke.name, 'smoke-tests')
  assert.equal(smoke.description, '')
  assert.ok(!detection.skills.some((s) => s.id.includes('.hub') || s.id.includes('bundled_manifest') || s.id.includes('README')))
})

test('detect：skills 缺失/无 SKILL.md → 空数组，不报错', async (t) => {
  const home = await makeTempHome(t)
  await mkdir(path.join(home, 'skills', 'empty-category'), { recursive: true })
  const detection = await detect(home)
  assert.equal(detection.homeExists, true)
  assert.deepEqual(detection.skills, [])
  assert.deepEqual(detection.errors, [])
})

test('detect：MEMORY.md/USER.md 检出（bytes/digest 正确），缺失文件跳过', async (t) => {
  const home = await makeTempHome(t)
  const memoriesRoot = path.join(home, 'memories')
  await mkdir(memoriesRoot, { recursive: true })
  const memContent = '§ 记住张三喜欢简洁\n§ 项目用 k8s 部署\n'
  const userContent = '§ 我叫李四\n'
  await writeFile(path.join(memoriesRoot, 'MEMORY.md'), memContent, 'utf8')
  await writeFile(path.join(memoriesRoot, 'USER.md'), userContent, 'utf8')

  const detection = await detect(home)
  assert.equal(detection.memories.length, 2)
  const mem = detection.memories.find((m) => m.id === 'MEMORY.md')
  const user = detection.memories.find((m) => m.id === 'USER.md')
  assert.ok(mem && user)
  assert.equal(mem.kind, 'hermes-memory')
  assert.equal(user.kind, 'hermes-user')
  assert.equal(mem.file, path.join(memoriesRoot, 'MEMORY.md'))
  assert.equal(mem.bytes, Buffer.byteLength(memContent, 'utf8'))
  assert.equal(user.bytes, Buffer.byteLength(userContent, 'utf8'))
  assert.equal(mem.digest, digestText(memContent))
  assert.equal(user.digest, digestText(userContent))
})

test('detect：home 不存在 → homeExists=false、空数组、无错误', async (t) => {
  const base = await makeTempHome(t)
  const detection = await detect(path.join(base, 'nope'))
  assert.equal(detection.homeExists, false)
  assert.deepEqual(detection.skills, [])
  assert.deepEqual(detection.memories, [])
  assert.deepEqual(detection.errors, [])
})
