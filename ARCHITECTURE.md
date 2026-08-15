# ARCHITECTURE.md — dsh-claude-move 架构

## 总览

```mermaid
flowchart LR
  subgraph Claude[Claude Code 数据（只读）]
    T[projects/*/**.jsonl]
    M[projects/*/memory/*.md]
    S[skills/**/SKILL.md]
    C[CLAUDE.md + settings.json]
  end

  subgraph DSH[DeepSeek Harness（公开服务）]
    tools[ctx.tools] --> scan_t[claude_scan]
    tools --> import_t[import_claude]
    sp[(sessionPersistence)] --> import_t
    ws[workspaceRegistry] --> import_t
    sprompt[systemPrompt] --> ctx_mem[claude-move:memory 段]
    sprompt --> ctx_md[claude-move:instructions 段]
    skills[ctx.skills] --> skp[Claude SkillProvider]
    cmds[ctx.commands] --> c1[/claude-import-all/]
    cmds --> c2[/resume-claude/]
    cmds --> c3[/claude-move-reset/]
    web[ctx.webServer] --> r1[/api/claude-move/index/]
    web --> r2[/api/claude-move/import/]
    web --> r3[/api/claude-move/progress/]
    web --> r4[/api/claude-move/job/]
    web --> r5[/api/claude-move/reset/]
  end

  B[浏览器面板<br/>dsh.client 客户端插件] --> r1
  B --> r2
  B --> r3
  B --> r4
  B --> r5

  T --> scan_t
  T --> import_t
  M --> ctx_mem
  C --> ctx_md
  S --> skp
  T --> c2
  T --> c1
```

- **host 插件**（`index.mjs`）：注册两个工具、两组提示词段、一个技能 provider、三个命令、五个面板路由。只消费公开服务，不发布服务，不改引擎。
- **lib/**（零 DSH 依赖）：`convert`（JSONL→事件 + 流式转换器）、`discovery`（并行扫描+增量缓存+原子写）、`imports-store`（串行写+in-flight 锁）、`frontmatter`、`context`（同步注入 + memoryScope）、`skills-provider`（cwd/signal/项目技能）、`settings`（翻译建议）、`report`（S4/S5）、`handoff`（交接摘要）。
- **client/**（零构建 vanilla）：`__ModuleLoader__.load` 注册的面板，只依赖 DOM + 自注册 JSON 路由。
- **缓存**（`$DSH_HOME/claude-move/`）：`index.json`（扫描书签 mtime+ctime+size）、`imports.json`（**源文件路径 → 导入记录** `{ dshId, turns, events, sizeBytes, mtimeMs, sourceCwd }`，幂等 + 增量续写 + 源 cwd 保真共用）。

## 数据映射表（Claude JSONL → DSH SessionEvent）

| Claude Code JSONL | DSH SessionEvent | 备注 |
| --- | --- | --- |
| `{type:'user', message.content: string}`（直连提问） | `turn/start` + `step/start` + `user/message` | 每个提问开新轮 |
| `{type:'assistant', content:[{type:'text'}]}` | `assistant/message`（text 块） | 一条 assistant = 一步 |
| `{type:'assistant', content:[{type:'thinking'}]}` | `assistant/message` 内 `reasoning` 块 | 只进日志，不进续聊摘要 |
| `{type:'assistant', content:[{type:'tool_use'}]}` | `assistant/message` 内 `tool-call` 块 + `tool/call` 事件 | 参数 JSON 化 |
| `{type:'user', content:[{type:'tool_result'}]}` | `tool/result`（`sourceEventSeqs` → `tool/call`，`is_error` 保留） | 挂最近一步；重复结果去重、孤儿结果丢弃 |
| 被中断的 `tool_use`（无对应 `tool_result`） | 合成一条 `tool/result`（`isError: true`，标记文案） | 保证每个 tool_call_id 恰好一条结果（issue#1） |
| `{type:'custom-title'/'ai-title'}` | `session/title`（钉住，不被自动标题覆盖） | custom-title 优先 |
| `sessionId` / `cwd` / `timestamp` / `message.model` | `SessionHeader`（`id: import-<src>`、cwd、createdAt）+ assistant `source.model` | 源 id 缺失时用文件名 slug |
| `{type:'summary'}` 等辅助记录 | 跳过（typeCounts 计数） | 未知类型宽容跳过 |
| `permission` / `permission-mode` / `queue-operation` | 不导入，S5 只统计 | 报告给权限迁移建议 |
| 畸形行 | 跳过，`skippedLines: [{line, error}]` 行号上报 | 上限 200 条明细 |

事件纪律：seq 从 0 连续；surface 事件 `surfaceOp:'append'`；`tool/result.sourceEventSeqs` 关联；只 `create`+`append`（append-only）。

## 关键设计决策

1. **幂等键 = 源文件路径**（imports.json）：多个源文件可能共享同一源 sessionId（真实数据实测），按 sessionId 去重会静默丢历史；路径键 + 目标 id 冲突后缀避让（`import-<src>-<n>`）。
2. **可选服务响应式注册**（`internal/service`）：systemPrompt/skills/commands/webServer 可能晚于本插件就绪；apply 缺失则等事件，headless 无该服务也不 PENDING。
3. **未声明服务一律 `ctx.get()`**：真实 Cordis 对未声明属性访问抛错（"cannot get property without inject"）。
4. **rc.6 systemPrompt 同步约束**：memory/CLAUDE.md 段用 `statSync/readFileSync` + mtime/ctime 缓存（组装不 await async 提供者，实测确认）。
5. **面板零构建**：不依赖 rc.6 未文档化的 UI slot 内部面；数据走插件自注册的 `ctx.webServer` 精确路由（默认 loopback 绑定，与 apiproxy 同信任模型）。
6. **强制重导入（复制式）**：persistence 无 delete，且归档会把会话从全部界面隐藏——与「复制式迁移」冲突。`force: true` 改为以新 id（`import-<src>-<n>`）另存一份完整副本，旧副本原样保留；绝不归档、绝不删除。
7. **增量续写**：imports.json 记录已导入轮次与事件数；源文件增长后重导，用 `tailSessionEvents` 按 turn/start 边界截取新增轮次、seq 续写，同一 DSH 会话只 append 新事件（与运行中的 Claude Code 保持同步）。
8. **复制式迁移边界**：源文件只读、DSH 会话只 create+append、绝不调用 archiveSession/任何删除面；测试用「源文件内容前后不变」断言钉住该边界。
9. **导入后无需重启**（已对当前 harness 实测）：导入经 `sessionPersistence` 即时落盘，服务端 `session.list`/`workspace.list` 立即可见；但 UI 的 `host/session-added` 帧只对 live 会话（`session/created`）发射，cold 导入不发 → 已打开的 Web 页面需刷新一次会话列表（面板「刷新会话列表」按钮 / F5）；工作区分组经 `domain/changed` → `host/workspace-changed` 实时更新。面板与 `/claude-import-all` 报告都明示这一点。
10. **工具契约（exec.signal + 两阶段批量）**：`claude_scan`/`import_claude` 的 execute 签名 `(args, exec)`，全程检查 `exec.signal`（流式扫描逐行、批量并发阶段与落盘阶段每文件），中止抛 `signal.reason`；批量导入分两阶段——并发「读取+转换」（`importConcurrency` 默认 4，IO/CPU 密集、幂等无关），按文件名序**串行落盘**（id 后缀避让与 imports.json 映射依赖顺序，保证确定性）。`gitTimeoutMs` 配置化，消除硬编码可调参数。
11. **claudecode 工作区（默认，E2）**：`workspaceRegistry.attachSession` 要求 `realpath(header.cwd)` 与工作区路径严格相等，因此默认 `workspaceMode: 'claudecode'` 把全部导入会话的 cwd 覆写为独立目录 `claudecodeDir`（默认 `$DSH_HOME/claudecode`，插件在该目录下 `mkdir`——迁移唯一的有意写入），全部会话挂到标题「claudecode」的单一工作区；`workspaceMode: 'per-project'` 恢复按源项目 cwd 各建工作区的旧行为。源项目 cwd 保真记录进 imports.json 的 `sourceCwd`，memory/CLAUDE.md 注入按 `imports.json → index.json` 同步找回（`sourceCwdSync`，mtime 缓存），续聊交接摘要显式标注源项目目录。
12. **工具调用平衡修复（issue#1）**：OpenAI 兼容协议要求助手消息里每个 tool_call_id 恰好跟一条 tool 消息。合成期保证：每个声明的 tool/call 恰好一条 tool/result（真实结果去重取首条、被中断的调用补合成错误结果、孤儿结果丢弃），`validateSessionEvents` 自校验 + 测试钉住该不变式；否则导入会话续聊会永久 400。
13. **技能候选硬性契约（issue#1）**：DSH 技能系统对空 description 直接抛错并使技能目录整体加载失败。技能发现排除 README.md/MEMORY.md，缺失或空白 name/description 的技能文件跳过（与官方 skill-filesystem 的 warn+ignore 一致），绝不产出非法候选。

## 兼容与验证

- 目标：`dsh 0.1.0-rc.6`（web profile）；peerDeps 显式锁 rc.6；纯 ESM 无构建（git/npm/tarball 三种安装均免 `prepare`/`allowBuilds`）。
- 已验证（本机真实数据 + 隔离 DSH_HOME）：`--dump-config` 行生效、web 启动无 FAILED、`__DSH_BOOT__` 客户端条目、`client.js` 伺服、index 路由扫描 40 项目/2387 会话、批量导入 13/13（同源 id 冲突后缀避让）、重导入 13/13 幂等、`workspace.attached=true`、会话产物落盘、重扫标注 `imported`。
- 已对当前 harness checkout 重新验证（隔离 DSH_HOME，真实 JSONL+zstd 后端 + workspaceRegistry + 完整 web 启动）：全量导入、claudecode 工作区挂接、增量续写（seq 连续、load 正常）、重启后幂等、既有会话全程不受影响。
- 待有 API key 的机器验收：导入后「点开续聊」的模型回合（详见 RELEASE.md 验收清单）。
