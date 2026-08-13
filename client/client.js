// SPDX-License-Identifier: Apache-2.0
// client/client.js — dsh-claude-move 浏览器迁移面板（F16）。
//
// 零依赖 vanilla 面板：host 端 dsh.client 扫描把本文件作为 classic script
// 注入 __DSH_BOOT__ 图，执行时经 window.__ModuleLoader__.load 注册工厂；
// 工厂闭包在首次 materialize 时运行，apply 挂载浮层面板（无注入服务，
// 只依赖 DOM + 本插件自注册的 /api/claude-move/* JSON 路由）。
// 面板自身不产生任何模型可见内容。

(function () {
  'use strict'
  if (typeof window === 'undefined' || !window.__ModuleLoader__ || !window.__ModuleLoader__.load) return
  window.__ModuleLoader__.load({
    id: 'dsh-claude-move',
    factory: function () {
      return {
        name: 'claude-move-panel',
        inject: [],
        apply: function () { installPanel() },
      }
    },
  })
})()

function installPanel() {
  if (document.getElementById('claude-move-panel')) return

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
  openBtn.textContent = '🐳 Claude 迁移'

  const root = document.createElement('div')
  root.id = 'claude-move-panel'
  const drawer = document.createElement('div')
  drawer.id = 'cm-drawer'
  drawer.style.display = 'none'
  drawer.innerHTML = `
    <div id="cm-head"><b>Claude Code 迁移</b>
      <button id="cm-refresh" title="重新扫描">刷新</button>
      <button id="cm-close" title="关闭">✕</button>
    </div>
    <input id="cm-filter" placeholder="关键词过滤（标题/会话）…" />
    <div id="cm-body"></div>
    <div id="cm-detail" style="display:none"></div>
    <div id="cm-foot">
      <button id="cm-import-all">批量导入全部</button>
      <div id="cm-progress"><i></i></div>
      <span id="cm-status"></span>
    </div>`

  document.head.appendChild(style)
  root.appendChild(drawer)
  document.body.appendChild(openBtn)
  document.body.appendChild(root)

  let index = null
  const body = drawer.querySelector('#cm-body')
  const detail = drawer.querySelector('#cm-detail')
  const filter = drawer.querySelector('#cm-filter')
  const status = drawer.querySelector('#cm-status')
  const bar = drawer.querySelector('#cm-progress i')

  const show = (open) => { drawer.style.display = open ? 'flex' : 'none'; if (open) refresh() }
  openBtn.addEventListener('click', () => show(drawer.style.display === 'none'))
  drawer.querySelector('#cm-close').addEventListener('click', () => show(false))
  drawer.querySelector('#cm-refresh').addEventListener('click', () => refresh())
  drawer.querySelector('#cm-import-all').addEventListener('click', () => importJob('all'))
  filter.addEventListener('input', () => render())

  async function json(url, options) {
    const res = await fetch(url, options)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return res.json()
  }

  async function refresh() {
    status.textContent = '扫描中…'
    try {
      index = await json('/api/claude-move/index')
      status.textContent = `已扫描：${index.projects?.length ?? 0} 个项目 / ${sessionCount(index)} 个会话`
      render()
    } catch (err) {
      status.textContent = '扫描失败：' + String(err && err.message)
    }
  }

  function sessionCount(idx) {
    return (idx?.projects ?? []).reduce((n, p) => n + (p.sessions?.length ?? 0), 0)
  }

  function badge(klass, text) { return `<span class="cm-badge ${klass}">${text}</span>` }

  function render() {
    const kw = filter.value.trim().toLowerCase()
    const projects = (index?.projects ?? []).filter((p) => (
      !kw || p.slug.toLowerCase().includes(kw)
      || (p.sessions ?? []).some((s) => (s.title ?? '').toLowerCase().includes(kw) || (s.sessionId ?? '').toLowerCase().includes(kw))
    ))
    const parts = []
    for (const p of projects) {
      const badges = []
      if (p.git?.isRepo) {
        if (typeof p.git.dirtyCount === 'number' && p.git.dirtyCount > 0) badges.push(badge('dirty', 'git 脏 ' + p.git.dirtyCount))
        else badges.push(badge('', 'git ' + (p.git.branch ?? '?')))
      }
      if (!p.dirExists) badges.push(badge('missing', '目录不存在'))
      parts.push(`<div class="cm-proj">📁 ${esc(p.slug)}${badges.join('')}</div>`)
      for (const s of p.sessions ?? []) {
        const st = s.import?.status ?? 'none'
        const b = st === 'imported'
          ? badge('imported', '已导入')
          : st === 'source-missing' ? badge('missing', '源缺失') : badge('', '未导入')
        parts.push(`<div class="cm-sess" data-file="${esc(s.file)}">
          <span class="t">${esc(s.title ?? s.sessionId)}</span>
          ${b} <span class="cm-badge">${s.messages ?? 0} 消息 · ${s.toolCalls ?? 0} 工具</span>
        </div>`)
      }
    }
    body.innerHTML = parts.length ? parts.join('') : '<div class="cm-proj">（无数据，点「刷新」重新扫描）</div>'
    for (const el of body.querySelectorAll('.cm-sess')) {
      el.addEventListener('click', () => showDetail(el.dataset.file))
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
    const when = session.lastActivity ? new Date(session.lastActivity).toLocaleString() : '未知'
    detail.style.display = 'block'
    detail.innerHTML = `
      <h4>${esc(session.title ?? session.sessionId)}</h4>
      <div class="kv">会话：${esc(session.sessionId)}</div>
      <div class="kv">最近活动：${esc(when)} · ${session.messages ?? 0} 消息 · ${session.toolCalls ?? 0} 工具调用</div>
      ${session.import?.dshSessionId ? `<div class="kv">DSH 会话：${esc(session.import.dshSessionId)}</div>` : ''}
      <div class="kv">目录：${esc(project.cwd ?? '（未知）')}${project.dirExists ? '' : '（不存在）'}</div>
      <p style="margin-top:8px">
        <button data-act="import">导入并继续</button>
        <button data-act="reload" title="导入后刷新会话列表以点开续聊">刷新会话列表</button>
      </p>`
    detail.querySelector('[data-act="import"]').addEventListener('click', () => importJob(session.file))
    detail.querySelector('[data-act="reload"]').addEventListener('click', () => window.location.reload())
  }

  async function importJob(target) {
    status.textContent = '提交导入…'
    setBar(0)
    try {
      const { jobId } = await json('/api/claude-move/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(target === 'all' ? { path: 'all' } : { path: target }),
      })
      for (;;) {
        await sleep(700)
        const job = await json('/api/claude-move/progress?job=' + encodeURIComponent(jobId))
        const total = job.total ?? 0
        if (total > 0) setBar(((job.imported + job.alreadyImported + job.skipped + job.failed) / total) * 100)
        status.textContent = `导入中：${job.imported}/${total} 新增，${job.appended ?? 0} 追加，${job.failed} 失败`
        if (job.status === 'done' || job.status === 'error') {
          status.textContent = job.status === 'done'
            ? `导入完成：新增 ${job.imported}、已存在 ${job.alreadyImported}、追加 ${job.appended ?? 0}、跳过 ${job.skipped}、失败 ${job.failed}。无需重启 dsh：刷新页面或点击会话详情中的「刷新会话列表」后，即可在会话列表中打开续聊。`
            : '导入失败：' + (job.error ?? '未知错误')
          if (job.status === 'done') setBar(100)
          refresh()
          return
        }
      }
    } catch (err) {
      status.textContent = '导入失败：' + String(err && err.message)
    }
  }

  function setBar(pct) { bar.style.width = Math.max(0, Math.min(100, pct)) + '%' }
  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
  function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  show(true)
}
