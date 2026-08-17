<div align="center">

# 🚚 dsh-claude-move

**把 Claude Code、Codex、OpenCode 与 Hermes 迁移进 DeepSeek Harness —— 将会话、记忆、技能、指令与斜杠命令复制为可续聊的 DSH 会话，只复制、审批门控。**

*迁移到 DeepSeek Harness 时保留你的 Claude Code 历史：一次安装、可续聊会话、与运行中的 Claude Code 实时同步，以及一个四来源迁移向导。*

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

| 方面 | 状态 |
|---|---|
| Harness | DeepSeek Harness `0.1.0-rc.6`（peer 依赖锁定在 `0.1.0-rc.6`） |
| Node | `^22.19.0 \|\| >=24.0.0` |
| 平台 | 全部（宿主工具 + 浮动 Web 面板；仅公开接缝） |
| 模型 | 任意（导入是确定性的；自身不调用模型） |

## 你能获得什么

1. **自动发现** —— `claude_scan` 定位 Claude 数据根（`$CLAUDE_CONFIG_DIR`，回退 `~/.claude`），索引每个项目/会话、记忆、技能、全局 `CLAUDE.md` 与 `settings.json`，带增量缓存与并行扫描。
2. **全保真导入** —— `import_claude` 把 transcript 转为均衡、可续聊的 DSH 会话，修复被中断的工具调用，并以分块流式导入超过 `maxTranscriptBytes` 的 transcript。
3. **单一 `claudecode` 工作区** —— 每个导入会话都落到专用工作区（默认 `$DSH_HOME/claudecode`）；`workspaceMode: 'per-project'` 恢复按项目各建工作区。
4. **只复制且增量** —— 两侧都不会被移动、改写或删除；重新运行只追加新轮次。
5. **个人上下文，始终最新** —— 记忆作为实时提示词段落注入，Claude 技能注册为真正的 DSH 技能，全局 + 项目 `CLAUDE.md` 提前注入。
6. **四来源迁移向导** —— `/move` 向导加 `move_detect` / `move_preview` / `move_run` 工具迁移 Claude Code、Codex、OpenCode 与 Hermes：记忆变成受管 `AGENTS.md` 段落，技能变成 DSH 技能，斜杠命令变成 DSH 命令，会话变成可续聊 DSH 会话 —— 审批门控且幂等（`move.json`）。
7. **Web 面板与命令** —— `/claude-import-all`、`/resume-claude`、`/claude-move-reset`，以及带进度、取消、分页与「打开会话」的浮动迁移面板。

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
/claude-import-all      # 扫描 → 复制所有 Claude 会话 → 报告
```

导入后无需重启 DSH —— 刷新一次已打开的 Web 页面，点击任意导入会话即可继续。

## 安装与卸载

- **git 渠道**（最新 `master`）：`dsh plugin --profile web add "github:PerryLink/dsh-claude-move#master"` —— 纯 ESM，无需 `prepare` 或 `allowBuilds`。
- **npm 渠道**（已发布版本）：`dsh plugin --profile web add dsh-claude-move`。
- **tarball 渠道**：在本仓库执行 `npm pack`，然后 `dsh plugin --profile web add ./dsh-claude-move-<version>.tgz`。
- **卸载**：从 profile 的 bundles 中删除 `claude-move` 行并重启 `dsh`。导入的会话保留；插件只写自己的缓存（`$DSH_HOME/claude-move/`）与 `claudecode` 工作区文件夹，绝不触碰 Claude 源数据。

## 配置

全部可选，可在 cordis.yml 中覆盖。

| 键 | 默认值 | 含义 |
|---|---|---|
| `claudeHome` | `$CLAUDE_CONFIG_DIR` 或 `~/.claude` | Claude 数据根 |
| `workspaceMode` | `claudecode` | `claudecode`（单一专用工作区）· `per-project`（按源 cwd 各建工作区） |
| `claudecodeDir` | `$DSH_HOME/claudecode` | `claudecode` 工作区文件夹（插件唯一会创建的文件夹） |
| `scanGit` | `true` | Git 探测级别：`true`（完整）· `'branch'`（零 git 调用）· `false` |
| `gitTimeoutMs` | `5000` | Git 子进程超时 |
| `scanConcurrency` | `8` | 并行项目扫描上限 |
| `maxTranscriptBytes` | `67108864` | 流式导入阈值（超出则分块） |
| `excludeProjects` | `[]` | 要跳过的 slug 子串 |
| `enableMemory` | `true` | 将记忆作为实时提示词段落注入 |
| `memoryMaxBytes` | `8192` | 记忆段落上限 |
| `memoryScope` | `current-project` | `current-project` · `all`（当前项目优先） |
| `enableSkills` | `true` | 将 Claude 技能注册为 DSH 技能 |
| `maxSkills` | `30` | 技能数量上限 |
| `extraSkillDirs` | `[]` | 额外技能目录 |
| `enableInstructions` | `true` | 注入全局 + 项目 `CLAUDE.md` |
| `resumeMaxChars` | `2048` | 交接摘要字符上限 |
| `resumeMode` | `inject` | `inject`（交接摘要）· `agents`（ctx.agents.resume） |
| `enableWebPanel` | `true` | 注册 `/api/claude-move/*` 面板路由 |
| `importConcurrency` | `4` | 每批并行读取 + 转换 |
| `requireApproval` | `true` | 向导写入请求 `ctx.approval`（仅 allowed-once） |
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
| `move_detect` / `move_preview` / `move_run` | 工具 | 四来源向导：扫描、带 diff 的逐项计划、审批后执行 |
| `/claude-import-all` | 命令 | 扫描 → 导入全部 → 报告 |
| `/resume-claude` | 命令 | 续聊一个 Claude 会话（latest、id 或关键字） |
| `/claude-move-reset` | 命令 | 重置插件缓存（导入的会话保留） |
| `/move` | 命令 | 一次性四来源向导 |
| Web 迁移面板 | 客户端 | 带进度、取消、分页、打开会话的浮动面板 |

## 权限与数据

- **权限**：workshop 清单声明 `filesystem:read` 与 `filesystem:write`。
- **读取** `~/.claude`（transcript、记忆、技能、`CLAUDE.md`、`settings.json`）—— 严格只读 —— 以及它导入到的项目目录。
- **写入** 通过公开 `sessionPersistence` 服务写 DSH 会话日志（仅 create + append，绝不删除/改写/归档）、工作区注册表记录、`$DSH_HOME/claude-move/` 下的缓存，以及 `claudecode` 工作区文件夹。
- **绝不** 修改 Claude 源文件、触碰其他应用数据或访问网络。**不读取或传输任何凭据**。

## 安全边界

- **源文件只读；DSH 日志只追加**（仅 `create` + `append`）。
- **外部 transcript 是不可信输入** —— 其中的内容绝不执行；system/developer/thinking 内容绝不进入续聊交接。
- **仅公开服务** —— `sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`；不改引擎或 UI。
- **密钥仅按位置报告**；`permission`/`permission-mode`/`queue-operation` 记录只计数、不导入。
- **向导写入审批门控** —— 只要不是 `allowed-once`，就是零写入。

## 已知限制

- 标题来自 `custom-title`/`ai-title`/首条提示；Claude `summary` 记录会被报告，但不映射为 DSH 压缩节点。
- `thinking` 块作为 `reasoning` 内容保留，但绝不进入续聊交接。
- 被中断的工具调用会以合成的错误结果修复（报告为 `repaired.synthesized`）。
- 在没有流式 `fs.streamText` 接口的宿主上，超过 `maxTranscriptBytes` 的 transcript 会大声失败，而不是部分导入。
- 在 `workspaceMode: 'per-project'` 下，源目录已删除的会话仍能导入，但工作区挂载失败（保持未分组）。默认的 `claudecode` 工作区不依赖源目录。
- Web 面板是由插件自身 JSON 路由驱动的零构建浮动面板。

## 开发

```sh
npm install   # peer 依赖：@deepseek-ai/dsh-tools@0.1.0-rc.6、@deepseek-ai/cordis、schemastery
npm test      # node --test test/*.test.mjs
```

## 主题

`deepseek-harness`、`dsh-plugin`、`claude-code`、`migration`、`session-import`、`resume`

## 贡献者

- [@PerryLink](https://github.com/PerryLink) —— 创建者与维护者：导入管线、四来源迁移向导、Web 面板、文档、CI/CD 与发布。
- [@OLDnana1](https://github.com/OLDnana1) —— 对被中断工具调用损坏的根因分析，该损坏曾使导入会话在续聊时永久返回 HTTP 400。
- [@GooodWei](https://github.com/GooodWei) —— 发现 `README.md`（及任何无描述的 `.md`）被误注册为技能，从而破坏 DSH 技能加载。

## 许可证

[Apache License 2.0](LICENSE) © 2026 dsh-claude-move contributors
