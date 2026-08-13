# dsh-claude-migrate

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：**Claude Code 全量迁移 + 无缝续聊**。安装后自动发现本机 Claude Code 的全部内容（历史 transcript、记忆、技能、全局指令、配置与项目状态），把「历史对话 + 个人信息」迁移进 DSH，让用户在新会话里无缝继续 Claude Code 的工作上下文。

> 状态：开发中（Phase 1/6 —— 自动发现 + `claude_scan` 已实现）。见 [PLAN.md](PLAN.md)。

## 功能路线

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 自动发现（`$CLAUDE_CONFIG_DIR`/`~/.claude`）+ 项目/会话/git/记忆/技能索引 + `claude_scan` 工具 + 增量缓存 | ✅ |
| 2 | 历史对话导入（`import_claude`：全保真映射、幂等、批量、强制重导入、行号报错、工作区挂接） | 🚧 |
| 3 | 个人信息搬移（memory 动态注入、Claude 技能 provider、CLAUDE.md 段、settings.json 翻译建议） | 🚧 |
| 4 | 一键命令 `/claude-import-all` 与 `/resume-claude`（交接摘要 + 安全模型） | 🚧 |
| 5 | Web UI「Claude 迁移」面板（dsh.client） | 🚧 |
| 6 | 文档收尾、打包、演示 | 🚧 |

## 安装

```sh
# 从 GitHub（插件发布后）
dsh plugin --profile web add -w github:<owner>/dsh-claude-migrate

# 本地源码（开发推荐）
dsh plugin --profile web add -w link:/path/to/dsh-claude-migrate
```

## 使用

在挂载本插件的会话里调用工具：

```
claude_scan                          # 全量扫描（增量缓存，重复扫描只读变化文件）
claude_scan { path: "~/.claude/projects/<slug>" }   # 局部扫描
claude_scan { refresh: true }        # 忽略缓存全量重扫
```

返回结构化 JSON 索引：项目（slug/cwd/目录存在性/git 分支与脏状态）、会话（标题/起止时间/消息与工具调用数/畸形行数）、记忆、技能、全局 CLAUDE.md 与 settings.json。每个会话带 `import.status`（`none`/`imported`/`source-missing`）。

## 配置（cordis.yml，全部可选）

```yaml
- id: claude-migrate
  name: dsh-claude-migrate
  config:
    claudeHome: null          # 缺省自动定位 $CLAUDE_CONFIG_DIR / ~/.claude
    scanGit: true             # 探测 git 分支与脏状态
    maxTranscriptBytes: 67108864
    excludeProjects: []       # slug 子串排除，如 ['demo-']
```

## 卸载

从 profile 的 bundles 移除 `claude-migrate` 行并重启 dsh。已导入会话保留在 DSH 数据目录，不受卸载影响；本插件只在 `$DSH_HOME/claude-migrate/` 写索引缓存与导入映射，不触碰 Claude 源数据。

## 安全边界

- 源文件一律只读，绝不改写；DSH 会话日志 append-only。
- 外部 transcript 视为不可信输入：不执行其中任何内容；system/developer/thinking 不进入续聊摘要。
- 不修改 DSH 引擎、官方 UI 包、apiproxy；只通过公开服务（sessionPersistence / workspaceRegistry / tools / commands / systemPrompt / skills / webServer）工作。
- 疑似密钥/凭据只报告位置不展示内容；`permission` 类记录只统计不导入。

## 复用与出处（MIT 生态）

- 转换核心 vendored 自 [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import)（MIT）。
- 发现约定与安全模型沿用 [Demogorgon314/dsh-resume-plugin](https://github.com/Demogorgon314/dsh-resume-plugin)（MIT；其 session_reader.py 另有 Apache-2.0 上游出处，见 THIRD_PARTY_NOTICES.md）。
- memory/skills 注入与 frontmatter 解析沿用 [YYTbit/dsh-plugin-claude-bridge](https://github.com/YYTbit/dsh-plugin-claude-bridge)（MIT）。

详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 开发

```sh
npm install   # 安装 peer 依赖（@deepseek-ai/dsh-tools、schemastery）
npm test      # node --test：convert 单测（vendored）+ discovery 单测 + mock ctx 集成
```

## License

MIT，见 [LICENSE](LICENSE)。
