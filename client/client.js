// SPDX-License-Identifier: Apache-2.0
// client/client.js — dsh-claude-move 浏览器迁移面板（F16）。
//
// 零依赖 vanilla 面板：host 端 dsh.client 扫描把本文件作为 classic script
// 注入 __DSH_BOOT__ 图，执行时经 window.__ModuleLoader__.load 注册工厂；
// 工厂闭包在首次 materialize 时运行，apply 挂载浮层面板（无注入服务，
// 只依赖 DOM + 本插件自注册的 /api/claude-move/* JSON 路由）。
// 面板自身不产生任何模型可见内容。文案按浏览器语言 zh/en 双语（D3）。

(function () {
  'use strict'
  if (typeof window === 'undefined' || !window.__ModuleLoader__ || !window.__ModuleLoader__.load) return
  window.__ModuleLoader__.load({
    id: 'dsh-claude-move',
    factory: function () {
      return {
        name: 'claude-move-panel',
        inject: [],
        apply: function (ctx) { installPanel(ctx) },
        // 纯函数测试面（U3）：面板仅此三个无 I/O/时钟/随机的纯函数。
        helpers: { panelText, esc, safeService, strings: PANEL_STRINGS },
      }
    },
  })
})()

/**
 * 特性探测客户端 Cordis 上下文里的官方服务（B1）。老 shell 没有 sessions/
 * workspaces 服务时不写入 inject（缺服务会导致 boot sweep FAILED），改在
 * apply 里用 get 探测：有则免刷新更新会话列表、直接打开会话，无则回退整页刷新。
 * @param ctx - 客户端 Cordis 上下文。
 * @param name - 服务名。
 * @returns 服务对象或 undefined。
 */
function safeService(ctx, name) {
  try {
    const svc = ctx && typeof ctx.get === 'function' ? ctx.get(name) : undefined
    return svc ?? undefined
  } catch {
    return undefined
  }
}

/** 面板文案（D3）：zh/en 双语，缺失键回退英文键名。 */
const PANEL_STRINGS = {
  zh: {
    panelTitle: 'Claude Code 迁移',
    openButton: '🐳 Claude 迁移',
    refresh: '刷新',
    refreshTitle: '重新扫描',
    reset: '重置缓存',
    resetTitle: '重置扫描缓存与导入映射（保留已导入会话）',
    close: '关闭',
    filterPlaceholder: '关键词过滤（标题/会话）…',
    importAll: '批量导入全部',
    cancel: '取消',
    cancelTitle: '取消当前导入',
    scanning: '扫描中…',
    scanned: '已扫描：{0} 个项目 / {1} 个会话',
    panelDisabled: '面板路由未启用：enableWebPanel 为 false 或 Web 服务未加载，面板不可用',
    panelDisabledImport: '面板路由未启用：enableWebPanel 为 false 或 Web 服务未加载，导入不可用',
    scanFailed: '扫描失败：',
    gitDirty: 'git 脏 ',
    git: 'git ',
    dirMissing: '目录不存在',
    imported: '已导入',
    importedNew: '已导入·有新增',
    sourceMissing: '源缺失',
    notImported: '未导入',
    messagesTools: '{0} 消息 · {1} 工具',
    showMore: '已显示 {0}/{1} 个会话，点击加载更多…',
    empty: '（无数据，点「刷新」重新扫描）',
    kvSession: '会话：',
    kvLastActivity: '最近活动：',
    messagesToolCalls: '{0} 消息 · {1} 工具调用',
    kvDshSession: 'DSH 会话：',
    kvDir: '目录：',
    unknown: '未知',
    dirNotExists: '（不存在）',
    importContinue: '导入并继续',
    openSession: '打开会话',
    openSessionTitle: '在当前窗口打开已导入会话',
    refreshSessions: '刷新会话列表',
    refreshSessionsTitle: '导入后刷新会话列表以点开续聊',
    cacheReset: '缓存已重置，正在重新扫描…',
    resetFailed: '重置失败：',
    submitting: '提交导入…',
    importing: '导入中：{0}/{1} 新增，{2} 追加，{3} 失败',
    importDone: '导入完成：新增 {0}、已存在 {1}、追加 {2}、跳过 {3}、失败 {4}。会话列表已自动刷新，无需重启 dsh。',
    importCancelled: '导入已取消。',
    importFailed: '导入失败：',
    cancelling: '正在取消…',
    cancelFailed: '取消失败：',
    unknownError: '未知错误',
  },
  en: {
    panelTitle: 'Claude Code Migration',
    openButton: '🐳 Claude Migration',
    refresh: 'Refresh',
    refreshTitle: 'Rescan',
    reset: 'Reset cache',
    resetTitle: 'Reset scan cache and import map (imported sessions are kept)',
    close: 'Close',
    filterPlaceholder: 'Filter by keyword (title/session)…',
    importAll: 'Import everything',
    cancel: 'Cancel',
    cancelTitle: 'Cancel current import',
    scanning: 'Scanning…',
    scanned: 'Scanned: {0} projects / {1} sessions',
    panelDisabled: 'Panel routes disabled: enableWebPanel is false or the Web service is not loaded — the panel is unavailable',
    panelDisabledImport: 'Panel routes disabled: enableWebPanel is false or the Web service is not loaded — import is unavailable',
    scanFailed: 'Scan failed: ',
    gitDirty: 'git dirty ',
    git: 'git ',
    dirMissing: 'directory missing',
    imported: 'imported',
    importedNew: 'imported · new turns',
    sourceMissing: 'source missing',
    notImported: 'not imported',
    messagesTools: '{0} msgs · {1} tools',
    showMore: 'Showing {0}/{1} sessions — click to load more…',
    empty: '(No data — click "Refresh" to rescan)',
    kvSession: 'Session: ',
    kvLastActivity: 'Last activity: ',
    messagesToolCalls: '{0} msgs · {1} tool calls',
    kvDshSession: 'DSH session: ',
    kvDir: 'Directory: ',
    unknown: 'unknown',
    dirNotExists: ' (missing)',
    importContinue: 'Import & continue',
    openSession: 'Open session',
    openSessionTitle: 'Open the imported session in this window',
    refreshSessions: 'Refresh session list',
    refreshSessionsTitle: 'Refresh the session list after importing',
    cacheReset: 'Cache reset — rescanning…',
    resetFailed: 'Reset failed: ',
    submitting: 'Submitting import…',
    importing: 'Importing: {0}/{1} new, {2} appended, {3} failed',
    importDone: 'Import done: {0} new, {1} existing, {2} appended, {3} skipped, {4} failed. The session list refreshed automatically — no DSH restart needed.',
    importCancelled: 'Import cancelled.',
    importFailed: 'Import failed: ',
    cancelling: 'Cancelling…',
    cancelFailed: 'Cancel failed: ',
    unknownError: 'unknown error',
  },
}

/** 按浏览器语言取文案并代入 {0}/{1}/… 参数。 */
function panelText(key, ...args) {
  const lang = typeof navigator !== 'undefined' && String(navigator.language || '').toLowerCase().startsWith('zh')
    ? 'zh'
    : 'en'
  let text = (PANEL_STRINGS[lang] ?? PANEL_STRINGS.en)[key] ?? key
  for (let i = 0; i < args.length; i++) {
    text = text.replace('{' + i + '}', String(args[i] ?? ''))
  }
  return text
}

/** HTML 转义（纯函数；面板渲染所有外部文本前调用）。 */
function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function installPanel(ctx) {
  if (document.getElementById('claude-move-panel')) return

  // B1：官方客户端服务（sessions.refresh/open、workspaces.refresh）——特性探测 + 回退。
  const sessions = safeService(ctx, 'sessions')
  const workspaces = safeService(ctx, 'workspaces')

  const style = document.createElement('style')
  style.textContent = `
#claude-move-panel { position: fixed; z-index: 2147483000; font: 13px/1.5 system-ui, "Segoe UI", sans-serif; }
#cm-open { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; padding: 8px 14px; border: 1px solid #3f6fae;
  border-radius: 999px; background: #0d1526; color: #7db4ff; cursor: pointer; font: 13px system-ui; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
#cm-open:hover { background: #16233c; }
#cm-drawer { position: fixed; right: 0; top: 0; bottom: 0; width: 460px; max-width: 92vw; display: flex; flex-direction: column;
  background: #101827; color: #d7e2f2; border-left: 1px solid #24344d; box-shadow: -8px 0 24px rgba(0,0,0,.4); }
#cm-head { padding: 10px 12px; border-bottom: 1px solid #24344d; display: flex; gap: 8px; align-items: center; }
#cm-head b { flex: 1; }
#cm-head button, #cm-detail button, #cm-foot button { background: #1c2a42; color: #cfe1f7; border: 1px solid #2f4466; border-radius: 6px;
  padding: 4px 10px; cursor: pointer; }
#cm-head button:hover, #cm-detail button:hover, #cm-foot button:hover { background: #27395a; }
#cm-filter { margin: 8px 12px; padding: 6px 8px; background: #0b1120; color: #d7e2f2; border: 1px solid #24344d; border-radius: 6px; }
#cm-body { flex: 1; overflow: auto; padding: 0 12px 12px; }
.cm-proj { margin: 10px 0 4px; color: #8fb4e8; }
.cm-proj .cm-badge { margin-left: 6px; }
.cm-sess { padding: 6px 8px; margin: 3px 0; border: 1px solid #24344d; border-radius: 8px; cursor: pointer; background: #131e33; }
.cm-sess:hover { background: #1a2944; }
.cm-sess .t { display: block; color: #e6eefb; }
.cm-badge { display: inline-block; padding: 0 6px; margin: 0 2px; border-radius: 999px; font-size: 11px; border: 1px solid #33476a; color: #9fb8da; }
.cm-badge.imported { border-color: #2f7d4f; color: #7fd6a2; }
.cm-badge.missing { border-color: #a4562f; color: #f0b98a; }
.cm-badge.dirty { border-color: #a08b2f; color: #ecd27e; }
#cm-detail { border-top: 1px solid #24344d; padding: 10px 12px; max-height: 40%; overflow: auto; background: #0d1424; }
#cm-detail h4 { margin: 0 0 6px; color: #9fc4f5; }
#cm-detail .kv { color: #9fb4d4; margin: 2px 0; }
#cm-foot { padding: 10px 12px; border-top: 1px solid #24344d; display: flex; gap: 8px; align-items: center; }
#cm-progress { height: 6px; flex: 1; background: #0b1120; border-radius: 3px; overflow: hidden; border: 1px solid #24344d; }
#cm-progress i { display: block; height: 100%; width: 0; background: #3f6fae; transition: width .3s; }
#cm-status { color: #8fa8cc; font-size: 12px; }
`

  const openBtn = document.createElement('button')
  openBtn.id = 'cm-open'
  openBtn.textContent = panelText('openButton')

  const root = document.createElement('div')
  root.id = 'claude-move-panel'
  const drawer = document.createElement('div')
  drawer.id = 'cm-drawer'
  drawer.style.display = 'none'
  drawer.innerHTML = `
    <div id="cm-head"><b>${panelText('panelTitle')}</b>
      <button id="cm-refresh" title="${panelText('refreshTitle')}">${panelText('refresh')}</button>
      <button id="cm-reset" title="${panelText('resetTitle')}">${panelText('reset')}</button>
      <button id="cm-close" title="${panelText('close')}">✕</button>
    </div>
    <input id="cm-filter" placeholder="${panelText('filterPlaceholder')}" />
    <div id="cm-body"></div>
    <div id="cm-detail" style="display:none"></div>
    <div id="cm-foot">
      <button id="cm-import-all">${panelText('importAll')}</button>
      <button id="cm-cancel" style="display:none" title="${panelText('cancelTitle')}">${panelText('cancel')}</button>
      <div id="cm-progress"><i></i></div>
      <span id="cm-status"></span>
    </div>`

  document.head.appendChild(style)
  root.appendChild(drawer)
  document.body.appendChild(openBtn)
  document.body.appendChild(root)

  let index = null
  let disabled = false
  const body = drawer.querySelector('#cm-body')
  const detail = drawer.querySelector('#cm-detail')
  const filter = drawer.querySelector('#cm-filter')
  const status = drawer.querySelector('#cm-status')
  const bar = drawer.querySelector('#cm-progress i')

  const show = (open) => { drawer.style.display = open ? 'flex' : 'none'; if (open) refresh() }
  openBtn.addEventListener('click', () => show(drawer.style.display === 'none'))
  drawer.querySelector('#cm-close').addEventListener('click', () => show(false))
  drawer.querySelector('#cm-refresh').addEventListener('click', () => refresh())
  drawer.querySelector('#cm-reset').addEventListener('click', () => { void resetCache() })
  drawer.querySelector('#cm-import-all').addEventListener('click', () => importJob('all'))
  const cancelBtn = drawer.querySelector('#cm-cancel')
  cancelBtn.addEventListener('click', () => { void cancelJob() })
  filter.addEventListener('input', () => render())

  async function resetCache() {
    try {
      await json('/api/claude-move/reset', { method: 'POST' })
      status.textContent = panelText('cacheReset')
      await refresh()
    } catch (err) {
      status.textContent = panelText('resetFailed') + String(err && err.message)
    }
  }

  async function json(url, options) {
    const res = await fetch(url, options)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return res.json()
  }

  async function refresh() {
    status.textContent = panelText('scanning')
    try {
      index = await json('/api/claude-move/index')
      disabled = false
      visibleCount = PAGE_SIZE
      status.textContent = panelText('scanned', index.projects?.length ?? 0, sessionCount(index))
      render()
    } catch (err) {
      const msg = String(err && err.message)
      if (msg === 'HTTP 404') {
        disabled = true
        status.textContent = panelText('panelDisabled')
      } else {
        status.textContent = panelText('scanFailed') + msg
      }
    }
  }

  function sessionCount(idx) {
    return (idx?.projects ?? []).reduce((n, p) => n + (p.sessions?.length ?? 0), 0)
  }

  function badge(klass, text) { return `<span class="cm-badge ${klass}">${text}</span>` }

  // 大索引分页渲染（D4）：每次最多渲染 PAGE_SIZE 行，点击「加载更多」增量追加。
  const PAGE_SIZE = 150
  let visibleCount = PAGE_SIZE

  function render() {
    const kw = filter.value.trim().toLowerCase()
    const projects = (index?.projects ?? []).filter((p) => (
      !kw || p.slug.toLowerCase().includes(kw)
      || (p.sessions ?? []).some((s) => (s.title ?? '').toLowerCase().includes(kw) || (s.sessionId ?? '').toLowerCase().includes(kw))
    ))
    const total = projects.reduce((n, p) => n + (p.sessions ?? []).length, 0)
    const parts = []
    let shown = 0
    outer: for (const p of projects) {
      const badges = []
      if (p.git?.isRepo) {
        if (typeof p.git.dirtyCount === 'number' && p.git.dirtyCount > 0) badges.push(badge('dirty', panelText('gitDirty') + p.git.dirtyCount))
        else badges.push(badge('', panelText('git') + (p.git.branch ?? '?')))
      }
      if (!p.dirExists) badges.push(badge('missing', panelText('dirMissing')))
      parts.push(`<div class="cm-proj">📁 ${esc(p.slug)}${badges.join('')}</div>`)
      for (const s of p.sessions ?? []) {
        if (shown >= visibleCount) break outer
        shown++
        const st = s.import?.status ?? 'none'
        const b = st === 'imported'
          ? badge('imported', s.import?.updatesPending ? panelText('importedNew') : panelText('imported'))
          : st === 'source-missing' ? badge('missing', panelText('sourceMissing')) : badge('', panelText('notImported'))
        parts.push(`<div class="cm-sess" data-file="${esc(s.file)}">
          <span class="t">${esc(s.title ?? s.sessionId)}</span>
          ${b} <span class="cm-badge">${panelText('messagesTools', s.messages ?? 0, s.toolCalls ?? 0)}</span>
        </div>`)
      }
    }
    if (total > shown) {
      parts.push(`<div class="cm-sess" id="cm-more">${panelText('showMore', shown, total)}</div>`)
    }
    body.innerHTML = parts.length ? parts.join('') : `<div class="cm-proj">${panelText('empty')}</div>`
    for (const el of body.querySelectorAll('.cm-sess')) {
      if (el.id === 'cm-more') {
        el.addEventListener('click', () => { visibleCount += PAGE_SIZE; render() })
      } else {
        el.addEventListener('click', () => showDetail(el.dataset.file))
      }
    }
  }

  function findSession(file) {
    for (const p of index?.projects ?? []) {
      const s = (p.sessions ?? []).find((x) => x.file === file)
      if (s) return { project: p, session: s }
    }
    return null
  }

  function showDetail(file) {
    const found = findSession(file)
    if (!found) return
    const { project, session } = found
    const when = session.lastActivity ? new Date(session.lastActivity).toLocaleString() : panelText('unknown')
    const dshId = session.import?.dshSessionId
    const canOpen = typeof sessions?.open === 'function'
    detail.style.display = 'block'
    detail.innerHTML = `
      <h4>${esc(session.title ?? session.sessionId)}</h4>
      <div class="kv">${panelText('kvSession')}${esc(session.sessionId)}</div>
      <div class="kv">${panelText('kvLastActivity')}${esc(when)} · ${panelText('messagesToolCalls', session.messages ?? 0, session.toolCalls ?? 0)}</div>
      ${dshId ? `<div class="kv">${panelText('kvDshSession')}${esc(dshId)}</div>` : ''}
      <div class="kv">${panelText('kvDir')}${esc(project.cwd ?? panelText('unknown'))}${project.dirExists ? '' : panelText('dirNotExists')}</div>
      <p style="margin-top:8px">
        <button data-act="import">${panelText('importContinue')}</button>
        ${dshId && canOpen ? `<button data-act="open" title="${panelText('openSessionTitle')}">${panelText('openSession')}</button>` : ''}
        <button data-act="reload" title="${panelText('refreshSessionsTitle')}">${panelText('refreshSessions')}</button>
      </p>`
    detail.querySelector('[data-act="import"]').addEventListener('click', () => importJob(session.file))
    const openBtn = detail.querySelector('[data-act="open"]')
    if (openBtn) openBtn.addEventListener('click', () => openSession(dshId))
    detail.querySelector('[data-act="reload"]').addEventListener('click', () => { void refreshSessions() })
  }

  /** 官方服务可用时免刷新更新会话/工作区列表；否则回退整页刷新。 */
  async function refreshSessions() {
    try {
      if (typeof sessions?.refresh === 'function') await sessions.refresh()
      if (typeof workspaces?.refresh === 'function') await workspaces.refresh()
      return
    } catch {
      // 服务异常：回退整页刷新，保证列表一定更新。
    }
    window.location.reload()
  }

  /** 官方服务可用时直接打开已导入会话。 */
  function openSession(dshId) {
    if (typeof sessions?.open === 'function') {
      sessions.open(dshId)
      return
    }
    window.location.reload()
  }

  let currentJobId = null

  async function cancelJob() {
    if (!currentJobId) return
    try {
      await json('/api/claude-move/job?job=' + encodeURIComponent(currentJobId), { method: 'DELETE' })
      status.textContent = panelText('cancelling')
    } catch (err) {
      status.textContent = panelText('cancelFailed') + String(err && err.message)
    }
  }

  async function importJob(target) {
    if (disabled) {
      status.textContent = panelText('panelDisabledImport')
      return
    }
    status.textContent = panelText('submitting')
    setBar(0)
    cancelBtn.style.display = 'none'
    currentJobId = null
    try {
      const { jobId } = await json('/api/claude-move/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(target === 'all' ? { path: 'all' } : { path: target }),
      })
      currentJobId = jobId
      cancelBtn.style.display = ''
      for (;;) {
        await sleep(700)
        const job = await json('/api/claude-move/progress?job=' + encodeURIComponent(jobId))
        const total = job.total ?? 0
        if (total > 0) setBar(((job.imported + job.alreadyImported + job.skipped + job.failed) / total) * 100)
        status.textContent = panelText('importing', job.imported, total, job.appended ?? 0, job.failed)
        if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
          if (job.status === 'done') {
            status.textContent = panelText('importDone', job.imported, job.alreadyImported, job.appended ?? 0, job.skipped, job.failed)
            setBar(100)
            await refreshSessions()
          } else if (job.status === 'cancelled') {
            status.textContent = panelText('importCancelled')
          } else {
            status.textContent = panelText('importFailed') + (job.error ?? panelText('unknownError'))
          }
          cancelBtn.style.display = 'none'
          currentJobId = null
          refresh()
          return
        }
      }
    } catch (err) {
      status.textContent = panelText('importFailed') + String(err && err.message)
    }
  }

  function setBar(pct) { bar.style.width = Math.max(0, Math.min(100, pct)) + '%' }
  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

  // 默认收起：只显示悬浮按钮，用户点击才展开抽屉（不抢占每次页面加载的注意力）。
}
