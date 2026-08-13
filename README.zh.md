# dsh-claude-move

**Claude Code → DeepSeek Harness：全量迁移 + 无缝续聊。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-3fb950)](https://github.com/topics/dsh-plugin)

[English](README.md) | 中文 | [Español](README.es.md) | [Português](README.pt.md) | [हिन्दी](README.hi.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件：安装后自动发现本机 Claude Code 的全部内容——历史 transcript、记忆、技能、全局指令、settings 与项目状态——把「历史对话 + 个人信息」迁移进 DSH，让你在 DeepSeek Harness 里**无缝继续** Claude Code 的会话与工作上下文。

> 状态：开发中（Phase 5/6 —— Web 面板已完成）。路线图与设计：[PLAN.md](PLAN.md)。

## 它能做什么

- **自动发现**：定位 Claude 数据根目录（`$CLAUDE_CONFIG_DIR`，缺省 `~/.claude`），索引全部项目/会话（标题、起止时间、消息与工具调用数）、目录与 git 状态（分支、脏文件）、记忆、技能、全局 `CLAUDE.md` 与 `settings.json`；增量缓存只重读变化文件。
- **历史导入**：全保真事件映射（`turn/start → step/start → user/message → assistant/message → tool/call → tool/result → step/end → turn/end`），产出**平衡、可继续（resume）**的 DSH 会话并挂接原项目工作区；幂等、批量、强制重导入、畸形行带行号。
- **个人上下文持续生效**：记忆作为动态系统提示词段每次请求重读；Claude 技能注册为真正的 DSH 技能；全局与项目级 `CLAUDE.md` 注入前置段（项目优先）；`settings.json` 翻译为 DSH 配置建议。

## 路线图

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 自动发现 + `claude_scan` 工具 + 增量缓存 | ✅ |
| 2 | 历史导入（`import_claude`：映射、幂等、批量、强制重导入、行号报错、工作区挂接） | ✅ |
| 3 | 个人信息（memory 注入、Claude 技能 provider、CLAUDE.md 段、settings 翻译） | ✅ |
| 4 | 一键命令 `/claude-import-all` 与 `/resume-claude`（交接摘要 + 安全模型） | ✅ |
| 5 | Web UI「Claude 迁移」面板（`dsh.client`） | ✅ |
| 6 | 发布梳理：双语文档、架构图、打包、演示 | 🚧 |

## 安装

```sh
# 从 GitHub
dsh plugin --profile web add -w github:PerryLink/dsh-claude-move

# 本地源码（开发推荐）
dsh plugin --profile web add -w link:/path/to/dsh-claude-move

# 打包 tarball
dsh plugin --profile web add -w ./dsh-claude-move-0.1.0.tgz
```

纯 ESM、无构建步骤：git 安装无需 `prepare` 脚本与 `allowBuilds` 白名单。官方打包安装指南见[这里](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)。

## 使用

在挂载本插件的会话里调用工具：

```
claude_scan                          # 全量扫描（增量缓存）
claude_scan { path: "~/.claude/projects/<slug>" }   # 局部扫描
claude_scan { refresh: true }        # 忽略缓存全量重扫

import_claude { path: "~/.claude/projects/<slug>/<sessionId>.jsonl" }  # 单个会话
import_claude { path: "~/.claude/projects" }        # 目录批量（递归）
import_claude { path: "all" }                       # 全量批量
import_claude { path: "...", force: true }          # 归档旧导入并以 import-<src>-<n> 重建
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
- **导入**全保真映射 user/assistant/tool/thinking，产物是可继续的平衡会话并按 cwd 挂接工作区；批量逐文件汇总（`imported`/`already-imported`/`skipped`/`failed`），畸形行带行号、疑似凭据只报位置（文件:行:类型）、权限类记录只统计不导入。
- **个人上下文自动生效（无需导入动作）**：
  - 记忆：全部 `projects/*/memory/*.md` 注入动态上下文段，每次请求按 mtime 重读（新记忆即时生效），`feedback > project > reference > user` 排序，默认 8KB 上限；
  - 技能：`~/.claude/skills/**/SKILL.md`（+ 扁平 `*.md`）注册为 DSH 技能（kebab 归一化、冲突加后缀、上限 30），catalog 注入与 `skill` 工具由 DSH 负责；
  - 指令：全局 `~/.claude/CLAUDE.md` + 当前会话 cwd 的 `.claude/CLAUDE.md` 注入前置段（项目优先）。

## 配置（全部可选，可在 cordis.yml 覆盖）

```yaml
- id: claude-move
  name: dsh-claude-move
  config:
    claudeHome: null            # 缺省自动定位 $CLAUDE_CONFIG_DIR / ~/.claude
    scanGit: true               # 探测 git 分支与脏状态
    maxTranscriptBytes: 67108864
    excludeProjects: []         # slug 子串排除，如 ['demo-']
    enableMemory: true
    memoryMaxBytes: 8192
    enableSkills: true
    maxSkills: 30
    extraSkillDirs: []
    enableInstructions: true
    resumeMaxChars: 2048      # 交接摘要字符上限
    enableWebPanel: true      # 注册 /api/claude-move/* 面板路由
```

## 卸载

从 profile 的 bundles 移除 `claude-move` 行并重启 dsh。已导入会话保留在 DSH 数据目录；本插件只在 `$DSH_HOME/claude-move/` 写索引缓存与导入映射，绝不触碰 Claude 源数据。

## 兼容性

- 目标 `dsh 0.1.0-rc.6`（web profile）；peer 依赖锁定 rc.6；Node `^22.19 || >=24`。
- 最后验证 **2026-08-13**（Windows / Node 22，针对 `@deepseek-ai/dsh@0.1.0-rc.6`）：tarball 从零安装、真实扫描（40 项目 / 2387 会话）、真实批量导入 13/13 + 幂等重导入 13/13、工作区挂接与持久化产物确认。macOS/Linux 待验证。
- 开发者预览窗口期：锁定版本，DSH 升级后重新验证。

## 权限与数据

- **读取** `~/.claude`（transcript、记忆、技能、CLAUDE.md、settings.json）——严格只读——以及导入目标项目目录（工作区挂接）。
- **写入** 经公开 `sessionPersistence` 服务的 DSH 会话日志（append-only）、工作区注册表记录，以及插件自有缓存 `$DSH_HOME/claude-move/`（扫描书签 + 导入映射）。
- **绝不** 改写 Claude 源文件、触碰其它应用数据、访问网络。
- **不读取、不传输任何凭据**；transcript 中的疑似密钥只报告位置。

## 排障

- 行未生效：`dsh --profile <p> --dump-config` 应显示 `# == dsh-claude-move`；重新执行 `dsh plugin --profile <p> add -w ...`。
- web 启动后无响应：`dsh plugin add` 初始化的新 profile 只有 `dsh-base`，需在 `dsh.profile.bundles` 补 `@deepseek-ai/dsh-web-app`（装进已有 `web` profile 无需处理）。
- 面板路由 404：仅当 `enableWebPanel: true` 且组成包含 web 服务器时提供；检查启动日志 FAILED。
- 导入报「transcript 过大」：调高 `maxTranscriptBytes` 或单独导入该文件。
- 日志：启动失败打印在 `dsh` 控制台；插件以 `[claude-move]` 前缀输出工作区/映射错误。

## 安全边界

- 源文件一律只读；DSH 会话日志 append-only（只 `create` + `append`）。
- 外部 transcript 视为不可信输入：不执行其中任何内容；system/developer/thinking 不进入续聊摘要。
- 不修改 DSH 引擎、官方 UI 包、apiproxy；只通过公开服务（`sessionPersistence` / `workspaceRegistry` / `tools` / `commands` / `systemPrompt` / `skills` / `webServer`）工作。
- 疑似密钥/凭据只报位置不展示内容；`permission`/`permission-mode`/`queue-operation` 类记录只统计不导入。

## 合规与优化

- [COMPLIANCE.md](COMPLIANCE.md) — 对照官方插件约束的逐条审计（deepseek-harness 仓库与文档、[deepseek.com/harness](https://www.deepseek.com/harness/)、[开发者文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)、[Cordis](https://github.com/cordiverse/cordis) 与 [Cordis 论文](https://github.com/cordiverse/paper)）。
- [OPTIMIZATION.md](OPTIMIZATION.md) — 实测基线 + 分优先级的优化候选（并行扫描/导入、gitBranch 复用、流式导入、增量同步模式等）。
- [ARCHITECTURE.md](ARCHITECTURE.md) — 架构图与完整数据映射表。
- [RELEASE.md](RELEASE.md) — 发布清单与验收证据。

## 复用与出处（MIT 生态）

- 转换核心 vendored 自 [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import)（MIT）。
- 发现约定与安全模型沿用 [Demogorgon314/dsh-resume-plugin](https://github.com/Demogorgon314/dsh-resume-plugin)（MIT；其 session_reader.py 另有 Apache-2.0 上游出处，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）。
- memory/skills 注入与 frontmatter 解析沿用 [YYTbit/dsh-plugin-claude-bridge](https://github.com/YYTbit/dsh-plugin-claude-bridge)（MIT）。

## 开发

```sh
npm install   # peer 依赖：@deepseek-ai/cordis、@deepseek-ai/dsh-tools@0.1.0-rc.6、@deepseek-ai/schemastery
npm test      # node --test：convert（vendored + 扩展）、discovery、import/report、context、settings
```

## Model Experience

- 模型可见面 = 两个工具的 description/schema 与输出：`claude_scan` 返回结构化索引，`import_claude` 返回逐文件汇总与告警位置；工具结果本身即落盘的 `tool/result`，全部可重建。
- 无隐藏模型文本；memory/CLAUDE.md 段注册于 `ctx.systemPrompt`（提示词组装，可随会话日志重建）。

## 已知局限

- 标题只取 `custom-title`/`ai-title`/首问；Claude `summary` 记录不作为标题。
- `thinking` 块保留在导入日志的 `reasoning` 内容块中，但不进入续聊摘要。
- 权限类记录只统计不导入；DSH 权限预设建议随报告生成。
- 超过 `maxTranscriptBytes` 的 transcript 响亮失败而非部分导入（保真优先）；流式分块导入在路线图上。
- 源目录已删除的会话仍可导入，但工作区挂接失败（留在「未分组」，报告 `workspace.attached: false`）。
- 批量导入中断可安全重跑（幂等、append-only）。
- Web 面板为零构建悬浮面板，走插件自注册 JSON 路由；不使用 shell 内部 UI slot（刻意不依赖 rc.6 未文档化内部面）。

## 相关链接

- DeepSeek Harness：[仓库](https://github.com/deepseek-ai/deepseek-harness) · [官网](https://www.deepseek.com/harness/) · [开发者文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)
- 插件生态：[`dsh-plugin` topic](https://github.com/topics/dsh-plugin) · [Discord](https://discord.gg/Ycq5dCaS4)

## License

MIT — 见 [LICENSE](LICENSE)。第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。安全问题请通过 GitHub Security Advisories（仓库 Settings → Security）私下报告。
