// SPDX-License-Identifier: Apache-2.0
// lib/settings.mjs — Claude Code settings.json 翻译（F14，零 DSH 依赖）。
//
// 不直接搬运（DSH 配置格式不兼容），而是解析 allow/deny/ask 权限规则与
// model 偏好，生成 DSH 配置建议文本；无法映射的键显式列出，绝不静默丢弃。
// 建议里的 cordis.yml 片段是示意（DSH 权限面为 permission presets + approval
// 策略，具体生效位置以官方 docs/permission-presets 为准）。

/** 已识别的 Claude settings.json 顶层键（其余计入 unmapped）。 */
export const KNOWN_SETTINGS_KEYS = Object.freeze([
  'permissions', 'model', 'env', 'hooks', 'apiKeyHelper', 'includeCoAuthoredBy',
  'forceLoginMethod', 'cleanupPeriodDays', 'spinnerTipsEnabled',
])

/**
 * 解析 settings.json 文本。
 * @param raw - 原始 JSON 文本。
 * @returns 解析结果；坏 JSON 返回 `{ error }`。
 */
export function parseClaudeSettings(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { error: String((err && err.message) || err) }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'settings.json 根节点不是 JSON 对象' }
  }
  return { parsed }
}

/**
 * 把一条 Claude 权限规则翻译为 DSH 建议。规则形如 `Read(./path)`、
 * `Edit(~/.ssh/**)`、`Bash(npm run *)`、`WebFetch(domain:github.com)`。
 * @param rule - 规则字符串。
 * @param action - allow | deny | ask。
 * @returns `{ title, tool, detail }` 或 null（无法识别工具域）。
 */
export function translatePermissionRule(rule, action) {
  const match = /^([A-Za-z]+)\s*\((.+)\)$/.exec(String(rule).trim())
  if (!match) return { title: `无法识别的规则：${rule}`, tool: 'unknown', detail: `保留原文待人工确认（${action}）。` }
  const [, tool, target] = match
  const actionLabel = { allow: '允许', deny: '拒绝', ask: '询问' }[action] ?? action
  return {
    title: `${actionLabel} ${tool}(${target})`,
    tool,
    target,
    detail: '',
  }
}

/**
 * 翻译整个 settings.json（F14）。
 * @param raw - settings.json 原始文本。
 * @param location - 报告里显示的来源位置。
 * @returns `{ suggestions, unmapped }`；解析失败返回 `{ error, unmapped: [] }`。
 */
export function translateSettings(raw, location) {
  const { parsed, error } = parseClaudeSettings(raw)
  if (error) return { error: `${location}: ${error}`, unmapped: [] }

  const suggestions = []
  const unmapped = []

  const permissions = parsed.permissions
  if (permissions && typeof permissions === 'object' && !Array.isArray(permissions)) {
    for (const action of ['deny', 'ask', 'allow']) {
      const rules = permissions[action]
      if (!Array.isArray(rules)) continue
      for (const rule of rules) {
        const translated = translatePermissionRule(rule, action)
        if (translated) suggestions.push({ kind: 'permission', action, ...translated })
      }
    }
    if (Array.isArray(permissions.additionalDirectories)) {
      suggestions.push({
        kind: 'additional-directories',
        action: 'allow',
        title: `额外工作目录 ${permissions.additionalDirectories.length} 个`,
        tool: 'directory',
        target: permissions.additionalDirectories.join(', '),
        detail: 'DSH 按工作区授权目录访问；在 DSH 中为这些目录创建工作区即可。',
      })
    }
    for (const key of Object.keys(permissions)) {
      if (!['allow', 'deny', 'ask', 'additionalDirectories', 'defaultMode'].includes(key)) {
        unmapped.push(`permissions.${key}`)
      }
    }
  }

  if (typeof parsed.model === 'string' && parsed.model.length > 0) {
    suggestions.push({
      kind: 'model',
      action: 'prefer',
      title: `默认模型偏好：${parsed.model}`,
      tool: 'model',
      target: parsed.model,
      detail: '在 DSH Settings → Models 中选择对应模型；DSH 不读取 Claude 的模型 id。',
    })
  }

  if (typeof parsed.apiKeyHelper === 'string' && parsed.apiKeyHelper.length > 0) {
    suggestions.push({
      kind: 'api-key-helper',
      action: 'prefer',
      title: `apiKeyHelper：${parsed.apiKeyHelper}`,
      tool: 'credential',
      target: parsed.apiKeyHelper,
      detail: 'DSH 用 Settings → Models 或凭据服务管理密钥；不执行外部脚本获取密钥。',
    })
  }

  for (const key of Object.keys(parsed)) {
    if (!KNOWN_SETTINGS_KEYS.includes(key)) unmapped.push(key)
  }
  if (parsed.env && typeof parsed.env === 'object') {
    unmapped.push('env（环境变量不自动搬运，请在 DSH 会话里显式设置）')
  }
  if (parsed.hooks && typeof parsed.hooks === 'object') {
    unmapped.push('hooks（Claude hooks 不自动搬运；DSH 对应机制为 hooks 桥接插件）')
  }

  return { suggestions, unmapped, location }
}

/**
 * 汇总一个或多个 settings.json 的翻译结果。
 * @param files - `[{ location, raw }]`。
 * @returns `{ suggestions, unmapped, errors }`。
 */
export function translateSettingsBatch(files) {
  const suggestions = []
  const unmapped = []
  const errors = []
  for (const { location, raw } of files) {
    const result = translateSettings(raw, location)
    if (result.error) {
      errors.push(result.error)
      continue
    }
    suggestions.push(...result.suggestions)
    unmapped.push(...result.unmapped)
  }
  return { suggestions, unmapped, errors }
}
