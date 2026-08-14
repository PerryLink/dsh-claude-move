# RELEASE.md — 发布与验收清单

## 0.2 变更后的待办（本机已完成的除外）

- [ ] **真实运行时复验**（隔离 DSH_HOME，当前 harness checkout）：`--dump-config`、web 启动无 FAILED、面板五路由（index/import/progress/job/reset）、流式导入路径（`streamText` 面）、`ctx.jobs` 接入与取消、客户端 `sessions.refresh/open` 免刷新。单测 143/143 全绿（mock 面），真实运行时证据待有环境的机器补录。
- [ ] **有 API key 的机器验收**：导入后「点开续聊」的模型回合（步骤不变，见下）。
- [ ] **npm 发布**：`private: true` 已移除，`npm publish` 可用；发布前跑 `npm pack --dry-run --json` 核对文件清单（新增 `lib/imports-store.mjs` 已含在 `files: ["lib"]`）。
- [ ] **上游协作提案（B6）**：向 deepseek-harness GitHub Discussions 提 `SessionHeader.origin: 'import'` 提案——让会话列表 UI 可标注「外部导入」来源。草案要点：cold 导入经公开 `sessionPersistence.create` 落盘，目前 UI 无法区分导入会话与原生会话；建议 `origin` 增加 `'import'` 值（现状仅 `'subagent'`），本插件落地后即写入 `meta.origin`。官方未落地前本插件不改引擎、不自行扩展该字段。

## 发布前检查（0.1.0 本机已全部通过）

- [x] `npm test`：**143/143** 用例全绿（0.1.0 的 100 例 + A1-A7/B1-B5/C1-C5/D1-D6 的新增覆盖：并发 imports 串行、半建会话恢复、resume 快路径、skills cwd/signal、memoryScope、listSnapshots 清理、并行扫描确定性、gitBranch 三级、流式转换器分块/续写、CSRF、ctx.jobs 透传、缓存重置、索引裁剪、双语描述与面板字典）。
- [x] `npm pack` 发布面：tarball 含 index.mjs、lib/*（含 imports-store.mjs）、client/client.js、assets/social-card.png、cordis.patch.yml、五语 README、CHANGELOG、LICENSE、THIRD_PARTY_NOTICES、package.json，**不含** dev/、test/、node_modules。
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
| Windows/macOS/Linux 各至少一名开发者验证 | ✅ CI 矩阵（`test.yml` linux/macos/windows × Node 22）自动验证；本机 Windows 实测 | 143/143 跨平台用例 |
| `npm test` 通过；卸载不污染原数据 | ✅ | 143/143；源文件只读、缓存仅 `$DSH_HOME/claude-move/` |
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
