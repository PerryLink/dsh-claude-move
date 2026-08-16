// claude-parser.test.mjs — Claude 源解析器：复用一期扫描输出 Detection 形状、
// 白名单负例、hooks 提取。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { detect, locateHome, whitelist } from '../../lib/sources/claude/parser.mjs'
import { assertAllowedRead } from '../../lib/sources/contract.mjs'

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

test('locateHome：CLAUDE_CONFIG_DIR 优先', () => {
  assert.equal(locateHome({ CLAUDE_CONFIG_DIR: 'D:\\claude-cfg' }), 'D:\\claude-cfg')
})

test('detect：projects 会话/memories/skills/CLAUDE.md/settings hooks 全检出', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'claude-home-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const project = path.join(home, 'projects', 'demo-proj')
  await mkdir(path.join(project, 'memory'), { recursive: true })
  await mkdir(path.join(home, 'skills', 'pdf-helper'), { recursive: true })
  await copyFile(path.join(fixturesDir, 'simple.jsonl'), path.join(project, 'sess-1.jsonl'))
  await writeFile(path.join(project, 'memory', 'notes.md'), '---\ntype: project\n---\n记住：先写测试。\n')
  await writeFile(path.join(home, 'skills', 'pdf-helper', 'SKILL.md'), '---\nname: pdf-helper\ndescription: PDF 处理\n---\n\n# Steps\n1. 提取\n')
  await writeFile(path.join(home, 'CLAUDE.md'), '# Global rules\nBe careful.\n')
  await writeFile(path.join(home, 'settings.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] },
  }))

  const d = await detect(home)
  assert.equal(d.source, 'claude')
  assert.equal(d.sessions.length, 1)
  assert.equal(d.sessions[0].format, 'claude-jsonl')
  assert.equal(d.sessions[0].turns, 1)
  assert.equal(d.memories.length, 1)
  assert.equal(d.memories[0].kind, 'claude-memory:project')
  assert.equal(d.skills.length, 1)
  assert.equal(d.skills[0].name, 'pdf-helper')
  assert.equal(d.skills[0].compatible, true)
  assert.equal(d.instructions.length, 1)
  assert.equal(d.instructions[0].kind, 'claude-md')
  assert.equal(d.hooks.length, 1)
  assert.equal(d.hooks[0].kind, 'claude-hook:PreToolUse')
  assert.equal(d.hooks[0].matcher, 'Bash')
})

test('detect：数据根不存在 → homeExists=false 且空清单', async () => {
  const d = await detect(path.join(tmpdir(), 'no-such-claude-' + Date.now()))
  assert.equal(d.homeExists, false)
  assert.equal(d.sessions.length, 0)
  assert.equal(d.errors.length, 0)
})

test('白名单：projects/skills/CLAUDE.md/settings.json 内放行，其余越界', () => {
  const home = path.join(tmpdir(), 'claude-wl')
  const roots = whitelist(home)
  assert.equal(assertAllowedRead(roots, path.join(home, 'projects', 'x', 'a.jsonl')), path.join(home, 'projects', 'x', 'a.jsonl'))
  assert.throws(() => assertAllowedRead(roots, path.join(home, '..', '.claude.json')), /越界/)
  assert.throws(() => assertAllowedRead(roots, path.join(home, 'shell-snapshots', 's.sh')), /越界/)
})
