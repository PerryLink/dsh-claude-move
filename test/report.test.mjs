// report.test.mjs — 报告辅助单测：密钥扫描（重叠不重复计数、只报位置）、权限统计。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanSecrets, summarizePermissions } from '../lib/report.mjs'

test('scanSecrets：各类型命中且只报位置不报内容', () => {
  const text = [
    'aws: AKIA1234567890ABCDEF',
    'gh: ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
    'google: AIzaSyA12345678901234567890123456789012',
    'pk: -----BEGIN RSA PRIVATE KEY-----',
  ].join('\n')
  const result = scanSecrets(text)
  assert.equal(result.total, 4)
  assert.deepEqual(result.hits.map((h) => h.kind), ['aws-access-key', 'github-token', 'google-api-key', 'private-key'])
  assert.equal(JSON.stringify(result).includes('AKIA1234'), false, '不展示凭据内容')
})

test('scanSecrets：anthropic 与 openai 前缀不重叠计数', () => {
  const result = scanSecrets('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789\nsk-proj-abcdefghijklmnopqrstuvwxyz0123456789')
  assert.equal(result.total, 2)
  assert.deepEqual(result.hits.map((h) => h.kind), ['anthropic-key', 'openai-key'])
})

test('scanSecrets：无命中返回空结构；hit 上限只截明细不截计数', () => {
  assert.deepEqual(scanSecrets('nothing here'), { total: 0, hits: [] })
  const lines = []
  for (let i = 0; i < 60; i++) lines.push('AKIA1234567890ABCDEF')
  const result = scanSecrets(lines.join('\n'), 50)
  assert.equal(result.total, 60)
  assert.equal(result.hits.length, 50)
})

test('summarizePermissions：只统计权限类记录', () => {
  const perms = summarizePermissions({ permission: 3, 'permission-mode': 7, 'queue-operation': 2, user: 100 })
  assert.equal(perms.total, 12)
  assert.deepEqual(perms.byType, { permission: 3, 'permission-mode': 7, 'queue-operation': 2 })
  assert.deepEqual(summarizePermissions({}), { byType: {}, total: 0 })
})
