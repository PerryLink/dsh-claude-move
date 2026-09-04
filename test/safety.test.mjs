// safety.test.mjs — 发布面源码安全 tripwire：断言插件绝不包含破坏性文件操作。
// 背景：历史事故表明「插件研发过程」可能把破坏性命令带进发布面，导致用户
// DSH 数据/个人目录被重置。本测试静态审计 index.mjs + lib/*.mjs + client/*.js，
// 只允许以下白名单写路径：
//   - lib/discovery.mjs 的 resetCacheFiles：unlink 本插件缓存目录下两个具名文件
//   - index.mjs 的 attachImportedSession：mkdir(claudecodeDir, { recursive: true })
// 其余任何 rm/rmdir/unlink/truncate/writeFileSync/renameSync/createWriteStream/
// archiveSession 一律判失败。测试文件与 dev/ 不在审计范围（不进 npm 包）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))

function readShipped(file) {
  return readFileSync(path.join(root, file), 'utf8')
}

test('安全审计：发布面只允许白名单内的写入/删除操作', () => {
  const sources = {
    'index.mjs': readShipped('index.mjs'),
    'client/client.js': readShipped(path.join('client', 'client.js')),
  }
  for (const name of readdirSync(path.join(root, 'lib')).filter((n) => n.endsWith('.mjs'))) {
    sources['lib/' + name] = readShipped(path.join('lib', name))
  }

  const forbidden = [
    /\brmSync\s*\(/, /\brmdirSync\s*\(/, /\bunlinkSync\s*\(/, /\btruncateSync\s*\(/,
    /\bwriteFileSync\s*\(/, /\brenameSync\s*\(/, /\bcreateWriteStream\s*\(/, /\bcopyFileSync\s*\(/,
    /\brm\s*\(/, /\brmdir\s*\(/, /\btruncate\s*\(/, /\barchiveSession\s*\(/,
  ]
  for (const [name, source] of Object.entries(sources)) {
    for (const re of forbidden) {
      assert.doesNotMatch(source, re, `${name} 不得包含 ${re}（复制式迁移：绝不删除/改写任何内容）`)
    }
  }

  // unlink 只允许出现在 discovery.mjs 的 resetCacheFiles 内。
  const discovery = sources['lib/discovery.mjs']
  const unlinkIdx = discovery.indexOf('unlink(')
  assert.ok(unlinkIdx >= 0)
  const resetStart = discovery.indexOf('export async function resetCacheFiles')
  const resetEnd = discovery.indexOf('\n}', resetStart)
  assert.ok(unlinkIdx > resetStart && unlinkIdx < resetEnd,
    'unlink 只允许存在于 resetCacheFiles（只删本插件缓存目录下两个具名文件）')

  // recursive: true 只允许三种用法：mkdir 创建 claudecode 工作区目录、
  // readdir 递归读取（只读）、importDirectory 的目录递归参数（只读遍历）。
  for (const [name, source] of Object.entries(sources)) {
    const re = /recursive\s*:\s*true/g
    for (const match of source.matchAll(re)) {
      const windowText = source.slice(Math.max(0, match.index - 200), match.index)
      assert.match(windowText, /mkdir\s*\(|readdir\s*\(|importDirectory\s*\(/,
        `${name} 的 recursive: true 只允许出现在 mkdir/readdir/importDirectory 调用中`)
    }
  }

  // client 面板只请求本插件 /api/claude-move/* 路由；fetch 只在 json 助手内。
  const client = sources['client/client.js']
  const apiLiterals = client.match(/['"`](\/api\/[^'"`]*)['"`]/g) ?? []
  assert.ok(apiLiterals.length > 0, 'client 至少声明一个本插件 API 路由')
  assert.ok(apiLiterals.every((l) => l.includes('/api/claude-move/')),
    `client 只允许请求本插件路由，发现：${apiLiterals.filter((l) => !l.includes('/api/claude-move/')).join(', ')}`)
  const fetchCount = (client.match(/fetch\(/g) ?? []).length
  const fetchInsideJson = (client.match(/async function json\([^)]*\)[\s\S]*?fetch\(/g) ?? []).length
  assert.ok(fetchInsideJson >= fetchCount, 'fetch 调用只存在于 json 助手内（统一走 /api/claude-move/*）')
})

test('安全审计：源 Claude 数据目录从不被写入（写入只经 sessionPersistence 服务与缓存目录）', () => {
  const index = readShipped('index.mjs')
  // 落盘只有 create+append（服务调用），没有直接文件写入；handle 基线经
  // normalizeHandleHeader 规范化后仍只把 header 交给 create。
  assert.match(index, /sp\.create\(header\)/)
  assert.match(index, /sp\.append\(/)
  const discovery = readShipped('lib/discovery.mjs')
  // 缓存写入集中在 resolveCacheDir 返回的目录，且只写 index/imports 两个 JSON。
  assert.match(discovery, /writeJsonAtomic\(path\.join\(cacheDir, '(index|imports)\.json'\)/)
  assert.doesNotMatch(discovery, /writeFile\([^)]*claudeHome/, '绝不写入 Claude 数据目录')
})
