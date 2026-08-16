// SPDX-License-Identifier: Apache-2.0
// lib/wizard.mjs — 四合一迁移向导核心（纯编排，零 DSH 依赖）。
//
// 阶段：detect（四源扫描）→ plan（清单→迁移计划）→ preview（状态/diff/冲突）→
// execute（审批门 + 逐项落盘 + manifest 幂等记录）→ report（汇总 + 不支持清单）。
// 所有副作用经注入的 runtime 端口执行（index.mjs 接线到 DSH 服务），本模块
// 只做状态机与幂等判定，可完全用假 runtime 单测。
//
// 幂等：manifest（move.json）按 key 记录 { digest, target, action, sectionDigest?,
// targetDigest?, appliedAt }；preview 据此判 new/unchanged/changed/conflict，
// execute 重跑只写变化项；force 对非冲突项重新应用。
// 冲突：目标已存在且内容与我们的记录不符（用户手工改过）→ diff 供选择，
// resolve = { key: 'skip'|'overwrite'|'rename'|'merge' }（默认 skip，绝不猜测）。

import { digestText } from './sources/contract.mjs'

/** 单计划执行结果的状态词表。 */
export const EXEC_STATUS = ['applied', 'skipped', 'conflict-skipped', 'unsupported', 'failed', 'not-approved']

/**
 * 预览一份计划：返回 `{ plan, status, diff?, reason? }`。
 * status ∈ new | unchanged | changed | conflict | unsupported。
 * @param runtime - 运行时端口（见 index.mjs 接线）。
 * @param plan - 迁移计划。
 * @param manifest - 已加载清单。
 * @param force - 是否强制（unchanged 也重应用）。
 * @returns 预览条目。
 */
export async function previewPlan(runtime, plan, manifest, force = false) {
  const rec = manifest[plan.key]

  if (plan.action === 'unsupported') {
    return { plan, status: 'unsupported', reason: plan.reason }
  }
  if (plan.action === 'import-session') {
    const state = await runtime.sessionStatus(plan.source)
    if (state === 'updates') return { plan, status: 'changed', reason: '源会话有新增轮次（将增量续写）' }
    if (state === 'imported') return force
      ? { plan, status: 'changed', reason: 'force：另存完整副本' }
      : { plan, status: 'unchanged', reason: '已导入' }
    return { plan, status: 'new' }
  }
  if (plan.action === 'register-command') {
    if (runtime.hasCommand && runtime.hasCommand(plan.target.commandName)) {
      return force && (!rec || rec.digest !== plan.digest)
        ? { plan, status: 'changed', reason: 'force：重新注册' }
        : { plan, status: 'unchanged', reason: '命令已注册' }
    }
    return { plan, status: 'new' }
  }
  if (plan.action === 'append-section') {
    const current = await runtime.readTarget(plan.target.path)
    const { planSection } = await import('./agmd-section.mjs')
    const step = planSection(current, plan.key, plan.content, plan.source.file)
    if (step.status === 'unchanged') return { plan, status: 'unchanged' }
    if (step.status === 'new') return { plan, status: 'new' }
    // replace：区分「源更新」（我们的记录还在）与「用户改过」（冲突）。
    const stored = rec?.sectionDigest
    const newDigest = digestText(step.newContent)
    if (stored && digestText(step.oldContent) === stored) {
      return { plan, status: 'changed', reason: '源文件内容更新' }
    }
    if (digestText(step.oldContent) === newDigest) return { plan, status: 'unchanged' }
    return {
      plan,
      status: 'conflict',
      reason: '目标段已被手工修改（或来自旧版本），diff 供选择',
      diff: step.diff,
      oldContent: step.oldContent,
      newContent: step.newContent,
    }
  }
  // 技能类：copy / convert-copy
  const targetText = await runtime.readTarget(plan.target.path)
  const targetExists = targetText !== null
  if (!targetExists) {
    if (rec && rec.digest === plan.digest) {
      return { plan, status: 'changed', reason: '目标缺失（可能被删除），重新应用' }
    }
    return { plan, status: 'new' }
  }
  if (!rec) {
    return {
      plan,
      status: 'conflict',
      reason: '目标已存在且无迁移记录，diff 供选择',
      existing: targetText.length > 800 ? targetText.slice(0, 800) + '\n…（截断）' : targetText,
    }
  }
  if (rec.digest === plan.digest && rec.targetDigest === digestText(targetText)) {
    return force ? { plan, status: 'changed', reason: 'force：重新应用' } : { plan, status: 'unchanged' }
  }
  if (rec.targetDigest === digestText(targetText)) {
    return { plan, status: 'changed', reason: '源技能内容更新' }
  }
  return {
    plan,
    status: 'conflict',
    reason: '目标被手工修改（或来自旧版本），diff 供选择',
    existing: targetText.length > 800 ? targetText.slice(0, 800) + '\n…（截断）' : targetText,
  }
}

/**
 * 全量预览：每计划一条预览 + 冲突清单 + 可执行计数。
 * @param runtime - 运行时端口。
 * @param plans - 迁移计划数组。
 * @param manifest - 已加载清单。
 * @param force - 强制。
 * @returns `{ previews, conflicts, counts: {new, unchanged, changed, conflict, unsupported} }`。
 */
export async function runPreview(runtime, plans, manifest, force = false) {
  const previews = []
  const conflicts = []
  const counts = { new: 0, unchanged: 0, changed: 0, conflict: 0, unsupported: 0 }
  for (const plan of plans) {
    const entry = await previewPlan(runtime, plan, manifest, force)
    counts[entry.status] = (counts[entry.status] ?? 0) + 1
    if (entry.status === 'conflict') conflicts.push(entry)
    previews.push(entry)
  }
  return { previews, conflicts, counts }
}

/**
 * 执行迁移（副作用全部经 runtime 端口）：
 * - 审批门：有实际写入动作且 requireApproval 时先调 runtime.approval，
 *   非 allowed-once 一律零写入（fail-closed）。
 * - 逐项执行前重算预览（TOCTOU 防护）：冲突项按 resolve 处理，默认跳过。
 * - 每项成功后经 runtime.record 写入 manifest 记录。
 * @param runtime - 运行时端口。
 * @param opts - `{ plans, manifest, resolve, force, selection, requireApproval, approval, signal }`。
 * @returns `{ approved, results, applied, skipped, conflictSkipped, unsupported, failed }`。
 */
export async function runExecute(runtime, opts = {}) {
  const { resolve = {}, force = false, requireApproval = true, approval } = opts
  const selection = new Set(opts.selection ?? [])
  const manifest = opts.manifest
  const results = []
  const tally = { applied: 0, skipped: 0, conflictSkipped: 0, unsupported: 0, failed: 0, newSessions: [] }

  // 审批门（fail-closed）：只审批会真正产生写入的计划。
  const actionable = opts.plans.filter((p) =>
    p.action !== 'unsupported' && (selection.size === 0 || selection.has(p.key)))
  const previews = new Map()
  for (const plan of actionable) {
    previews.set(plan.key, await previewPlan(runtime, plan, manifest, force))
  }
  const writes = [...previews.values()].filter((e) => e.status === 'new' || e.status === 'changed')
  if (writes.length > 0 && requireApproval) {
    const outcome = await approval({
      ...(opts.approvalContext ?? {}),
      reason: `四合一迁移将写入 ${writes.length} 项（会话 ${writes.filter((e) => e.plan.action === 'import-session').length} 个、技能 ${writes.filter((e) => e.plan.kind === 'skill').length} 个、AGENTS.md 段 ${writes.filter((e) => e.plan.action === 'append-section').length} 个、命令 ${writes.filter((e) => e.plan.action === 'register-command').length} 个）`,
    })
    if (outcome !== 'allowed-once') {
      return {
        approved: false,
        outcome,
        results: writes.map((e) => ({ key: e.plan.key, status: 'not-approved', detail: `审批未通过（${outcome}）` })),
        ...tally,
      }
    }
  }

  for (const plan of opts.plans) {
    if (selection.size > 0 && !selection.has(plan.key)) {
      results.push({ key: plan.key, status: 'skipped', detail: '未选中' })
      tally.skipped++
      continue
    }
    const entry = previews.get(plan.key) ?? await previewPlan(runtime, plan, manifest, force)
    const exec = await executePlan(runtime, plan, entry, resolve[plan.key] ?? 'skip', force)
    results.push(exec)
    if (exec.status === 'applied') tally.applied++
    else if (exec.status === 'skipped') tally.skipped++
    else if (exec.status === 'conflict-skipped') tally.conflictSkipped++
    else if (exec.status === 'unsupported') tally.unsupported++
    else if (exec.status === 'failed') tally.failed++
    if (exec.status === 'applied' && plan.action === 'import-session' && exec.detail?.sessionId) {
      tally.newSessions.push({ key: plan.key, sessionId: exec.detail.sessionId, title: plan.title })
    }
  }
  return { approved: true, outcome: 'allowed-once', results, ...tally }
}

/** 执行单个计划（含冲突解法与 manifest 记录）。 */
async function executePlan(runtime, plan, entry, resolution, force) {
  const fail = (err) => ({ key: plan.key, status: 'failed', detail: String((err && err.message) || err) })

  if (plan.action === 'unsupported') {
    return { key: plan.key, status: 'unsupported', detail: plan.reason ?? '不支持' }
  }
  if (entry.status === 'unsupported') {
    return { key: plan.key, status: 'unsupported', detail: plan.reason ?? entry.reason ?? '不支持' }
  }
  if (entry.status === 'unchanged' && !force) {
    return { key: plan.key, status: 'skipped', detail: '已迁移（幂等跳过）' }
  }
  if (entry.status === 'conflict') {
    // merge 只对 append-section 有意义；技能类 merge 按 skip 处理（不猜测）。
    const unusable = plan.action !== 'append-section' && resolution === 'merge'
    if (resolution === 'skip' || !resolution || unusable) {
      return { key: plan.key, status: 'conflict-skipped', detail: '目标冲突且未选择解法（默认跳过）' }
    }
  }

  try {
    if (plan.action === 'import-session') {
      const result = await runtime.importSession(plan, { force })
      return { key: plan.key, status: 'applied', detail: result }
    }
    if (plan.action === 'register-command') {
      const result = await runtime.registerCommand(plan.target.commandName, plan.content)
      if (result.registered === false) {
        return { key: plan.key, status: 'failed', detail: result.reason ?? '命令注册失败' }
      }
      // 记录含提示词：插件重启后 apply 时按 manifest 重建命令注册。
      await runtime.record(plan.key, { digest: plan.digest, action: 'register-command', target: plan.target.commandName, prompt: plan.content })
      return { key: plan.key, status: 'applied', detail: { commandName: plan.target.commandName } }
    }
    if (plan.action === 'append-section') {
      const target = await runtime.readTarget(plan.target.path)
      const { planSection, mergedSection } = await import('./agmd-section.mjs')
      let step
      if (resolution === 'merge') {
        step = mergedSection(target, plan.key, plan.content, plan.source.file)
      } else {
        step = planSection(target, plan.key, plan.content, plan.source.file)
      }
      if (step.status === 'unchanged') {
        return { key: plan.key, status: 'skipped', detail: '段内容未变（幂等跳过）' }
      }
      const { sectionInner } = await import('./agmd-section.mjs')
      await runtime.writeTarget(plan.target.path, step.text)
      await runtime.record(plan.key, {
        digest: plan.digest,
        action: 'append-section',
        target: plan.target.path,
        sectionDigest: digestText(sectionInner(step.status === 'new' ? plan.content : step.newContent, plan.source.file)),
      })
      return { key: plan.key, status: 'applied', detail: { target: plan.target.path, section: step.status } }
    }
    // 技能类：copy / convert-copy
    let targetPath = plan.target.path
    if (resolution === 'rename') {
      targetPath = await runtime.renameTarget(plan.target.path)
    }
    const sourceText = await runtime.readSource(plan.source.file)
    if (sourceText === null) throw new Error('源技能文件不可读：' + plan.source.file)
    const { renderSkill } = await import('./skill-migrate.mjs')
    const rendered = plan.action === 'convert-copy'
      ? renderSkill(sourceText, plan.source.name).content
      : sourceText
    await runtime.writeTarget(targetPath, rendered)
    await runtime.record(plan.key, {
      digest: plan.digest,
      targetDigest: digestText(rendered),
      action: plan.action,
      target: targetPath,
    })
    return { key: plan.key, status: 'applied', detail: { target: targetPath, converted: plan.action === 'convert-copy' } }
  } catch (err) {
    return fail(err)
  }
}

/**
 * 报告行渲染（模型可读摘要；报告文本以短 persona 语句开头，见 persona.mjs）。
 * @param execResult - runExecute 输出。
 * @param lang - 'en' | 'zh'。
 * @returns 行数组。
 */
export function reportLines(execResult, lang = 'zh') {
  const zh = lang === 'zh'
  const r = execResult
  const lines = []
  if (r.approved === false) {
    lines.push(zh
      ? `迁移未执行：审批未通过（${r.outcome ?? 'unavailable'}）。零写入。`
      : `Migration not executed: approval failed (${r.outcome ?? 'unavailable'}). Nothing was written.`)
    return lines
  }
  lines.push(zh
    ? `迁移完成：应用 ${r.applied} 项、幂等跳过 ${r.skipped} 项、冲突未处理 ${r.conflictSkipped} 项、不支持 ${r.unsupported} 项、失败 ${r.failed} 项。`
    : `Migration done: ${r.applied} applied, ${r.skipped} skipped (idempotent), ${r.conflictSkipped} conflicts left, ${r.unsupported} unsupported, ${r.failed} failed.`)
  for (const s of r.newSessions ?? []) {
    lines.push(zh
      ? `- 会话 ${s.sessionId}（${s.title ?? '无标题'}）已导入，可继续对话。`
      : `- Session ${s.sessionId} (${s.title ?? 'untitled'}) imported and resumable.`)
  }
  for (const res of r.results ?? []) {
    if (res.status === 'failed') lines.push(zh ? `- 失败：${res.key}（${res.detail}）` : `- Failed: ${res.key} (${res.detail})`)
    if (res.status === 'unsupported') lines.push(zh ? `- 不支持：${res.key}（${res.detail}）` : `- Unsupported: ${res.key} (${res.detail})`)
    if (res.status === 'conflict-skipped') lines.push(zh ? `- 冲突未处理：${res.key}（${res.detail}）` : `- Conflict left: ${res.key} (${res.detail})`)
  }
  return lines
}

/**
 * 一步式向导（/move 命令与组合工具用）：detect → plan → preview → execute → report。
 * @param runtime - 运行时端口（含 detect/map 接口）。
 * @param opts - `{ sources, force, resolve, selection, requireApproval, signal }`。
 * @returns `{ detections, plans, preview, execution }`。
 */
export async function runWizard(runtime, opts = {}) {
  const sources = opts.sources ?? []
  const detections = []
  for (const source of sources) {
    detections.push(await runtime.detect(source))
  }
  const plans = []
  const mapErrors = []
  for (const detection of detections) {
    const mapped = await runtime.map(detection.source, detection)
    plans.push(...(mapped.plans ?? []))
    for (const err of mapped.errors ?? []) mapErrors.push(err)
  }
  const manifest = await runtime.loadManifest()
  const preview = await runPreview(runtime, plans, manifest, opts.force)
  const execution = await runExecute(runtime, {
    plans, manifest, force: opts.force,
    resolve: opts.resolve ?? {},
    selection: opts.selection ?? [],
    requireApproval: opts.requireApproval !== false,
    approval: runtime.approval,
    signal: opts.signal,
  })
  return { detections, plans, mapErrors, preview, execution }
}
