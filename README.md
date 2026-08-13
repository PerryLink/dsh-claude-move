# dsh-claude-migrate

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：**Claude Code 全量迁移 + 无缝续聊**。安装后自动发现本机 Claude Code 的全部内容（历史 transcript、记忆、技能、全局指令、配置与项目状态），把「历史对话 + 个人信息」迁移进 DSH，让用户在新会话里无缝继续 Claude Code 的工作上下文。

> 状态：开发中（Phase 2/6 —— 历史对话导入已实现）。见 [PLAN.md](PLAN.md)。

## 功能路线

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 自动发现（`$CLAUDE_CONFIG_DIR`/`~/.claude`）+ 项目/会话/git/记忆/技能索引 + `claude_scan` 工具 + 增量缓存 | ✅ |
| 2 | 历史对话导入（`import_claude`：全保真映射、幂等、批量、强制重导入、行号报错、工作区挂接、密钥告警、权限类统计） | ✅ |
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

import_claude { path: "~/.claude/projects/<slug>/<sessionId>.jsonl" }  # 单个会话
import_claude { path: "~/.claude/projects" }        # 目录批量（递归）
import_claude { path: "all" }                       # 全量批量
import_claude { path: "...", force: true }          # 归档旧导入并以 import-<src>-<n> 重建
```

- **扫描**返回结构化 JSON 索引：项目（slug/cwd/目录存在性/git 分支与脏状态）、会话（标题/起止时间/消息与工具调用数/畸形行数）、记忆、技能、全局 CLAUDE.md 与 settings.json；每个会话带 `import.status`（`none`/`imported`/`source-missing`）。
- **导入**全保真映射（turn/step/user/assistant/tool/call-result/reasoning），产物是可继续（resume）的平衡会话，按 cwd 自动挂接工作区；返回单文件或批量逐文件汇总（`imported`/`already-imported`/`skipped`/`failed`），畸形行带行号、疑似凭据只报位置（文件:行:类型）、权限类记录只统计不导入。

## 配置（cordis.yml，全部可选）

```yaml
- id: claude-migrate
  name: dsh-claude-migrate
  config:
    claudeHome: null          # 缺省自动定位 $CLAUDE_CONFIG_DIR / ~/.claude
    scanGit: true             # 探测 git 分支与脏状态
    maxTranscriptBytes: 67108864   # 单个 transcript 大小上限（导入与 oversized 标记共用）
    excludeProjects: []       # slug 子串排除，如 ['demo-']
```

## 卸载

从 profile 的 bundles 移除 `claude-migrate` 行并重启 dsh。已导入会话保留在 DSH 数据目录，不受卸载影响；本插件只在 `$DSH_HOME/claude-migrate/` 写索引缓存与导入映射，不触碰 Claude 源数据。

## 安全边界

- 源文件一律只读，绝不改写；DSH 会话日志 append-only（只 `create` + `append`）。
- 外部 transcript 视为不可信输入：不执行其中任何内容；system/developer/thinking 不进入续聊摘要。
- 不修改 DSH 引擎、官方 UI 包、apiproxy；只通过公开服务（sessionPersistence / workspaceRegistry / tools / commands / systemPrompt / skills / webServer）工作。
- 疑似密钥/凭据只报告位置不展示内容；`permission`/`permission-mode`/`queue-operation` 类记录只统计不导入。

## 合规

见 [COMPLIANCE.md](COMPLIANCE.md)：逐条对照 deepseek-harness 仓库约束、官网、文档站 develop 教程、Cordis 与论文。

## 优化研究

见 [OPTIMIZATION.md](OPTIMIZATION.md)：扫描/导入/注入的性能与架构优化候选。

## 复用与出处（MIT 生态）

- 转换核心 vendored 自 [Nwflower/dsh-chat-import](https://github.com/Nwflower/dsh-chat-import)（MIT）。
- 发现约定与安全模型沿用 [Demogorgon314/dsh-resume-plugin](https://github.com/Demogorgon314/dsh-resume-plugin)（MIT；其 session_reader.py 另有 Apache-2.0 上游出处，见 THIRD_PARTY_NOTICES.md）。
- memory/skills 注入与 frontmatter 解析沿用 [YYTbit/dsh-plugin-claude-bridge](https://github.com/YYTbit/dsh-plugin-claude-bridge)（MIT）。

详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 开发

```sh
npm install   # 安装 peer 依赖（cordis、@deepseek-ai/dsh-tools、schemastery）
npm test      # node --test：convert（vendored + 扩展）单测 + discovery 单测 + mock ctx 集成
```

## License

MIT，见 [LICENSE](LICENSE)。
