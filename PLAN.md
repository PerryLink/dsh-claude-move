# dsh-claude-move 研究结论与实施方案

> 目标：Claude Code 全量迁移 + 无缝续聊。研究三个参考插件与本机 DSH（源码 rc.5 / 发布 rc.6）公开扩展点后的实施蓝图。验收以任务书 F/S/C/N 为准。

## 二期：四合一迁移向导（CC / Codex / OpenCode / Hermes）

> 目标：把本插件升级为竞品用户迁入 DSH 的首选工具 —— detect → 预览 diff → 确认执行 → 报告一站式。
> 验收：四源各一个解析器 + 一个映射器（独立模块 + 独立测试）、`/move` 命令与工具、
> 幂等重跑（manifest 摘要跳过 + force）、冲突 diff 选择、迁移走审批、只读白名单、Schema 配置、
> 短 persona 引导文案、双语 README（支持矩阵 + 迁移对照表）、干净 profile 实测、git tag。

### 0. 研究结论（2026-08，本机 DSH 源码 + 各源官方文档）

**DSH 落点机制（当前 checkout 已验证）：**

| 落点 | 机制 | 出处 |
|---|---|---|
| 会话导入 | `sessionPersistence.create + append`（一期已用，平衡事件协议） | 一期 |
| 全局指令 | `$DSH_HOME/AGENTS.md`（用户全局指令文件，`~/.dsh/AGENTS.md` 兜底；DSH 原生加载） | packages/context/agent-instructions |
| 技能落盘 | `$DSH_HOME/skills/<name>/SKILL.md` 或扁平 `<name>.md`（YAML frontmatter 必须有非空 name+description；`.system` 跳过） | packages/skill/skill-filesystem |
| 审批 | `ctx.approval.request({agent, toolName, callId, reason, signal})` → `allowed-once|rejected|cancelled|unavailable`；仅模型回合内可用；无服务/无 turn 时 fail-closed | docs/subsystems/approval.md |
| 命令 | `ctx.commands.register`（一期已用） | 一期 |
| persona 风格 | 官方 Minimal persona：`You are a helpful software engineer assistant.`（一句角色陈述，保持短小） | apps/cli/config/agent-presets/minimal |

**四源格式：**

| 源 | 会话 | 记忆/指令 | 技能 | 钩子/命令 |
|---|---|---|---|---|
| Claude Code | `~/.claude/projects/<slug>/*.jsonl`（一期已支持） | `projects/*/memory/*.md`、全局/项目 `CLAUDE.md` | `~/.claude/skills/**`（SKILL.md frontmatter name/description） | `settings.json` hooks（无 DSH 等价 seam） |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`（`{timestamp,type,payload}`，一期 convert 已支持） | 全局/项目 `AGENTS.md`（DSH 原生读）、全局/项目 `CODEX.md`、`~/.codex/memories/` | `~/.codex/skills/<name>/SKILL.md`（`.system/` 为捆绑技能，跳过） | `~/.codex/hooks/<name>/{command.md,prompt.md}` + `config.toml [commands]` |
| OpenCode | `~/.local/share/opencode/opencode.db`（SQLite：session/message/part 表，node:sqlite 只读）或旧版 `storage/{session,message,part}/*.json` | 全局 `~/.config/opencode/AGENTS.md`（项目级 AGENTS.md DSH 原生读，无需迁移） | `~/.config/opencode/agent/*.md`、`.opencode/agent/*.md`（转换为技能） | `~/.config/opencode/command/*.md`、`.opencode/command/*.md` |
| Hermes | 无（任务范围外；`state.db` 不读） | `~/.hermes/memories/MEMORY.md` + `USER.md`（`§` 分隔条目） | `~/.hermes/skills/<category>/<name>/SKILL.md`（嵌套类别，`.hub/`、`.bundled_manifest` 跳过） | 无 |

**只读白名单（每源解析器声明）：** 永不读 `auth.json`、`state_*.sqlite`、`history.jsonl`、`log/`、`snapshot/`、`opencode/auth.json`、`.env` 等凭据/内部状态；解析器内 `readAllowed()` 守卫越界读取。

### 1. 模块架构

```
lib/sources/contract.mjs      # 契约：detection/migrationItem 形状、白名单守卫、计数工具（零依赖）
lib/sources/<source>/parser.mjs   # 一源一解析器：数据根定位 → 结构化清单（零 DSH 依赖）
lib/sources/<source>/mapper.mjs   # 一源一映射器：清单 → 迁移计划/不支持清单（零 DSH 依赖）
lib/wizard.mjs                # 纯编排（注入运行时端口）：detect → plan → preview(diff/冲突) → execute(审批) → report
lib/manifest.mjs              # move.json：幂等摘要/目标/结果，原子写 + 串行（复用 imports-store 模式）
lib/agmd-section.mjs          # $DSH_HOME/AGENTS.md 管理段（标记注释、diff、冲突检测）
lib/skill-migrate.mjs         # 技能兼容判定 + 转换（SKILL.md name+description 直拷；否则合成 frontmatter）
lib/commands-migrate.mjs      # 钩子/命令分类：纯提示词 → DSH 命令；含 shell → 不支持清单
lib/persona.mjs               # 短 persona 段落（一句角色陈述，对齐 Minimal persona）
index.mjs                     # Config 扩展 + move_detect/move_preview/move_run 工具 + /move 命令 + 工作区/审批接线
```

- 映射规则：记忆/指令文件 → `$DSH_HOME/AGENTS.md` 管理段；技能 → `$DSH_HOME/skills`（兼容直拷，否则转换）；钩子/命令 → DSH 命令或明确不支持清单；会话 → DSH 会话（只读历史 + 可继续，复制式）。
- 幂等：`move.json` 记录 `{ key, digest, target, appliedAt }`；摘要未变跳过，`force` 重应用；会话复用一期 imports.json 机制。
- 冲突：目标已存在且内容不同 → preview 输出 diff，`resolve: { key: skip|overwrite|rename|merge }` 逐项选择；默认 skip + 报告（绝不猜测）。
- 审批：执行前经 `ctx.approval`（特性探测）一次性审批；`unavailable/rejected/cancelled` 一律不写（fail-closed）；`requireApproval: false` 允许无 seam 平台显式降级。
- 会话归组：`moveWorkspaceMode: 'per-source'`（默认，`$DSH_HOME/imports/<source>`）| `'single'`（`$DSH_HOME/imports`）。

### 2. 迁移对照表（README 用）

| 源文件 | DSH 落点 | 方式 |
|---|---|---|
| CC `projects/*/*.jsonl` | 可续聊 DSH 会话（claude 工作区） | 一期全保真映射 |
| Codex `sessions/**/rollout-*.jsonl` | 可续聊 DSH 会话（codex 工作区） | 一期 convert + 标题补全 |
| OpenCode `opencode.db` / 旧版 storage JSON | 可续聊 DSH 会话（opencode 工作区） | message/part 顺序合成 |
| CC memory / Hermes `MEMORY.md`/`USER.md` / Codex `memories/` | `$DSH_HOME/AGENTS.md` 管理段 | 标记注释追加（幂等） |
| `CLAUDE.md`/`CODEX.md`/全局 `AGENTS.md` | `$DSH_HOME/AGENTS.md` 管理段 | 同上（项目级 AGENTS.md DSH 原生读，不迁移） |
| CC/Codex/Hermes `skills/**/SKILL.md` | `$DSH_HOME/skills/<kebab>/SKILL.md` | 兼容直拷（name+description）；否则合成 frontmatter 转换 |
| OpenCode `agent/*.md` | `$DSH_HOME/skills/<kebab>/SKILL.md` | 转换为技能（persona 建议一句角色陈述） |
| Codex/OpenCode 纯提示词命令 | DSH 命令（注入会话） | 迁移时动态注册 + apply 时从 manifest 重建 |
| CC settings.json hooks / Codex hooks / 含 shell 的命令 | 明确「不支持」清单 + 建议 | 报告列出，绝不静默丢弃 |

### 3. 阶段划分

- **W1 契约与共享件**：contract.mjs、agmd-section、skill-migrate、commands-migrate、persona、manifest（各带单测）。
- **W2 四源模块**：claude（复用一期 discovery/convert）/ codex / opencode（node:sqlite 只读 + 旧版 JSON 双路径）/ hermes —— 各带 parser+mapper 单测与合成 fixtures。
- **W3 向导**：wizard.mjs + 假运行时单测（幂等/force/冲突/审批拒绝零写入）。
- **W4 接线**：index.mjs Config 扩展、move_detect/move_preview/move_run 工具、/move 命令、审批/工作区端口、mock ctx 集成测试、safety 测试扩展。
- **W5 实测与发布**：dev/ 干净 profile 四源最小样例迁移冒烟；README.md + 五语同步（四源支持矩阵 + 迁移对照表）；CHANGELOG；git tag v0.3.0。

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
- **发现其 bug（我们设计时规避）**：其 `text: async () => …` 在 rc.6 不成立——已实测 rc.6 `dsh-system-prompt` 的 `PromptContext.text` 是 `string | ((ctx) => string)`（同步），assembly 实现**不 await**，async 提供者会把 `[object Promise]` 注入提示词。dsh-claude-move 一律使用**同步提供者 + 内存缓存（按 mtime 失效）**。
- 另一个差异：它用 `encodeProjectPath(process.cwd())` 猜 slug——各平台 Claude 的 slug 编码并不统一；我们**不猜**：直接从扫描到的 `projects/<slug>` 目录本身定位 memory（transcript 与 memory 同目录兄弟），零编码风险。

## 2. DSH 平台关键机制（已在本机源码 + rc.6 npm 包双重验证）

### 2.1 可用公开服务（peerDependencies 锁定 `0.1.0-rc.6`）

| 用途 | 服务 | 关键 API |
|---|---|---|
| 导入落盘 | `ctx.sessionPersistence` | `create(meta: SessionHeader)`、`append(id, events)`、`list()`、`load/inspect` |
| 工作区归组 | `ctx.workspaceRegistry` | `resolveByPath` → `create` → `workspace.attachSession(id)`（**不用 archiveSession**：复制式迁移绝不归档/隐藏任何会话） |
| 模型工具 | `ctx.tools` + `defineTool` | 参数 schema 自动校验；输出 oneOf schema |
| 人机命令 | `ctx.commands` | `register({name, description, input, handler})`；UI（ui-commands）自动发现 |
| 提示词段 | `ctx.systemPrompt` | `section({name, order, text})`、`context({name, order, text})` —— **text 同步** |
| 技能 | `ctx.skills` | `registerProvider(factory)`：异步 `list()`/`get()`；catalog 注入与加载器由 DSH 完成 |
| 面板 RPC | `ctx.webServer` | `register({kind:'exact'|'prefix', path, handler})`（host-webserver 公开 seam） |
| 续聊 | `ctx.agents` | `resume({ resumeSessionId })` |
| 文件（模型工具内） | `ctx.fs` | `resolve/stat/readText/listDir/processPath`（受会话沙箱策略约束） |

### 2.2 平台坑位（设计已规避）

1. **systemPrompt 同步**：rc.6 不 await 提供者（见 1.3）。
2. **persistence 无 delete**：复制式强制重导入 = 以新 id（`import-<src>-<n>`）另存一份完整副本，旧副本原样保留；**不归档**（归档会从全部界面隐藏会话）。只 append 不改写（S1）。
2b. **源文件持续增长**：imports.json 记录 `{ dshId, turns, events }`；重导时 turns 变多则按 turn/start 边界截取新增轮次、seq 续写同一 DSH 会话（增量同步，与运行中的 Claude Code 一致）；源文件被截断（turns 变少）报 `sourceShrunk` 并跳过。
3. **attachSession 要求 header.cwd 的 realpath 与工作区路径严格相等**（workspace.md 实测）：per-project 归组下源目录已删除的会话跳过归组（留在「未分组」），索引打「目录不存在」徽标，导入不失败。默认 `workspaceMode: 'claudecode'`（E2）改为把全部导入会话 cwd 覆写为独立目录 `claudecodeDir`（默认 `$DSH_HOME/claudecode`，插件只在此 mkdir），统一挂到标题「claudecode」的单一工作区；源项目 cwd 保真记录进 imports.json `sourceCwd`，memory/CLAUDE.md 注入按 `sourceCwdSync` 找回。
4. **SessionHeader.version** 必须等于运行构建的 `SESSION_FORMAT_VERSION`（rc.6 为 0，与 chat-import 一致）。
5. **事件纪律**：seq 连续；surface 事件 `surfaceOp:'append'`；`tool/result.sourceEventSeqs` 指向 `tool/call`；模型可见 ⟺ 落盘。
6. **命令 ≠ 模型回合**：`command/run`/`command/done` 只写日志、结果直接渲染 UI，不产生模型消息。F17 的「在当前会话以交接摘要继续」= 命令 handler 内先确保导入，再 `agent.inject({content: 摘要, source:{kind:'plugin',...}})` 把摘要注入下一次请求（inject 不是唤醒，用户随后发消息即生效）。
7. **settings.* RPC 域是白名单**，第三方 namespace 不能远程读写（S3 一致）；F14 走「报告/面板给出建议（cordis.yml patch 片段 + 权限预设建议），用户自己确认应用」，未知项显式列出。
8. **rc.6 的 `latest` dist-tag 仍是 0.0.1-rc.1**（npm 元数据实测）：peerDependencies 显式写 `0.1.0-rc.6`。
9. **client 插件协议**（F16）：包声明 `dsh.client` + `exports["./client"]` 的浏览器构建产物（调用 `window.__ModuleLoader__.load({id, factory})`）；host 端 `ctx.clientModules` 自动扫描进 `__DSH_BOOT__`。面板数据走我们自己注册的 `ctx.webServer` JSON 路由，避开 typert remote 生成。生态已有先例（`zhu1090093659/dsh-web-ui` 右侧面板、`omdsh-dev/DSH-better-sidebar` 三方 Tab），但 slot 键属 shell 内部契约，**进入 Phase 5 先做 spike**；备选：host-only（工具+命令）体验 + 文档说明。

## 3. 总体设计

### 3.1 包结构（单包 = host 插件 + 可选 client bundle）

> 落地后的实际结构（与早期规划略有出入：导入编排/命令/路由内联于 index.mjs，
> 未单独拆 import.mjs/resume.mjs/routes.mjs；新增 imports-store.mjs）。

```
dsh-claude-move/
  index.mjs             # host 入口（唯一 host 面）：工具/命令/提示词段/技能/路由/导入编排
  lib/
    convert.mjs         # vendor 自 dsh-chat-import（MIT 标注）+ 流式转换器（C3）
    discovery.mjs       # F1-F4/C1/C2/C5：扫描、增量缓存、并行扫描、gitBranch、原子写
    imports-store.mjs   # A4：imports.json 串行写 + 源文件 in-flight 锁
    frontmatter.mjs     # Claude Markdown frontmatter 解析（零依赖）
    context.mjs         # F11/F13/B3：memory/CLAUDE.md 同步注入 + memoryScope
    skills-provider.mjs # F12/B2：Claude 技能 SkillProvider（cwd/signal/项目技能）
    settings.mjs        # F14：settings.json 翻译建议
    report.mjs          # S4/S5：密钥正则、权限类统计
    handoff.mjs         # F17/D1：交接摘要（resume-plugin 安全模型）
  client/client.js      # F16：零构建浏览器面板（dsh.client，__ModuleLoader__，zh/en）
  cordis.patch.yml      # dsh.bundle：insert 行 + 默认 config
  package.json          # dsh.bundle + dsh.client + files + peerDeps(0.1.0-rc.6) + test 脚本
  test/ + test/fixtures/ # node --test：单测 + mock ctx 集成 + 三平台路径 + 畸形数据
  README.md（五语）      # 架构图、映射表、安装/使用/卸载、安全边界、复用标注、已知局限
```

### 3.2 索引模型（F2/F3/F4）

`Index { projects: [{ slug, cwd, dirExists, git:{isRepo,branch,dirty}, sessions: [{ file, sessionId, title, createdAt, lastActivity, messages, toolCalls, sizeBytes, import: {dshSessionId?, status: 'none'|'imported'|'source-missing'} }] }], personal: { globalClaudeMd, skills, memoriesByProject, settings }, stats }`
- 缓存 `<dshHome>/claude-move/index.json`（dshHome 用 `@deepseek-ai/dsh-home-paths`）；增量：按 mtime/size 比较，`scan_all`/`scan <path>` 两种入口。
- 导入状态：`sessionPersistence.list()` 一次快照（`import-*` 前缀）+ 缓存里的 `源sessionId → dshSessionId` 映射（支持强制重导入链）。
- 三平台路径：优先 `$CLAUDE_CONFIG_DIR`，Windows 回退 `%USERPROFILE%\.claude`；文件名由 NTFS 原生处理（UCS-2），内容按 UTF-8 读、失败容错降级；不用 iconv 依赖。

### 3.3 需求→机制映射（要点）

| 需求 | 机制 |
|---|---|
| F1/F2 | `discovery.mjs` 扫描 + 每行解析头部元数据（流式，`readline` 风格手写分块，避免整文件进内存） |
| F3 | `claude_scan` 工具（`defineTool`，结构化 JSON 输出）；面板展示 |
| F4 | 索引缓存 mtime/size 增量；`scan_all`/`scan <path>` 参数 |
| F5-F6 | 扩展 vendored `convert.mjs`；产出平衡事件日志 → `create+append`；点开即 resume（事件平衡 + 标题 + cwd）。**issue#1 修复**：每个 tool_use 恰好一条 tool/result（中断补合成错误结果、重复去重、孤儿丢弃），`validateSessionEvents` 自校验 |
| F7 | `list()` 判重跳过；源文件增长 → 增量续写新轮次到同一会话；`force: true` → 以 `import-<src>-<n>` 另存完整副本（复制式，绝不归档） |
| F8 | `import_claude { path: "~/.claude/projects" \| "all" \| 具体路径 }` 批量汇总 |
| F9 | meta：`id: import-<src>`、`cwd`、`createdAt`；`session/title` 钉标题；工作区归组：默认 `workspaceMode: 'claudecode'`（E2）挂到 claudecode 工作区（`claudecodeDir` 默认 `$DSH_HOME/claudecode`），`'per-project'` 按 cwd 各建工作区 |
| F10 | convert 扩展：`skippedLines: [{line, error}]`（截断上限）；批量报告逐文件 |
| F11 | `ctx.systemPrompt.context`（同步提供者+缓存；agent cwd 定位 slug；feedback>project>reference>user；默认 8KB） |
| F12 | `ctx.skills.registerProvider`：`~/.claude/skills` + `extraSkillDirs`，名称 kebab 化（冲突加后缀），`level`→排序，上限 30；catalog 注入与 `skill` 工具由 DSH 负责 |
| F13 | `ctx.systemPrompt.section`（order 负值，前置于 persona）：全局 CLAUDE.md + agent cwd 对应项目 `.claude/CLAUDE.md`（项目优先） |
| F14 | `report.mjs`：解析 settings.json（allow/deny/model）→ 生成 cordis.yml patch 建议 + 权限预设建议 + 无法映射清单；只建议不代写（S1/S3） |
| F15 | `/claude-import-all` 命令（`ctx.commands`） |
| F16 | `dsh.client` 面板 + `/api/claude-move/*`（`ctx.webServer`）；导入进度用插件内 job 状态 + 轮询 |
| F17 | `/resume-claude [latest\|id\|关键词]` 命令：未导入先导入 → `agent.inject` 交接摘要（安全模型复用） |
| F18 | 导入后 `session.list` 应可见（apiproxy 有 `host/session-added` 帧/重连基线）；面板导入完成后刷新并跳转（spike 确认跳转 API，兜底提示刷新） | ✅ 已核实（当前 harness）：导入即时落盘，服务端 `session.list`/`workspace.list` 立即可见，**无需重启 dsh**；`host/session-added` 只对 live 会话（`session/created`）发射，cold 导入不发 → 已打开的 Web 页面需刷新一次会话列表（面板「刷新会话列表」按钮/F5）；工作区分组经 `domain/changed` → `host/workspace-changed` 实时更新。README 已新增「导入之后」章节 |
| S1 | 源文件只读；只 `create`+`append`；不碰引擎/apiproxy/官方包；发布面静态审计测试（`test/safety.test.mjs`）钉住「无 rm/unlink/truncate/archiveSession，recursive 仅 mkdir/readdir/importDirectory」 |
| S2 | 不执行任何 transcript 内容；system/developer/summary/permission/progress 等记录跳过并计数；thinking 只入日志不进摘要；摘要长度截断 |
| S4 | 正则（AKIA/ghp_/sk-/BEGIN PRIVATE KEY 等）只报 `文件:行:类型` |
| S5 | `permission`/`queue-operation` 等只统计不导入，报告给迁移建议 |
| C1/C2 | 纯 ESM、无构建的 host 面（同 chat-import）；client 用 esbuild 单文件构建；peerDeps 锁 rc.6 |
| C3 | README 三种安装（`github:`/`link:`/本地路径，`dsh plugin --profile web add -w ...`）+ 卸载说明 |
| C4 | Config：`claudeHome/scanGit/gitTimeoutMs/maxTranscriptBytes/excludeProjects/enable*/maxSkills/extraSkillDirs/resumeMaxChars/enableWebPanel/importConcurrency/workspaceMode/claudecodeDir` 全可 cordis.yml 覆盖 |
| N1 | 流式解析、批量「读取+转换」并发上限（`importConcurrency` 默认 4，落盘串行保证幂等确定性）、`exec.signal` 全程可中止、`list()` 快照缓存、UI 不阻塞（面板轮询） |
| N2/N3/N4 | `node --test`；fixtures：正常/含 tool/畸形 + 三平台路径用例；README 含架构图、映射表、复用标注（三个 MIT 出处 + resume-plugin 的 Apache-2.0 传递标注） |

### 3.4 数据映射表（沿用并完善 chat-import）

| Claude Code JSONL | DSH SessionEvent |
| --- | --- |
| `{type:'user', message.content: string}` | `turn/start` + `step/start` + `user/message` |
| `{type:'assistant', content:[{type:'text'}]}` | `assistant/message`（text 块） |
| `{type:'assistant', content:[{type:'thinking'}]}` | `assistant/message` 内 `reasoning` 块 |
| `{type:'assistant', content:[{type:'tool_use'}]}` | `assistant/message` 内 `tool-call` 块 + `tool/call` 事件 |
| `{type:'user', content:[{type:'tool_result'}]}` | `tool/result`（`sourceEventSeqs`→`tool/call`，`is_error` 保留；重复去重、孤儿丢弃） |
| 被中断的 `tool_use`（无结果） | 合成一条 `tool/result`（`isError` + 标记文案），保证每个 tool_call_id 恰好一条结果（issue#1） |
| `{type:'ai-title' \| 'custom-title'}` | `session/title`（钉住） |
| `sessionId/cwd/timestamp/message.model` | `SessionHeader`（id=`import-<src>`、cwd、createdAt）+ assistant `source.model` |
| `{type:'summary'}` | 跳过（计数；未来可映射 compaction 事件） |
| `{type:'permission'/'queue-operation'/...}` | 不导入，S5 统计 |
| 畸形行 | 报告 `{line, error}`，跳过 |

## 4. 分阶段实施（每模块跑测试、按模块提交）

- **Phase 0**：脚手架 + vendor convert（MIT 标注）+ `node --test` 基线全绿。
- **Phase 1**：Discovery（F1-F4）+ `claude_scan` + 索引缓存/增量 + 测试。
- **Phase 2**：导入加固（F5-F10）：行号报错、标题兜底、复制式 force 重导入、增量续写、批量、测试。
- **Phase 3**：个人上下文（F11-F14）：memory/CLAUDE.md 同步注入、Claude 技能 provider、settings 翻译报告、测试。
- **Phase 4**：命令（F15/F17）：`claude-import-all`、`resume-claude` + 交接摘要（安全模型）+ mock 集成测试。
- **Phase 5**：F16 面板 spike（真实 rc.6 web profile 验证 slot/RPC/跳转），面板或记录 fallback。
- **Phase 6**：README/架构图/映射表/attribution、`npm pack`、三平台验证记录、演示 GIF。

## 5. 风险与备选

1. **client slot 面不稳定**（预发布）→ Phase 5 spike 先行；备选 host-only + 面板降级为「扫描/导入按钮式命令 + 会话列表刷新」。
2. **`host/session-added` 是否覆盖 cold 导入** → spike 验证；兜底面板导入后显式刷新 `session.list`。
3. **大 transcript 内存** → 流式读行 + 分批 `append`（每会话一次批即可，seq 连续）；批量并发上限（默认 4）。
4. **权限策略**：模型驱动的 `claude_scan/import_claude` 走 `ctx.fs`（受 DSH 沙箱策略约束）；用户驱动的命令/面板走 host 侧 node:fs（用户明示操作自身数据）。
