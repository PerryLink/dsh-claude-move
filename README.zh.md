# dsh-claude-move

**迁移到 DeepSeek Harness，不丢 Claude Code 历史。** 一次安装，把 Claude 的全部会话、记忆、技能与 `CLAUDE.md` **复制**进 DSH，生成可续聊的会话——并归入专用 `claudecode` 工作区（按项目各建工作区为可选配置）。

`复制式迁移` · `无缝续聊` · `按项目划分工作区` · `与 Claude Code 实时同步`

[![Test](https://github.com/PerryLink/dsh-claude-move/actions/workflows/test.yml/badge.svg)](https://github.com/PerryLink/dsh-claude-move/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/dsh-claude-move)](https://www.npmjs.com/package/dsh-claude-move)
[![npm downloads](https://img.shields.io/npm/dm/dsh-claude-move)](https://www.npmjs.com/package/dsh-claude-move)
[![Node ^22.19 || >=24](https://img.shields.io/static/v1?label=node&message=%5E22.19%20%7C%7C%20%3E%3D24&color=2f7d4f)](https://nodejs.org)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Topic: dsh](https://img.shields.io/badge/topic-dsh-3fb950)](https://github.com/topics/dsh)
[![Topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-3fb950)](https://github.com/topics/dsh-plugin)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/PerryLink/dsh-claude-move/issues)

![dsh-claude-move 社交分享卡](assets/social-card.png)

[English](README.md) | 中文 | [Español](README.es.md) | [Português](README.pt.md) | [हिन्दी](README.hi.md)

> 开发者预览版（0.1.0）。路线图与设计：[PLAN.md](PLAN.md) · 变更记录：[CHANGELOG.md](CHANGELOG.md)。

## ✨ 特性

- 🔍 **自动发现** —— 定位 Claude 数据根目录（`$CLAUDE_CONFIG_DIR`，缺省 `~/.claude`），索引全部项目/会话（标题、起止时间、消息与工具调用数）、目录与 git 状态、记忆、技能、全局 `CLAUDE.md` 与 `settings.json`；增量缓存只重读变化文件。
- 📥 **全保真历史导入** —— 平衡、可继续（resume）的 DSH 会话（`turn/start → step/start → user/message → assistant/message → tool/call → tool/result → step/end → turn/end`），畸形行带行号；中断的工具调用会被修复，保证每个 `tool_use` 恰好对应一个结果（续聊不再永久 400）。
- 🗂 **单个 `claudecode` 工作区（默认）** —— 每个导入会话都落到专用 "claudecode" 工作区，根目录是新建文件夹（默认 `$DSH_HOME/claudecode`；这是插件唯一会创建的东西）。`workspaceMode: 'per-project'` 可恢复按项目各建工作区的分组方式。
- 🔁 **复制式 + 增量** —— 两边都不移动、不改写、不删除任何内容；重跑导入只把新增轮次续写进同一 DSH 会话；`force: true` 以新 id 另存一份完整副本。
- 🧠 **个人上下文持续生效** —— 记忆注入为动态提示词段、Claude 技能注册为真正的 DSH 技能（技能发现会跳过 `README.md` 等非技能文档）、全局 + 项目级 `CLAUDE.md` 前置注入。即便在 `claudecode` 工作区内，也会记住原始项目目录用于记忆/`CLAUDE.md` 解析。
- ⚡ **与运行中的 Claude Code 实时同步** —— 两个工具并行使用，每次重跑只同步变化部分。
- 🖥 **Web 面板与一键命令** —— `/claude-import-all`、`/resume-claude` 与带进度的悬浮迁移面板。
- 🛡 **安全优先** —— 源文件严格只读、DSH 日志 append-only、疑似凭据只报位置、权限类记录只统计不导入。

## 🚀 快速开始

```sh
# 1. 安装
dsh plugin --profile web add -w github:PerryLink/dsh-claude-move
```

2. 在任意 DSH 会话里跑一条命令：

```
/claude-import-all      # 扫描 → 复制全部 Claude 会话 → 报告
```

3. 把已打开的 Web 页面刷新一次（面板自带「刷新会话列表」按钮），点开任意已导入会话即可继续。**全程无需重启 DSH**——见[导入之后](#-导入之后)。

想要精细控制？

```
claude_scan                                     # 全部项目/会话的结构化索引
import_claude { path: "~/.claude/projects" }    # 单个项目目录（递归）
import_claude { path: "all" }                   # 全量
```

## 🗂 迁移内容对照

```
~/.claude（只读）
 ├─ projects/*/*.jsonl  ──→  可续聊的 DSH 会话，归入同一个 "claudecode" 工作区（默认）
 ├─ projects/*/memory/  ──→  动态系统提示词记忆段（每次请求重读）
 ├─ skills/**           ──→  真正的 DSH 技能
 └─ CLAUDE.md + settings ──→  前置提示词段 + 配置建议（绝不代写）
```

| Claude Code 里 | 落到 DSH 成为 |
| --- | --- |
| 会话 transcript（`projects/*/*.jsonl`） | 平衡、可继续（resume）的 DSH 会话——user/assistant/tool/thinking 全保真映射，含中断工具调用修复——归入同一个 **`claudecode` 工作区**（默认 `$DSH_HOME/claudecode`）或按项目各建工作区（`workspaceMode: 'per-project'`） |
| 记忆文件（`projects/*/memory/*.md`） | 动态系统提示词上下文段，每次请求重读（`feedback > project > reference > user`）——即便在 `claudecode` 工作区内也记住原始项目目录 |
| 技能（`~/.claude/skills/**`） | 真正的 DSH 技能（kebab 命名、冲突加后缀、默认上限 30；`README.md`/`MEMORY.md` 与无描述的文件会被跳过） |
| `CLAUDE.md`（全局 + 项目级） | 前置提示词段；项目级优先 |
| `settings.json` | DSH 配置建议 + 显式的无法映射键清单 |
| 项目状态（目录、git 分支与脏行数） | 展示在扫描索引、Web 面板徽标与 `/resume-claude` 交接摘要里 |

## 📦 安装

```sh
# 从 GitHub
dsh plugin --profile web add -w github:PerryLink/dsh-claude-move

# 本地源码（开发推荐）
dsh plugin --profile web add -w link:/path/to/dsh-claude-move

# 打包 tarball
dsh plugin --profile web add -w ./dsh-claude-move-0.1.0.tgz
```

纯 ESM、无构建步骤：git 安装无需 `prepare` 脚本与 `allowBuilds` 白名单。官方打包安装指南见[这里](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)。

## 🛠 使用

在挂载本插件的会话里调用工具：

```
claude_scan                          # 全量扫描（增量缓存）
claude_scan { path: "~/.claude/projects/<slug>" }   # 局部扫描
claude_scan { refresh: true }        # 忽略缓存全量重扫

import_claude { path: "~/.claude/projects/<slug>/<sessionId>.jsonl" }  # 单个会话
import_claude { path: "~/.claude/projects" }        # 目录批量（递归）
import_claude { path: "all" }                       # 全量批量
# 可随时重复运行：未变化跳过；源文件增长则只把新轮次续写到同一会话。
import_claude { path: "...", force: true }          # 以 import-<src>-<n> 另存一份完整副本（旧副本保留）
```

命令（用户直接触发，不经模型回合）：

```
/claude-import-all                # 一键全量：扫描 → 导入 → 报告 → 注入当前会话
/resume-claude latest             # 继续最近的 Claude 会话
/resume-claude <会话ID>           # 按源会话 id 或 import-<src> id
/resume-claude <关键词>           # 匹配标题；多个命中列出候选，绝不猜测
```

Web 面板：右下角悬浮「🐳 Claude 迁移」按钮打开面板——项目/会话树（状态徽标：未导入/已导入/源缺失/目录不存在/git 脏）、关键词过滤、单会话「导入并继续」与「刷新会话列表」、批量导入实时进度条。数据走插件自注册的 `/api/claude-move/*` JSON 路由（公开 `ctx.webServer` seam）。

- **扫描**返回结构化 JSON 索引：项目（slug/cwd/目录存在性/git 分支与脏行数）、会话（标题/起止时间/消息与工具调用数/畸形行数）、记忆、技能、全局 CLAUDE.md 与 settings.json；每个会话带 `import.status`（`none`/`imported`/`source-missing`）；`settingsSuggestions` 是 settings.json 的 DSH 翻译建议与无法映射项（见 [COMPLIANCE.md](COMPLIANCE.md)）。
- **导入**全保真映射 user/assistant/tool/thinking，中断的工具调用会被修复（每个 `tool_use` 恰好一个结果），产物是可继续的平衡会话，默认挂接到 `claudecode` 工作区（或按项目各建工作区）；批量逐文件汇总（`imported`/`appended`/`already-imported`/`skipped`/`failed`），畸形行带行号、疑似凭据只报位置（文件:行:类型）、权限类记录只统计不导入。导入绝不删除/改写任何东西：DSH 既有会话原样不动、旧导入副本保留、Claude 源文件从不写入。
- **个人上下文自动生效（无需导入动作）**：
  - 记忆：全部 `projects/*/memory/*.md` 注入动态上下文段，每次请求按 mtime 重读（新记忆即时生效），`feedback > project > reference > user` 排序，默认 8KB 上限；在 `claudecode` 工作区内，插件会从记录的 `sourceCwd` 解析出原始项目。
  - 技能：`~/.claude/skills/**/SKILL.md`（+ 扁平 `*.md`）注册为 DSH 技能（kebab 归一化、冲突加后缀、上限 30；`README.md`/`MEMORY.md` 与无描述的文件会被跳过，绝不破坏技能加载），catalog 注入与 `skill` 工具由 DSH 负责；
  - 指令：全局 `~/.claude/CLAUDE.md` + 当前会话 cwd 的 `.claude/CLAUDE.md` 注入前置段（项目优先；在 `claudecode` 工作区内经 `sourceCwd` 解析）。

## ✅ 导入之后

**不需要重启 DSH。** 导入经公开 `sessionPersistence` 服务即时落盘：

- 服务端列表（`session.list` / `workspace.list` RPC、CLI、任何新打开的页面）立即可见已导入会话，归入 **`claudecode` 工作区**（`workspaceMode: 'per-project'` 时按项目各建工作区）。
- 面板会经 shell 官方客户端服务（`sessions.refresh`/`workspaces.refresh`，特性探测）自动刷新已打开页面的会话列表，并为每个会话提供「打开会话」按钮；老 shell 无这些服务时回退「刷新会话列表」按钮 / 整页刷新——导入直接写入持久化服务的 cold 会话，不会发 UI 的 `host/session-added` 实时帧；工作区分组则会实时更新（`host/workspace-changed`）。
- 导入的会话可立即打开、阅读与续聊——`/resume-claude`，或直接在会话列表中点开。交接摘要会标明原始项目目录。之后随时重跑导入，只会把新增轮次增量续写进同一会话。

## ⚙️ 配置（全部可选，可在 cordis.yml 覆盖）

```yaml
- id: claude-move
  name: dsh-claude-move
  config:
    claudeHome: null            # 缺省自动定位 $CLAUDE_CONFIG_DIR / ~/.claude
    workspaceMode: claudecode   # 'claudecode'（默认：全部导入挂到一个专用工作区）| 'per-project'（按源 cwd 各建工作区）
    claudecodeDir: null         # claudecode 工作区目录；默认 $DSH_HOME/claudecode（插件唯一会创建的文件夹）
    scanGit: true               # git 探测级别：true 全量 | 'branch' 零 git 子进程 | false 关闭
    gitTimeoutMs: 5000          # git 子进程超时（毫秒）
    scanConcurrency: 8          # 全量扫描的项目并发上限
    maxTranscriptBytes: 67108864
    excludeProjects: []         # slug 子串排除，如 ['demo-']
    enableMemory: true
    memoryMaxBytes: 8192
    memoryScope: current-project  # 'current-project' 只注入当前项目 | 'all' 全部、当前项目优先
    enableSkills: true
    maxSkills: 30
    extraSkillDirs: []
    enableInstructions: true
    resumeMaxChars: 2048      # 交接摘要字符上限
    resumeMode: inject        # 'inject' 注入交接摘要 | 'agents' 经 ctx.agents.resume 打开会话
    enableWebPanel: true      # 注册 /api/claude-move/* 面板路由
    importConcurrency: 4      # 批量导入「读取+转换」并发上限（落盘保持串行）
```

## 🗑 卸载

从 profile 的 bundles 移除 `claude-move` 行并重启 dsh。已导入会话保留在 DSH 数据目录；本插件只在 `$DSH_HOME/claude-move/` 写索引缓存与导入映射、还会写 `claudecode` 工作区文件夹，绝不触碰 Claude 源数据。

## 🧭 兼容性

- 目标 `dsh 0.1.0-rc.6`（web profile）；peer 依赖锁定 rc.6；Node `^22.19 || >=24`。
- 最后验证 **2026-08-13**（Windows / Node 22，针对 `@deepseek-ai/dsh@0.1.0-rc.6`）：tarball 从零安装、真实扫描（40 项目 / 2387 会话）、真实批量导入 13/13 + 幂等重导入 13/13、工作区挂接与持久化产物确认。macOS/Linux 现由 CI 矩阵（linux/macos/windows × Node 22）自动验证。
- 验证 **2026-08-14**（当前 `deepseek-harness` checkout，web profile / JSONL+zstd 会话后端 / 真实工作区注册表，隔离 DSH_HOME）：挂载插件完整启动 web、经面板路由扫描 + 全量导入、创建 `claudecode` 工作区并挂接会话、对既有导入会话增量续写（seq 连续、可正常 load）、重启后幂等重导入，全程既有 DSH 会话不受影响；任何会话都不会被归档、删除或改写。

### 兼容矩阵（只依赖公开面）

| 面 | 使用 | 缺失时回退 |
| --- | --- | --- |
| host 服务（`tools`/`sessionPersistence`/`workspaceRegistry`/`commands`/`systemPrompt`/`skills`/`webServer`） | 按需使用 | 可选服务经 `internal/service` 响应式注册；`fs` 缺失响亮失败 |
| `sessionPersistence.listSnapshots`/`readFrom`、`fs.streamText`、`ctx.jobs`、`ctx.agents.resume` | 特性探测 | `list()`/整读+响亮拒绝/自有 job 表/交接摘要注入 |
| 客户端 shell 服务（`sessions.refresh/open`、`workspaces.refresh`） | 面板 apply 时特性探测 | 整页刷新 |
| 新平台能力一律不是硬依赖——插件在 rc.6 上始终可启动。 | | |

## 🔐 权限与数据

- **读取** `~/.claude`（transcript、记忆、技能、CLAUDE.md、settings.json）——严格只读——以及导入目标项目目录（`per-project` 模式下工作区挂接）。
- **写入** 经公开 `sessionPersistence` 服务的 DSH 会话日志——只 `create` + `append`，绝不删除、改写或归档既有会话——工作区注册表记录、插件自有缓存 `$DSH_HOME/claude-move/`（扫描书签 + 导入映射），以及 `claudecode` 工作区文件夹（默认 `$DSH_HOME/claudecode`；仅一次 `mkdir`，绝不删除任何内容）。
- **绝不** 改写 Claude 源文件、触碰其它应用数据、访问网络。
- **不读取、不传输任何凭据**；transcript 中的疑似密钥只报告位置。

## 🛡 安全边界

- 源文件一律只读；DSH 会话日志 append-only（只 `create` + `append`）。
- 外部 transcript 视为不可信输入：不执行其中任何内容；system/developer/thinking 不进入续聊摘要。
- 不修改 DSH 引擎、官方 UI 包、apiproxy；只通过公开服务（`sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`）工作。
- 疑似密钥/凭据只报位置不展示内容；`permission`/`permission-mode`/`queue-operation` 类记录只统计不导入。

## 🩺 排障

- 行未生效：`dsh --profile <p> --dump-config` 应显示 `# == dsh-claude-move`；重新执行 `dsh plugin --profile <p> add -w ...`。
- web 启动后无响应：`dsh plugin add` 初始化的新 profile 只有 `dsh-base`，需在 `dsh.profile.bundles` 补 `@deepseek-ai/dsh-web-app`（装进已有 `web` profile 无需处理）。
- 面板路由 404：仅当 `enableWebPanel: true` 且组成包含 web 服务器时提供；检查启动日志 FAILED。
- 导入报「transcript 过大」：调高 `maxTranscriptBytes` 或单独导入该文件。
- 导入成功但侧边栏看不到新会话：页面在导入前已打开——点一次面板「刷新会话列表」（或刷新页面）即可；**任何时候都不需要重启 dsh**。
- 日志：启动失败打印在 `dsh` 控制台；插件以 `[claude-move]` 前缀输出工作区/映射错误。

## 📚 文档

- [PLAN.md](PLAN.md) — 研究结论与实施方案。
- [ARCHITECTURE.md](ARCHITECTURE.md) — 架构图与完整数据映射表。
- [COMPLIANCE.md](COMPLIANCE.md) — 对照官方插件约束的逐条审计（deepseek-harness 仓库与文档、[deepseek.com/harness](https://www.deepseek.com/harness/)、[开发者文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)、[Cordis](https://github.com/cordiverse/cordis) 与 [Cordis 论文](https://github.com/cordiverse/paper)）。
- [OPTIMIZATION.md](OPTIMIZATION.md) — 实测基线 + 分优先级的优化候选。
- [RELEASE.md](RELEASE.md) — 发布清单与验收证据。
- [CHANGELOG.md](CHANGELOG.md) — 各版本变更记录。

## 🙏 复用与出处（开源组件）

本仓库按 Apache License 2.0 许可；下列 MIT 许可组件保留各自许可证（全文见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）：

- 转换核心 vendored 自 [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import)（MIT）。
- 发现约定与安全模型沿用 [Demogorgon314/dsh-resume-plugin](https://github.com/Demogorgon314/dsh-resume-plugin)（MIT；其 session_reader.py 另有 Apache-2.0 上游出处，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）。
- memory/skills 注入与 frontmatter 解析沿用 [YYTbit/dsh-plugin-claude-bridge](https://github.com/YYTbit/dsh-plugin-claude-bridge)（MIT）。

## 🧑‍💻 开发

```sh
npm install   # peer 依赖：@deepseek-ai/cordis、@deepseek-ai/dsh-tools@0.1.0-rc.6、@deepseek-ai/schemastery
npm test      # node --test：convert（vendored + 扩展）、discovery、import/report、context、settings
```

CI 经 GitHub Actions（[test.yml](.github/workflows/test.yml)）在 Node 22 上跑完整套件。

## 🧠 Model Experience

- 模型可见面 = 两个工具的 description/schema 与输出：`claude_scan` 返回结构化索引，`import_claude` 返回逐文件汇总与告警位置；工具结果本身即落盘的 `tool/result`，全部可重建。
- 无隐藏模型文本；memory/CLAUDE.md 段注册于 `ctx.systemPrompt`（提示词组装，可随会话日志重建）。

## ⚠️ 已知局限

- 标题只取 `custom-title`/`ai-title`/首问；Claude `summary` 记录不作为标题。
- `thinking` 块保留在导入日志的 `reasoning` 内容块中，但不进入续聊摘要。
- 中断的工具调用会被修复为合成的错误结果（绝不丢弃），因此中途中断的会话仍可续聊——修复会报告为 `repaired.synthesized`。
- 权限类记录只统计不导入；DSH 权限预设建议随报告生成。
- Claude `summary` 记录（上下文压缩摘要）只报告、不映射为 DSH compaction 节点——合成压缩事务需伪造 seq 范围与检查点消息，风险大于收益（见 OPTIMIZATION.md）；完整历史按原始轮次导入。
- host 无 `fs.streamText` 流式面时，超过 `maxTranscriptBytes` 的 transcript 响亮失败而非部分导入；有流式面的环境自动走分块流式导入。
- 在 `workspaceMode: 'per-project'` 下，源目录已删除的会话仍可导入，但工作区挂接失败（留在「未分组」，报告 `workspace.attached: false` 并附 `reason`）；默认的 `claudecode` 工作区不依赖源目录，因此此类会话在其中正常挂接。
- 批量导入中断可安全重跑（幂等、append-only）：已完成文件跳过、已增长文件只续写新轮次。
- 若源文件被原地重置/截断（轮次少于已导入记录），重导跳过并报 `sourceShrunk`；需要完整副本用 `force: true`。
- Web 面板为零构建悬浮面板，走插件自注册 JSON 路由；不使用 shell 内部 UI slot（刻意不依赖 rc.6 未文档化内部面）。
- 流式增量续写时，单次结果的 `messages`/`toolCalls` 只统计本次新增事件（已存储前缀不重读）；`turns` 仍为全量轮次。

## 🤝 参与贡献与反馈

欢迎提 Issue 与 PR——请使用对应模板（[缺陷报告](.github/ISSUE_TEMPLATE/bug-report.yml)、[功能请求](.github/ISSUE_TEMPLATE/feature-request.yml)）。问题与讨论在仓库的 [GitHub Discussions](https://github.com/PerryLink/dsh-claude-move/discussions)。安全问题请通过 GitHub Security Advisories（仓库 Settings → Security）私下报告，详见 [SECURITY.md](SECURITY.md)。

## 💛 贡献者致谢

感谢每一位让这个插件变得更好的人：

- [OLDnana1](https://github.com/OLDnana1) —— 定位了「中断工具调用」导致导入会话续聊永久 400 的根因（[#1](https://github.com/PerryLink/dsh-claude-move/issues/1)），已于 v0.2.0 修复。
- [GooodWei](https://github.com/GooodWei) —— 发现 `README.md`（及任何无描述的 `.md`）被误注册为技能、导致 DSH 技能加载整体失败（[#1](https://github.com/PerryLink/dsh-claude-move/issues/1)），已于 v0.2.0 修复。
- 本插件所复用的 MIT 上游项目在[署名](#-attribution-open-source-components)与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中致谢。

## 🔗 相关链接

- DeepSeek Harness：[仓库](https://github.com/deepseek-ai/deepseek-harness) · [官网](https://www.deepseek.com/harness/) · [开发者文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)
- 插件生态：[`dsh` topic](https://github.com/topics/dsh) · [`dsh-plugin` topic](https://github.com/topics/dsh-plugin) · [Discord](https://discord.gg/Ycq5dCaS4)

## 📄 License

Apache License 2.0 — 见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。第三方声明（含 MIT 组件的 MIT 原文）见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
