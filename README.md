# dsh-claude-move

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：**Claude Code 全量迁移 + 无缝续聊**。安装后自动发现本机 Claude Code 的全部内容（历史 transcript、记忆、技能、全局指令、配置与项目状态），把「历史对话 + 个人信息」迁移进 DSH，让用户在新会话里无缝继续 Claude Code 的工作上下文。

> 状态：开发中（Phase 3/6 —— 个人信息搬移已实现）。见 [PLAN.md](PLAN.md)。

## 功能路线

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 自动发现（`$CLAUDE_CONFIG_DIR`/`~/.claude`）+ 项目/会话/git/记忆/技能索引 + `claude_scan` 工具 + 增量缓存 | ✅ |
| 2 | 历史对话导入（`import_claude`：全保真映射、幂等、批量、强制重导入、行号报错、工作区挂接、密钥告警、权限类统计） | ✅ |
| 3 | 个人信息搬移（memory 动态注入、Claude 技能 provider、CLAUDE.md 段、settings.json 翻译建议） | ✅ |
| 4 | 一键命令 `/claude-import-all` 与 `/resume-claude`（交接摘要 + 安全模型） | 🚧 |
| 5 | Web UI「Claude 迁移」面板（dsh.client） | 🚧 |
| 6 | 文档收尾、打包、演示 | 🚧 |

## 安装

```sh
# 从 GitHub（插件发布后）
dsh plugin --profile web add -w github:<owner>/dsh-claude-move

# 本地源码（开发推荐）
dsh plugin --profile web add -w link:/path/to/dsh-claude-move
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

- **扫描**返回结构化 JSON 索引：项目（slug/cwd/目录存在性/git 分支与脏状态）、会话（标题/起止时间/消息与工具调用数/畸形行数）、记忆、技能、全局 CLAUDE.md 与 settings.json；每个会话带 `import.status`（`none`/`imported`/`source-missing`）；`settingsSuggestions` 给出 settings.json 的 DSH 翻译建议与无法映射项（F14）。
- **导入**全保真映射（turn/step/user/assistant/tool/call-result/reasoning），产物是可继续（resume）的平衡会话，按 cwd 自动挂接工作区；返回单文件或批量逐文件汇总（`imported`/`already-imported`/`skipped`/`failed`），畸形行带行号、疑似凭据只报位置（文件:行:类型）、权限类记录只统计不导入。
- **个人上下文自动生效（无需导入动作）**：
  - memory：全部 `projects/*/memory/*.md` 注入动态上下文段，每次请求按 mtime 重读（新记忆即时生效），`feedback > project > reference > user` 排序，默认 8KB 上限；
  - 技能：`~/.claude/skills/**/SKILL.md`（+ 扁平 `.md`）注册为 DSH 技能（名称 kebab 归一化、冲突加后缀、上限 30），catalog 注入与 `skill` 工具由 DSH 负责；
  - 指令：全局 `~/.claude/CLAUDE.md` + 当前会话 cwd 的 `.claude/CLAUDE.md` 注入前置段（项目级优先）。

## 配置（cordis.yml，全部可选）

```yaml
- id: claude-move
  name: dsh-claude-move
  config:
    claudeHome: null          # 缺省自动定位 $CLAUDE_CONFIG_DIR / ~/.claude
    scanGit: true             # 探测 git 分支与脏状态
    maxTranscriptBytes: 67108864   # 单个 transcript 大小上限（导入与 oversized 标记共用）
    excludeProjects: []       # slug 子串排除，如 ['demo-']
    enableMemory: true        # 注入 Claude memory 上下文段
    memoryMaxBytes: 8192      # memory 注入字节上限
    enableSkills: true        # 注册 Claude 技能 provider
    maxSkills: 30             # 技能目录条目上限
    extraSkillDirs: []        # 额外技能目录
    enableInstructions: true  # 注入全局/项目级 CLAUDE.md 段
```

## 卸载

从 profile 的 bundles 移除 `claude-move` 行并重启 dsh。已导入会话保留在 DSH 数据目录，不受卸载影响；本插件只在 `$DSH_HOME/claude-move/` 写索引缓存与导入映射，不触碰 Claude 源数据。

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

## Model Experience

- 模型可见面 = 两个工具的 description/schema 与其输出：`claude_scan` 返回结构化索引（模型据此挑选会话），`import_claude` 返回导入汇总（含行号与告警位置）。工具结果本身即落盘的 `tool/result`，可重建。
- 本插件不向模型注入任何隐藏文本；Phase 3 的 memory/CLAUDE.md 段将注册在 `ctx.systemPrompt`（提示词组装，随会话日志重建）。
- 无模型-可见 KV 缓存副作用：插件不参与 provider 请求组装。

## Known Limitations and Deferred Work

- 会话标题只取 `custom-title`/`ai-title`/首问，Claude 的 `summary` 记录不作为标题（与 resume-plugin 一致）。
- `thinking` 块保留在导入日志的 `reasoning` 内容块中，但不进入续聊摘要（Phase 4 的安全模型）。
- 权限类记录（`permission`/`permission-mode`/`queue-operation`）只统计不导入；DSH 权限预设建议见 Phase 3/4 报告。
- 单 transcript 超过 `maxTranscriptBytes` 时导入响亮失败而非部分导入（保真优先）；流式分块导入（内存 O(块)）列入优化路线。
- 源目录已删除的会话仍可导入，但挂接工作区会失败（保留为「未分组」），报告 `workspace.attached: false`。
- 批量导入中断可安全重跑：幂等跳过已完成文件（append-only 无中间态）。
- Web 面板与 `/resume-claude` 命令尚未实现（Phase 4/5）。

## License

MIT，见 [LICENSE](LICENSE)。
