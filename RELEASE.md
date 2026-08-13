# RELEASE.md — 发布与验收清单

## 发布前检查（本机已全部通过）

- [x] `npm test`：**100/100** 用例全绿（convert/discovery/import/context/skills/settings/handoff/commands/routes + 客户端 bundle 契约 + 复制式迁移/增量续写/工作区镜像/轮次内变化 + exec.signal 中止 + 并发确定性）。
- [x] `npm pack` 发布面：tarball **21 项**（index.mjs、lib/*、client/client.js、assets/social-card.png、cordis.patch.yml、五语 README、CHANGELOG、LICENSE、THIRD_PARTY_NOTICES、package.json），**不含** dev/、test/、node_modules。
- [x] tarball 从零安装：`dsh plugin --profile <p> add -w ./dsh-claude-move-0.1.0.tgz` → `--dump-config` 出现 `# == dsh-claude-move` 层。
- [x] web 启动无 FAILED；`__DSH_BOOT__` 含客户端条目；`/plugins/dsh-claude-move/client.js` 正常伺服。
- [x] 真实数据验证（隔离 DSH_HOME）：
  - 扫描：40 项目 / 2387 会话 / 7 技能（~12s，增量缓存生效）；
  - 批量导入 13 个真实会话：13/13 成功、13 个唯一 DSH id（同源 sessionId 冲突自动后缀避让，零历史丢失）；
  - 重导入：13/13 `already-imported`（幂等）；
  - `workspace.attached=true`（挂接原项目工作区）；`sessions/<cwd-编码>/import-…/session.jsonl.zstd` 落盘；重扫标注 `imported`。

## 任务书验收对照

| 验收标准 | 状态 | 证据 |
|---|---|---|
| 仅 `dsh plugin add` 后一条命令发现全部会话并列出项目/目录/git 状态 | ✅ | `/claude-import-all` 命令 + `claude_scan` 工具；真实 40 项目索引含 git 分支/脏行数 |
| 任一会话导入后消息/工具/思考块完整、可续聊、工作区挂接正确 | ⚠️ 导入与挂接已实测 ✅；**「点开续聊」的模型回合需有 API key 的机器验证**（本机无 key，步骤见下） | 平衡事件日志 + `workspace.attached=true` + 持久化产物 |
| 记忆、技能、CLAUDE.md 在续聊中生效、新记忆即时生效 | ✅（注册与注入已实测；模型回合同上待 key 机器） | systemPrompt 段 + SkillProvider 注册于真实 boot；单测覆盖渲染与缓存 |
| 重复导入幂等；畸形 JSONL 不中断且报告行号 | ✅ | 真实重导入 13/13 already-imported；`skippedLines[{line,error}]` |
| Windows/macOS/Linux 各至少一名开发者验证 | ⚠️ Windows 已验证（本机）；macOS/Linux 待验证（纯 Node API，无平台专用依赖） | — |
| `npm test` 通过；卸载不污染原数据 | ✅ | 100/100；源文件只读、缓存仅 `$DSH_HOME/claude-move/` |
| 交付物 1-4 | ✅/⚠️ | 仓库 ✅；README（五语）✅；测试与 fixtures ✅；演示 GIF 见 `docs/`（发布时录制） |

## 待有 key 机器的验收步骤（模型续聊回合）

```sh
dsh plugin --profile web add -w <github|tarball>
dsh web
# 1. Web UI 打开「🐳 Claude 迁移」面板 → 导入任一会话 → 刷新会话列表
# 2. 点开该会话发送任意消息 → 应能基于导入历史继续（模型可见历史、标题/工作区正确）
# 3. 对话中调用 /resume-claude latest → 交接摘要注入后继续
# 4. 确认系统提示词包含 Claude 记忆与 CLAUDE.md 段（Trajectory 视图可查）
```

## 交付物状态与 GIF 录制前提

- 交付物 1-3（源码仓库 / README / 测试与 fixtures）：✅ 完成。
- 交付物 4（演示记录）：GIF 按官方 `record-browser-gif` 技能规范录制。本机环境缺 **ffmpeg/ffprobe** 与浏览器驱动（playwright），且无 `DEEPSEEK_API_KEY`（真实模型回合演示必需）——按技能规则如实报备、不安装软件、不用 fixture 替代。录制前提：python3 + ffmpeg/ffprobe + 浏览器驱动 + 真实 key；故事板：启动 web → 打开「🐳 Claude 迁移」面板 → 扫描真实数据 → 单会话「导入并继续」→ 进度完成 + 徽标「已导入」→ 刷新会话列表。

## 发布步骤

1. ✅ 已推送到 GitHub：https://github.com/PerryLink/dsh-claude-move（public，master，topic 已标注 dsh-plugin）。
2. ✅ GitHub 项目面：CI（`.github/workflows/test.yml`，Node 22 全量测试 + README 徽标）、Issue 模板（bug/feature）、社交分享卡（`assets/social-card.png`，README 首图 → 链接预览卡）、CHANGELOG.md、package.json 的 repository/homepage/bugs 元数据。
3. ✅ 仓库 About 侧：topics 已设置（`dsh`、`dsh-plugin`、`claude-code`、`deepseek-harness`、`migration`、`claude`、`resume`、`session-import`）。剩余手动项：Settings → Social preview 指定 `assets/social-card.png` 作为社交预览图。
4. ✅ 已打 tag `v0.1.0` 并创建 GitHub Release（Release Notes 引用 CHANGELOG 与本文验收表）：https://github.com/PerryLink/dsh-claude-move/releases/tag/v0.1.0
5. 可选 npm 发布：`npm publish`（bundle 形态；`dsh plugin add dsh-claude-move` 即可安装）。

## 已知局限（发布版如实说明）

- 单 transcript 超 `maxTranscriptBytes`（默认 64MiB）响亮拒绝（保真优先）；流式分块导入在路线图。
- 面板为自建悬浮面板，不使用 shell 内部 slot（rc.6 未文档化面）；`enableWebPanel: false` 可关闭。
- 命令与面板为 host 面功能，headless profile 亦可用工具/命令（面板路由自动跳过）。
- 新 profile 由 `dsh plugin add` 初始化时只有 dsh-base，需手动补 `@deepseek-ai/dsh-web-app` bundle（安装到既有 web profile 无此问题）。
