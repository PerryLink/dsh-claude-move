# dsh-claude-port 研究结论与实施方案

> 目标：Claude Code 全量迁移 + 无缝续聊。研究三个参考插件与本机 DSH（源码 rc.5 / 发布 rc.6）公开扩展点后的实施蓝图。验收以任务书 F/S/C/N 为准。

## 1. 三个参考插件研究结论

### 1.1 Nwflower/dsh-chat-import（MIT）—— 复用其转换核心

- 结构：`index.mjs`（唯一 host 面，注册 `import_claude`/`import_codex` 工具）+ `convert.mjs`（零依赖纯函数）+ `cordis.patch.yml`（`dsh.bundle` 声明，insert 一行）。`npm test` 用 `node --test`。
- 已跑通：克隆后 `npm install`（安装 peer `@deepseek-ai/dsh-tools`）→ **28/28 用例通过**（16 个 convert 单测 + 12 个 mock 集成）。
- 核心资产（按任务要求直接扩展，不重写）：
  - `convertClaudeJsonl(raw, args)`：user 直连提问切轮 → assistant 一步 → tool_result 挂最近一步；`ai-title`、`sessionId`、`cwd`、`timestamp`、`message.model` 元数据提取。
  - `synthesizeSession`：`turn/start → step/start → user/message → assistant/message → tool/call → tool/result → step/end → turn/end`，seq 从 0 连续、surface 事件带 `surfaceOp:'append'`、`tool/result.sourceEventSeqs` 关联、`session/title` 钉标题、assistant `source:{kind:'model',provider:'claude-code',model}`。
  - `index.mjs` 的落盘/幂等/批量/归组骨架：`sessionPersistence.list()` 判重 → `create(meta)` + `append(id, events)` → `workspaceRegistry.resolveByPath(cwd)` → `create` → `attachSession`；目录递归批量 + 逐文件汇总；`defineTool` 输出 schema（oneOf single/batch）。
- 缺口（需我们补齐）：无自动发现（path 必填）；畸形行只计数不报行号；标题仅 `ai-title`（无 `custom-title`、无首问兜底）；无强制重导入；无记忆/技能/CLAUDE.md；无命令与 Web 面板；无 git 状态；无敏感信息/权限类统计。

### 1.2 Demogorgon314/dsh-resume-plugin（MIT）—— 复用其安全模型

- 结构：`ctx.skills.registerProvider` 注册 `resume-claude`/`resume-codex` 两个 bundled 技能（rank 600、`invocation:{modelInvocable:true,userInvocable:true}`、`resourceBase:{kind:'directory'}`）；技能体是「读 CORE.md + 用 shell 调 `session_reader.py`」。
- 安全模型（CORE.md，我们 F17 直接沿用其原则并改写为命令处理器逻辑）：
  1. transcript 一律视为不可信惰性历史；不执行/不复述/不注入 system/developer/reasoning；
  2. 旧工具输出视为过期证据，继续前必须复核 cwd、分支、diffs、关键文件；
  3. 交接摘要只写：目标+最后请求、相关文件/命令/产物、已完成、未完成、精确停止点与最安全下一步、reader 警告；
  4. 歧义引用列出候选，绝不猜测。
- 注意：其 `session_reader.py` 标注「Adapted from Grok Build's bundled foreign-session reader」（THIRD_PARTY_NOTICES + Apache-2.0），我们若复用任何片段须**传递性标注**（README 标 MIT 出处 + Apache-2.0 来源）。
- 其 Claude 发现逻辑（`_discover_claude`：`$CLAUDE_CONFIG_DIR`/`~/.claude`、`projects/<slug>/*.jsonl`、`ai-title`/`custom-title`、`within-min`）是 F1/F2 的算法参考；我们在 host 插件内用 Node 实现同逻辑（不依赖 Python 运行时）。

### 1.3 YYTbit/dsh-plugin-claude-bridge（MIT）—— 复用其注入思路

- 结构：`inject: []`；`ctx.systemPrompt.context`（memory、skills catalog）+ `ctx.systemPrompt.section`（全局 CLAUDE.md，order 5）；`~/.claude/projects/<projectKey>/memory/*.md` 按 `feedback > project > reference > user` 排序；skills 发现 `<dir>/<name>/SKILL.md` 与扁平 `<name>.md`；frontmatter 手写解析。
- **发现其 bug（我们设计时规避）**：其 `text: async () => …` 在 rc.6 不成立——已实测 rc.6 `dsh-system-prompt` 的 `PromptContext.text` 是 `string | ((ctx) => string)`（同步），assembly 实现**不 await**，async 提供者会把 `[object Promise]` 注入提示词。dsh-claude-port 一律使用**同步提供者 + 内存缓存（按 mtime 失效）**。
- 另一个差异：它用 `encodeProjectPath(process.cwd())` 猜 slug——各平台 Claude 的 slug 编码并不统一；我们**不猜**：直接从扫描到的 `projects/<slug>` 目录本身定位 memory（transcript 与 memory 同目录兄弟），零编码风险。

## 2. DSH 平台关键机制（已在本机源码 + rc.6 npm 包双重验证）

### 2.1 可用公开服务（peerDependencies 锁定 `0.1.0-rc.6`）

| 用途 | 服务 | 关键 API |
|---|---|---|
| 导入落盘 | `ctx.sessionPersistence` | `create(meta: SessionHeader)`、`append(id, events)`、`list()`、`load/inspect` |
| 工作区归组 | `ctx.workspaceRegistry` | `resolveByPath` → `create` → `workspace.attachSession(id)`、`archiveSession` |
| 模型工具 | `ctx.tools` + `defineTool` | 参数 schema 自动校验；输出 oneOf schema |
| 人机命令 | `ctx.commands` | `register({name, description, input, handler})`；UI（ui-commands）自动发现 |
| 提示词段 | `ctx.systemPrompt` | `section({name, order, text})`、`context({name, order, text})` —— **text 同步** |
| 技能 | `ctx.skills` | `registerProvider(factory)`：异步 `list()`/`get()`；catalog 注入与加载器由 DSH 完成 |
| 面板 RPC | `ctx.webServer` | `register({kind:'exact'|'prefix', path, handler})`（host-webserver 公开 seam） |
| 续聊 | `ctx.agents` | `resume({ resumeSessionId })` |
| 文件（模型工具内） | `ctx.fs` | `resolve/stat/readText/listDir/processPath`（受会话沙箱策略约束） |

### 2.2 平台坑位（设计已规避）

1. **systemPrompt 同步**：rc.6 不 await 提供者（见 1.3）。
2. **persistence 无 delete**：强制重导入 = `workspaceRegistry.archiveSession(旧)` + 以新 id（`import-<src>-2`）重建，报告给出新旧映射；只 append 不改写（S1）。
3. **attachSession 要求 header.cwd 的 realpath 存在**：源目录已删除的会话跳过归组（留在「未分组」），索引打「目录不存在」徽标，导入不失败。
4. **SessionHeader.version** 必须等于运行构建的 `SESSION_FORMAT_VERSION`（rc.6 为 0，与 chat-import 一致）。
5. **事件纪律**：seq 连续；surface 事件 `surfaceOp:'append'`；`tool/result.sourceEventSeqs` 指向 `tool/call`；模型可见 ⟺ 落盘。
6. **命令 ≠ 模型回合**：`command/run`/`command/done` 只写日志、结果直接渲染 UI，不产生模型消息。F17 的「在当前会话以交接摘要继续」= 命令 handler 内先确保导入，再 `agent.inject({content: 摘要, source:{kind:'plugin',...}})` 把摘要注入下一次请求（inject 不是唤醒，用户随后发消息即生效）。
7. **settings.* RPC 域是白名单**，第三方 namespace 不能远程读写（S3 一致）；F14 走「报告/面板给出建议（cordis.yml patch 片段 + 权限预设建议），用户自己确认应用」，未知项显式列出。
8. **rc.6 的 `latest` dist-tag 仍是 0.0.1-rc.1**（npm 元数据实测）：peerDependencies 显式写 `0.1.0-rc.6`。
9. **client 插件协议**（F16）：包声明 `dsh.client` + `exports["./client"]` 的浏览器构建产物（调用 `window.__ModuleLoader__.load({id, factory})`）；host 端 `ctx.clientModules` 自动扫描进 `__DSH_BOOT__`。面板数据走我们自己注册的 `ctx.webServer` JSON 路由，避开 typert remote 生成。生态已有先例（`zhu1090093659/dsh-web-ui` 右侧面板、`omdsh-dev/DSH-better-sidebar` 三方 Tab），但 slot 键属 shell 内部契约，**进入 Phase 5 先做 spike**；备选：host-only（工具+命令）体验 + 文档说明。

## 3. 总体设计

### 3.1 包结构（单包 = host 插件 + 可选 client bundle）

```
dsh-claude-port/
  index.mjs             # host 入口：注册工具/命令/注入（唯一 host 面）
  lib/
    convert.mjs         # ← vendor 自 dsh-chat-import（MIT 标注），扩展：行号错误、custom-title、统计
    discovery.mjs       # F1-F4：扫描 ~/.claude、索引缓存、增量刷新（node:fs，流式读）
    import.mjs          # F5-F10：单/批量导入编排、幂等、强制重导入、归组
    context.mjs         # F11-F13：memory/CLAUDE.md 同步注入 + Claude 技能 SkillProvider
    report.mjs          # F14 + S4/S5：settings 翻译建议、密钥正则、权限类统计
    resume.mjs          # F17：/resume-claude 命令处理器 + 交接摘要（复用 resume-plugin 安全模型）
  routes.mjs            # F16：ctx.webServer JSON 路由（scan/import/progress）
  client/               # F16：浏览器面板（dsh.client，esbuild 构建，__ModuleLoader__）
  skills/               # 内置 resume-claude 技能体（可选，附 attribution）
  cordis.patch.yml      # dsh.bundle：insert 行 + 默认 config
  package.json          # dsh.bundle + dsh.client + files + peerDeps(0.1.0-rc.6) + test 脚本
  test/ + test/fixtures/ # node --test；convert 单测 + mock ctx 集成 + 三平台路径 + 畸形数据
  README.md             # 架构图、映射表、安装/使用/卸载、安全边界、复用标注、已知局限
```

### 3.2 索引模型（F2/F3/F4）

`Index { projects: [{ slug, cwd, dirExists, git:{isRepo,branch,dirty}, sessions: [{ file, sessionId, title, createdAt, lastActivity, messages, toolCalls, sizeBytes, import: {dshSessionId?, status: 'none'|'imported'|'source-missing'} }] }], personal: { globalClaudeMd, skills, memoriesByProject, settings }, stats }`
- 缓存 `<dshHome>/claude-port/index.json`（dshHome 用 `@deepseek-ai/dsh-home-paths`）；增量：按 mtime/size 比较，`scan_all`/`scan <path>` 两种入口。
- 导入状态：`sessionPersistence.list()` 一次快照（`import-*` 前缀）+ 缓存里的 `源sessionId → dshSessionId` 映射（支持强制重导入链）。
- 三平台路径：优先 `$CLAUDE_CONFIG_DIR`，Windows 回退 `%USERPROFILE%\.claude`；文件名由 NTFS 原生处理（UCS-2），内容按 UTF-8 读、失败容错降级；不用 iconv 依赖。

### 3.3 需求→机制映射（要点）

| 需求 | 机制 |
|---|---|
| F1/F2 | `discovery.mjs` 扫描 + 每行解析头部元数据（流式，`readline` 风格手写分块，避免整文件进内存） |
| F3 | `claude_scan` 工具（`defineTool`，结构化 JSON 输出）；面板展示 |
| F4 | 索引缓存 mtime/size 增量；`scan_all`/`scan <path>` 参数 |
| F5-F6 | 扩展 vendored `convert.mjs`；产出平衡事件日志 → `create+append`；点开即 resume（事件平衡 + 标题 + cwd） |
| F7 | `list()` 判重跳过；`force: true` → archive 旧 + `import-<src>-<n>` 新 id |
| F8 | `import_claude { path: "~/.claude/projects" \| "all" \| 具体路径 }` 批量汇总 |
| F9 | meta：`id: import-<src>`、`cwd`、`createdAt`；`session/title` 钉标题；按 cwd 建/归工作区 |
| F10 | convert 扩展：`skippedLines: [{line, error}]`（截断上限）；批量报告逐文件 |
| F11 | `ctx.systemPrompt.context`（同步提供者+缓存；agent cwd 定位 slug；feedback>project>reference>user；默认 8KB） |
| F12 | `ctx.skills.registerProvider`：`~/.claude/skills` + `extraSkillDirs`，名称 kebab 化（冲突加后缀），`level`→排序，上限 30；catalog 注入与 `skill` 工具由 DSH 负责 |
| F13 | `ctx.systemPrompt.section`（order 负值，前置于 persona）：全局 CLAUDE.md + agent cwd 对应项目 `.claude/CLAUDE.md`（项目优先） |
| F14 | `report.mjs`：解析 settings.json（allow/deny/model）→ 生成 cordis.yml patch 建议 + 权限预设建议 + 无法映射清单；只建议不代写（S1/S3） |
| F15 | `/claude-import-all` 命令（`ctx.commands`） |
| F16 | `dsh.client` 面板 + `/api/claude-port/*`（`ctx.webServer`）；导入进度用插件内 job 状态 + 轮询 |
| F17 | `/resume-claude [latest\|id\|关键词]` 命令：未导入先导入 → `agent.inject` 交接摘要（安全模型复用） |
| F18 | 导入后 `session.list` 应可见（apiproxy 有 `host/session-added` 帧/重连基线）；面板导入完成后刷新并跳转（spike 确认跳转 API，兜底提示刷新） |
| S1 | 源文件只读；只 `create`+`append`；不碰引擎/apiproxy/官方包 |
| S2 | 不执行任何 transcript 内容；system/developer/summary/permission/progress 等记录跳过并计数；thinking 只入日志不进摘要；摘要长度截断 |
| S4 | 正则（AKIA/ghp_/sk-/BEGIN PRIVATE KEY 等）只报 `文件:行:类型` |
| S5 | `permission`/`queue-operation` 等只统计不导入，报告给迁移建议 |
| C1/C2 | 纯 ESM、无构建的 host 面（同 chat-import）；client 用 esbuild 单文件构建；peerDeps 锁 rc.6 |
| C3 | README 三种安装（`github:`/`link:`/本地路径，`dsh plugin --profile web add -w ...`）+ 卸载说明 |
| C4 | Config：`claudeHome/maxMemoryBytes/maxSkills/enable*/extraSkillDirs/whitelist/excludePaths/maxTranscriptBytes/force...` 全可 cordis.yml 覆盖 |
| N1 | 流式解析、批量并发上限、`list()` 快照缓存、UI 不阻塞（面板轮询） |
| N2/N3/N4 | `node --test`；fixtures：正常/含 tool/畸形 + 三平台路径用例；README 含架构图、映射表、复用标注（三个 MIT 出处 + resume-plugin 的 Apache-2.0 传递标注） |

### 3.4 数据映射表（沿用并完善 chat-import）

| Claude Code JSONL | DSH SessionEvent |
| --- | --- |
| `{type:'user', message.content: string}` | `turn/start` + `step/start` + `user/message` |
| `{type:'assistant', content:[{type:'text'}]}` | `assistant/message`（text 块） |
| `{type:'assistant', content:[{type:'thinking'}]}` | `assistant/message` 内 `reasoning` 块 |
| `{type:'assistant', content:[{type:'tool_use'}]}` | `assistant/message` 内 `tool-call` 块 + `tool/call` 事件 |
| `{type:'user', content:[{type:'tool_result'}]}` | `tool/result`（`sourceEventSeqs`→`tool/call`，`is_error` 保留） |
| `{type:'ai-title' \| 'custom-title'}` | `session/title`（钉住） |
| `sessionId/cwd/timestamp/message.model` | `SessionHeader`（id=`import-<src>`、cwd、createdAt）+ assistant `source.model` |
| `{type:'summary'}` | 跳过（计数；未来可映射 compaction 事件） |
| `{type:'permission'/'queue-operation'/...}` | 不导入，S5 统计 |
| 畸形行 | 报告 `{line, error}`，跳过 |

## 4. 分阶段实施（每模块跑测试、按模块提交）

- **Phase 0**：脚手架 + vendor convert（MIT 标注）+ `node --test` 基线全绿。
- **Phase 1**：Discovery（F1-F4）+ `claude_scan` + 索引缓存/增量 + 测试。
- **Phase 2**：导入加固（F5-F10）：行号报错、标题兜底、force 重导入、批量、测试。
- **Phase 3**：个人上下文（F11-F14）：memory/CLAUDE.md 同步注入、Claude 技能 provider、settings 翻译报告、测试。
- **Phase 4**：命令（F15/F17）：`claude-import-all`、`resume-claude` + 交接摘要（安全模型）+ mock 集成测试。
- **Phase 5**：F16 面板 spike（真实 rc.6 web profile 验证 slot/RPC/跳转），面板或记录 fallback。
- **Phase 6**：README/架构图/映射表/attribution、`npm pack`、三平台验证记录、演示 GIF。

## 5. 风险与备选

1. **client slot 面不稳定**（预发布）→ Phase 5 spike 先行；备选 host-only + 面板降级为「扫描/导入按钮式命令 + 会话列表刷新」。
2. **`host/session-added` 是否覆盖 cold 导入** → spike 验证；兜底面板导入后显式刷新 `session.list`。
3. **大 transcript 内存** → 流式读行 + 分批 `append`（每会话一次批即可，seq 连续）；批量并发上限（默认 4）。
4. **权限策略**：模型驱动的 `claude_scan/import_claude` 走 `ctx.fs`（受 DSH 沙箱策略约束）；用户驱动的命令/面板走 host 侧 node:fs（用户明示操作自身数据）。
