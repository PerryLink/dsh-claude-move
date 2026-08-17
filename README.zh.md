<div align="center">

# 🚚 dsh-claude-move

**将 Claude Code、Codex、OpenCode 和 Hermes 迁移到 DeepSeek Harness —— 将会话、记忆、技能、指令和斜杠命令复制为可续聊的 DSH 会话，只复制、审批门控。**

*迁移时保留你的 Claude Code 历史：一次安装、可续聊会话、与运行中的 Claude Code 实时同步，以及一个四来源迁移向导。*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-claude-move/test.yml?branch=master&label=CI)](https://github.com/PerryLink/dsh-claude-move/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-claude-move?label=version)](https://github.com/PerryLink/dsh-claude-move/releases)
[![npm version](https://img.shields.io/npm/v/dsh-claude-move)](https://www.npmjs.com/package/dsh-claude-move)
[![npm downloads](https://img.shields.io/npm/dm/dsh-claude-move)](https://www.npmjs.com/package/dsh-claude-move)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## 兼容性

- 面向 `dsh 0.1.0-rc.6`（web profile）；peer 依赖锁定在 `0.1.0-rc.6`。Node `^22.19 || >=24`。
- 最近针对全新 tarball 安装验证：真实扫描、真实批量导入（幂等重导入）、工作区挂载与持久化产物均已确认；macOS/Linux 由 CI 矩阵覆盖。

### 兼容性矩阵（仅公开接缝）

| 接缝 | 使用 | 缺失时的回退 |
|---|---|---|
| Host 服务（`tools` / `sessionPersistence` / `workspaceRegistry` / `commands` / `systemPrompt` / `skills` / `webServer`） | 所列之处必需 | 可选服务响应式注册；缺失 `fs` 大声失败 |
| `sessionPersistence.listSnapshots` / `readFrom` / 支持 `streamText` 的 `fs` / `ctx.jobs` / `ctx.agents.resume` | 特性探测 | `list()` / 整文件读取并大声拒绝 / 自有 job map / 交接注入 |
| Client shell 服务（`sessions.refresh/open`、`workspaces.refresh`） | 面板 apply 时特性探测 | 整页刷新 |
| 较新的平台能力从不是硬性要求 —— 插件在 rc.6 上始终保持可启动。 | | |

## 你能获得什么

1. **自动发现** —— `claude_scan` 定位 Claude 数据根（`$CLAUDE_CONFIG_DIR`，回退 `~/.claude`）并索引每个项目/会话、记忆、技能、全局 `CLAUDE.md` 和 `settings.json`，带增量缓存和并行扫描（`scanConcurrency`）。
2. **全保真导入** —— `import_claude` 将 transcript 转换为均衡、可续聊的 DSH 会话（`turn/start → step/start → user/message → assistant/message → tool/call → tool/result → step/end → turn/end`），修复被中断的工具调用，并以分块流式导入超过 `maxTranscriptBytes` 的 transcript。
3. **一个 `claudecode` 工作区** —— 每个导入的会话都落到一个专用工作区（默认 `$DSH_HOME/claudecode`）；`workspaceMode: 'per-project'` 恢复每个项目一个工作区的分组方式。
4. **只复制且增量** —— 两侧都不会被移动、改写或删除；重新运行只追加新的轮次（`force: true` 以新 id 额外保存一份完整副本）。
5. **个人上下文，始终新鲜** —— 记忆作为实时提示词段落注入，Claude 技能注册为真正的 DSH 技能（全局 + 项目级），全局 + 项目 `CLAUDE.md` 提前注入。
6. **四来源迁移向导** —— `/move` 加上 `move_detect` / `move_preview` / `move_run` 迁移 Claude Code、Codex、OpenCode 和 Hermes，审批门控且幂等（`move.json`）。
7. **Web 面板与命令** —— `/claude-import-all`、`/resume-claude`、`/claude-move-reset`，以及一个浮动迁移面板。

## 四来源迁移向导

```text
/move              # 一次性向导：检测 → 预览 → 执行 → 报告（全部四个来源）
move_detect        # 扫描 Claude Code / Codex / OpenCode / Hermes
move_preview       # 逐项计划：new | unchanged | changed | conflict（含 diff）| unsupported
move_run           # 在审批门控之后执行；冲突解决：
                   #   skip | overwrite | rename | merge  （默认 skip —— 绝不猜测）
```

- **来源** —— Claude Code（`~/.claude`）、Codex（`~/.codex`）、OpenCode（数据 + 配置根）、Hermes（技能/记忆根）；每个来源都有自己的 parser + mapper。
- **映射** —— 记忆/指令 → 追加到 DSH 全局 `AGENTS.md` 的仅追加受管段落（每项一个标记段落）；技能 → 真正的 DSH 技能（`SKILL.md` 包原样复制，其他格式转换）；斜杠命令 → 已注册的 DSH 命令（重启后从 `move.json` 重建）；会话 → 可续聊的 DSH 会话（与阶段 1 相同的导入器）。
- **幂等** —— 每个已应用的计划都记录在 `$DSH_HOME/claude-move/move.json`（`digest` / `targetDigest` / `appliedAt`）；重新运行跳过未变更项，`force` 重新应用它们。
- **审批门控** —— 任何会写入内容的运行都先询问 `ctx.approval`；除 `allowed-once` 之外的任何结果都意味着零写入。

## 快速开始

```sh
# 1. 将 bundle 安装到你的 profile
dsh plugin --profile web add "github:PerryLink/dsh-claude-move#master"

# 或从 npm 安装（已发布版本）
dsh plugin --profile web add dsh-claude-move

# 2. 重启并验证该行
dsh --profile web --dump-config | grep -A4 'id: claude-move'
```

然后，在任意 DSH 会话中运行一条命令：

```sh
/claude-import-all      # 扫描 → 复制每个 Claude 会话 → 报告
```

导入后无需重启 DSH —— 刷新一次已打开的 Web 页面，点击任意导入会话即可继续。

## 安装与卸载

- **git 渠道**（最新 `master`）：`dsh plugin --profile web add "github:PerryLink/dsh-claude-move#master"` —— 纯 ESM，无需 `prepare` 或 `allowBuilds` 步骤。
- **npm 渠道**（已发布版本）：`dsh plugin --profile web add dsh-claude-move`。
- **tarball 渠道**：在本仓库执行 `npm pack`，然后 `dsh plugin --profile web add ./dsh-claude-move-<version>.tgz`。
- **卸载**：从 profile 的 bundles 中删除 `claude-move` 行并重启 `dsh`。导入的会话保留在 DSH 的数据目录中；插件只写自己的缓存（`$DSH_HOME/claude-move/`）和 `claudecode` 工作区文件夹，绝不触碰 Claude 源数据。

## 迁移了什么

```
~/.claude（只读）
 ├─ projects/*/*.jsonl  ──→  可续聊的 DSH 会话，默认分组到一个 "claudecode" 工作区
 ├─ projects/*/memory/  ──→  实时 system-prompt 记忆段落（每次请求重新读取）
 ├─ skills/**           ──→  真正的 DSH 技能
 └─ CLAUDE.md + settings ──→  早期提示词段落 + 配置建议（绝不自动应用）
```

| 在 Claude Code 中 | 在 DSH 中变为 |
|---|---|
| 会话 transcript（`projects/*/*.jsonl`） | 均衡、可续聊的 DSH 会话 —— `user`/`assistant`/`tool`/`thinking` 全保真映射并修复被中断的工具调用 —— 分组到一个 **`claudecode`** 工作区或每个项目一个 |
| 记忆文件（`projects/*/memory/*.md`） | 一个实时 system-prompt 上下文段落，每次请求重新读取（`feedback > project > reference > user`） |
| 技能（`~/.claude/skills/**`） | 真正的 DSH 技能（kebab-case 命名、冲突后缀、默认最多 30 个；`README.md`/`MEMORY.md` 及无描述的文件被跳过） |
| `CLAUDE.md`（全局 + 每个项目） | 一个早期提示词段落；项目文件优先 |
| `settings.json` | DSH 配置建议，附带明确的无法映射键列表 |
| 项目状态（目录、git 分支和脏计数） | 显示在扫描索引、Web 面板徽章和 `/resume-claude` 交接中 |

## 用法

在挂载了插件的任意会话中调用这些工具：

```
claude_scan                          # 完整扫描（增量缓存）
claude_scan { path: "~/.claude/projects/<slug>" }   # 部分扫描
claude_scan { refresh: true }        # 跳过缓存，重新扫描全部
claude_scan { projectsLimit: 10, sessionsLimit: 5, fields: "brief" }  # 精简输出

import_claude { path: "~/.claude/projects/<slug>/<sessionId>.jsonl" }  # 单个会话
import_claude { path: "~/.claude/projects" }        # 目录（递归）
import_claude { path: "all" }                       # 全部
# 随时重新运行：未变更的文件被跳过，增长的 transcript 只追加新的轮次。
# 超过 maxTranscriptBytes 的文件以分块流式导入（无内存上限）。
import_claude { path: "...", force: true }          # 全新的完整副本（保留之前的副本）
```

命令（用户触发，不占模型轮次）：

```
/claude-import-all                # 一次性：扫描 → 导入全部 → 报告 → 注入当前会话
/resume-claude latest             # 继续最近的 Claude 会话
/resume-claude <sessionId>        # 按源会话 id 或 import-<src> id
/resume-claude <keyword>          # 匹配标题；多个匹配会列出，绝不猜测
/claude-move-reset                # 重置插件缓存（书签 + 导入映射）；导入的会话保留
```

Web 面板：一个浮动迁移面板，包含项目/会话树、状态徽章（未导入 / 已导入 / 已导入并有新轮次 / 源缺失 / 目录缺失 / git 脏）、关键字过滤、分页渲染、每个会话的「导入并继续」+「打开会话」+「刷新会话列表」、带实时进度条和取消的批量导入，以及一个缓存重置按钮。文本跟随浏览器语言（zh/en）。通过插件自身的 `/api/claude-move/*` JSON 路由在公开 `ctx.webServer` 接缝上提供。

## 导入之后

**你无需重启 DSH。** 导入在完成的那一刻即通过公开的 `sessionPersistence` 服务持久化落地：

- 服务器端列表（`session.list` / `workspace.list` RPC、CLI、任何新的页面加载）会立即在 **`claudecode` 工作区**下显示导入的会话。
- 面板会自行刷新已打开页面的会话列表，并为每个导入的会话提供 **打开会话** 按钮。
- 导入的会话可以立即打开、读取和继续 —— `/resume-claude`，或点击列表中的会话。随时重新运行导入只会把新轮次同步到相同的会话中。

## 配置

全部可选，可在 cordis.yml 中覆盖。

| 键 | 默认值 | 含义 |
|---|---|---|
| `claudeHome` | `$CLAUDE_CONFIG_DIR` 或 `~/.claude` | Claude 数据根 |
| `workspaceMode` | `claudecode` | `claudecode`（一个专用工作区）· `per-project`（每个源 cwd 一个工作区） |
| `claudecodeDir` | `$DSH_HOME/claudecode` | `claudecode` 工作区文件夹（插件唯一会创建的文件夹） |
| `scanGit` | `true` | Git 探测级别：`true`（完整）· `'branch'`（零 git 调用）· `false` |
| `gitTimeoutMs` | `5000` | Git 子进程超时 |
| `scanConcurrency` | `8` | 并行项目扫描上限 |
| `maxTranscriptBytes` | `67108864` | 流式导入阈值（超过则分块） |
| `excludeProjects` | `[]` | 要跳过的 slug 子串 |
| `enableMemory` | `true` | 将记忆作为实时提示词段落注入 |
| `memoryMaxBytes` | `8192` | 记忆段落上限 |
| `memoryScope` | `current-project` | `current-project` · `all`（当前项目优先） |
| `enableSkills` | `true` | 将 Claude 技能注册为 DSH 技能 |
| `maxSkills` | `30` | 技能数量上限 |
| `extraSkillDirs` | `[]` | 额外的技能目录 |
| `enableInstructions` | `true` | 注入全局 + 项目 `CLAUDE.md` |
| `resumeMaxChars` | `2048` | 交接摘要字符上限 |
| `resumeMode` | `inject` | `inject`（交接摘要）· `agents`（ctx.agents.resume） |
| `enableWebPanel` | `true` | 注册 `/api/claude-move/*` 面板路由 |
| `importConcurrency` | `4` | 每批并行读取 + 转换 |
| `requireApproval` | `true` | 向导写入询问 `ctx.approval`（仅 allowed-once） |
| `codexHome` | `$CODEX_HOME` 或 `~/.codex` | Codex 数据根 |
| `opencodeDataHome` | 平台 XDG 数据目录/opencode | OpenCode 数据根 |
| `opencodeConfigHome` | 平台 XDG 配置目录/opencode | OpenCode 配置根 |
| `hermesHome` | `$HERMES_HOME` 或 `~/.hermes` | Hermes 数据根 |
| `skillsDir` | `$DSH_HOME/skills` | 向导技能目标 |
| `agentsMdPath` | `$DSH_HOME/AGENTS.md` | 向导记忆/指令目标 |
| `moveWorkspaceMode` | `per-source` | 向导导入的工作区分组：`per-source` · `single` |

## 工具与界面

| 界面 | 类型 | 说明 |
|---|---|---|
| `claude_scan` | 工具 | 项目/会话/记忆/技能/设置的结构化索引 |
| `import_claude` | 工具 | 导入单个会话、一个目录或 `all`（增量；`force` 生成全新副本） |
| `move_detect` / `move_preview` / `move_run` | 工具 | 四来源向导：扫描、带 diff 的逐项计划、在审批之后执行 |
| `/claude-import-all` | 命令 | 扫描 → 导入全部 → 报告 |
| `/resume-claude` | 命令 | 继续一个 Claude 会话（latest、id 或关键字） |
| `/claude-move-reset` | 命令 | 重置插件缓存（导入的会话保留） |
| `/move` | 命令 | 一次性四来源向导 |
| Web 迁移面板 | 客户端 | 带进度、取消、分页、打开会话的浮动面板 |

## 权限与数据

- **权限**：workshop 清单声明 `filesystem:read` 和 `filesystem:write`。
- **读取** `~/.claude`（transcript、记忆、技能、`CLAUDE.md`、`settings.json`）—— 严格只读 —— 以及它导入到的项目目录。
- **写入** 通过公开 `sessionPersistence` 服务写 DSH 会话日志（仅 create + append，绝不删除/改写/归档）、工作区注册表记录、`$DSH_HOME/claude-move/` 下的缓存，以及 `claudecode` 工作区文件夹。
- **绝不** 修改 Claude 源文件、触碰其他应用的数据或访问网络。**不读取或传输任何凭据**。

## 安全边界

- **源文件只读；DSH 日志只追加**（仅 `create` + `append`）。
- **外部 transcript 是不可信输入** —— 其中的任何内容都不会被执行；system/developer/thinking 内容绝不进入续聊交接。
- **仅公开服务** —— `sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`；不改引擎或 UI。
- **密钥仅按位置报告**（file:line:kind）；`permission`/`permission-mode`/`queue-operation` 记录只计数、不导入。
- **向导写入审批门控** —— 除 `allowed-once` 之外的任何结果都意味着零写入。

## 已知限制

- 标题来自 `custom-title`/`ai-title`/首条提示；Claude `summary` 记录会被报告，但不映射为 DSH 压缩节点（合成一个有效的压缩事务会伪造其 seq 范围和检查点消息）。
- `thinking` 块作为 `reasoning` 内容保留，但绝不进入续聊交接。
- 被中断的工具调用会以合成的错误结果修复（绝不丢弃），报告为 `repaired.synthesized`。
- 权限类记录只计数、不导入；DSH 权限预设建议在报告中生成。
- 在没有流式 `fs.streamText` 接口的宿主上，超过 `maxTranscriptBytes` 的 transcript 会大声失败，而不是部分导入。
- 在 `workspaceMode: 'per-project'` 下，源目录已删除的会话仍会导入，但工作区挂载失败（保持未分组；`workspace.attached: false` 加上一个 `reason`）。默认的 `claudecode` 工作区不依赖源目录。
- 如果 transcript 被就地截断或重置（轮次少于记录的导入），重新导入会跳过它并报告 `sourceShrunk`；用 `force: true` 生成全新的完整副本。
- Web 面板是由插件自身 JSON 路由驱动的零构建浮动面板；它不使用 shell 内部的 UI 插槽系统。

## 模型体验

- 面向模型的面是两个工具的描述/schema 及其输出：`claude_scan` 返回结构化索引，`import_claude` 返回逐文件摘要以及警告的位置。工具结果本身被记录为 `tool/result` 事件，因此一切都可以重建。
- 没有隐藏的面向模型的文本；记忆/`CLAUDE.md` 段落注册在 `ctx.systemPrompt` 上（提示词组装，可从会话日志重建）。

## 故障排查

- 该行未生效：`dsh --profile <p> --dump-config` 应打印 `# == dsh-claude-move`；重新运行 `dsh plugin --profile <p> add ...`。
- Web 能启动但静默挂起：由 `dsh plugin add` 初始化的新 profile 只包含 `dsh-base` —— 将 `@deepseek-ai/dsh-web-app` 添加到 `dsh.profile.bundles`。安装到已有的 `web` profile 则无需任何操作。
- 面板路由 404：只有当 `enableWebPanel: true` 且组合了 web 服务器时才会提供这些路由；检查启动日志中的 FAILED fiber。
- 导入失败并提示 "transcript 过大"：提高 `maxTranscriptBytes` 或单独导入该文件。
- 导入成功但侧边栏没有显示新会话：页面已经打开 —— 点击一次面板的刷新按钮（或重新加载页面）即可。永远不需要重启 DSH。
- 日志：启动失败会打印到 `dsh` 控制台；插件会为工作区/导入映射问题记录以 `[claude-move]` 为前缀的错误。

## 致谢（开源组件）

本项目采用 Apache License 2.0 许可；以下 MIT 许可组件保留其自身许可（全文见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）：

- 转换核心 vendored 自 [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import)（MIT）。
- 发现约定与安全模型来自 [Demogorgon314/dsh-resume-plugin](https://github.com/Demogorgon314/dsh-resume-plugin)（MIT）。
- 记忆/技能注入与 frontmatter 解析模式来自 [YYTbit/dsh-plugin-claude-bridge](https://github.com/YYTbit/dsh-plugin-claude-bridge)（MIT）。

## 开发

```sh
npm install   # peer 依赖：@deepseek-ai/dsh-tools@0.1.0-rc.6、@deepseek-ai/cordis、schemastery
npm test      # node --test test/*.test.mjs
```

CI 通过 GitHub Actions（[test.yml](.github/workflows/test.yml)）在 Linux/macOS/Windows 上以 Node 22 运行完整套件。

## 主题

`deepseek-harness`, `dsh-plugin`, `claude-code`, `migration`, `session-import`, `resume`

## 贡献者

- [@PerryLink](https://github.com/PerryLink) —— 创建者与维护者：导入管线、四来源迁移向导、Web 面板、文档、CI/CD 与发布。
- [@OLDnana1](https://github.com/OLDnana1) —— 对被中断工具调用损坏的根因分析，该损坏曾使导入会话在续聊时永久返回 HTTP 400。
- [@GooodWei](https://github.com/GooodWei) —— 发现 `README.md`（以及任何无描述的 `.md`）被误注册为技能，从而破坏 DSH 的技能加载。

## PerryLink DSH 插件家族

本项目是 [PerryLink](https://github.com/PerryLink) 维护的 DeepSeek Harness 插件之一。如果这个对你有帮助，其他的很可能也有用：

| 插件 | 一句话介绍 |
|---|---|
| [dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel) | 只读 MCP 运行时面板：/mcp 命令 + 带状态、工具和错误的设置标签页 |
| [dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck) | 工程纪律守卫：需求盘问、测试门、对手审查 |
| [dsh-background-agents](https://github.com/PerryLink/dsh-background-agents) | 带 Web UI 侧边栏、消息和中断的持久后台子代理 |
| [dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions) | 通过语言服务器提供 LSP 诊断、格式化、补全、代码操作与重命名 |
| [dsh-output-styles](https://github.com/PerryLink/dsh-output-styles) | Claude Code outputStyles 等价的运行时样式切换 |
| [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind) | Claude Code /rewind 等价物：快照、会话分叉、一次性恢复 |
| [dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules) | Claude Code 风格的声明式 allow/deny/ask 权限规则，带审计 |
| [dsh-auto-review](https://github.com/PerryLink/dsh-auto-review) | 在审批链上的第二模型自动审查，默认 fail-closed |
| [dsh-memento](https://github.com/PerryLink/dsh-memento) | 审批门控的跨会话记忆：ctx.memory 接缝 + SQLite + 记忆工具 |
| [dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security) | 安全审计技能包：密钥扫描、依赖与供应链审查 |
| [dsh-session-pin](https://github.com/PerryLink/dsh-session-pin) | 在 Web 侧边栏固定会话，带持久排序 |
| [dsh-composer-history](https://github.com/PerryLink/dsh-composer-history) | Web 编辑器终端风格输入历史：方向键、Ctrl+R 搜索 |
| [dsh-github](https://github.com/PerryLink/dsh-github) | DSH 的 GitHub PR/issues 集成，每次写入都经审批门控 |
| [dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide) | 作为按需代理技能的插件开发知识库 |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | 将 Claude Code 会话、记忆、技能和 CLAUDE.md 迁移到 DSH |

## 许可证

[Apache License 2.0](LICENSE) © 2026 dsh-claude-move contributors
