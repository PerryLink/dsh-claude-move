// persona.test.mjs — 短 persona 段落：一句角色陈述开头、保持短小。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { personaSentence, personaParagraph } from '../lib/persona.mjs'

test('personaSentence：一句角色陈述（Minimal persona 风格）', () => {
  assert.equal(personaSentence('software engineer'), 'You are a helpful software engineer assistant.')
  assert.equal(personaSentence('migration', 'zh'), '你是一名高效的迁移助手。')
})

test('personaParagraph：开头即角色陈述，总长很短', () => {
  const en = personaParagraph('migration')
  assert.ok(en.startsWith('You are a helpful migration assistant.'))
  assert.ok(en.length < 160)
  const zh = personaParagraph('迁移', 'zh')
  assert.ok(zh.startsWith('你是一名高效的迁移助手。'))
  assert.ok(zh.length < 100)
})
