# AGENTS.md

`dsh-claude-move` 是 DeepSeek Harness 的 Host 插件：把 Claude Code 的历史 transcript、记忆、技能与全局指令迁移进 DSH 并可无缝续聊。DSH 哲学是 **everything is a plugin**——本仓库只做插件，不碰引擎。改代码前先读 `README.md`（对外契约）、`PLAN.md`（实施方案）与 `test/`（现有行为）。

## 仓库布局：发布面 / 本地工程面

根目录只放发布到 GitHub / npm 的文件；本地工程文件一律收进 `dev/`（gitignore，永不提交）。

```
index.mjs            插件入口（唯一 host 面文件）：注册 claude_scan 等工具/命令/注入
lib/convert.mjs      转换核心（vendored + 扩展，零 DSH 依赖，可独立单测）
lib/discovery.mjs    自动发现：定位/流式扫描/索引/增量缓存（零 DSH 依赖）
lib/frontmatter.mjs  Claude Markdown frontmatter 解析（零依赖）
lib/context.mjs      同步注入核心：memory 渲染与文件缓存（零依赖）
lib/skills-provider.mjs  Claude 技能 SkillProvider（零依赖）
lib/settings.mjs     settings.json 翻译（零依赖）
lib/report.mjs       导入报告：密钥扫描/权限统计（零依赖）
cordis.patch.yml     bundle 声明（insert claude-move）
package.json         npm 元数据；files 白名单 = 发布内容
README.md            英文主介绍（GitHub 默认页）
README.{zh,es,pt,hi}.md   中/西/葡/印地语介绍（顶部互链）
PLAN.md / COMPLIANCE.md / OPTIMIZATION.md   方案与审计（行为变更必须同步）
LICENSE / THIRD_PARTY_NOTICES.md   MIT + 复用出处标注
test/                单测 + mock ctx 集成测试（进 GitHub，不进 npm 包）
dev/                 ❌ 本地工程面：冒烟脚本、夹具、演示——永不提交
```

- 新增被 `index.mjs` import 的模块必须同步加进 `package.json` 的 `files`。
- **行为变更需同步五语 README**：以 README.md（英文）为源，其余四语同 commit 更新。
- **永不提交**：`dev/`、`node_modules/`、真实用户 transcript（含敏感内容）、任何凭据/密钥。

## 命令

```sh
npm install   # 安装 peer 依赖（@deepseek-ai/dsh-tools@0.1.0-rc.6、schemastery）
npm test      # node --test 跑 test/*.test.mjs
```

无构建步骤：纯 ESM，`index.mjs`/`lib/` 即发布产物。

## 提交纪律

- conventional commit 前缀：`feat:` / `fix:` / `refactor:` / `chore:` / `docs:` / `test:`，中文描述。
- 一个逻辑变更一个 commit；按任务书「模块拆分」：每完成一个 F 需求模块跑 `npm test` 后提交。
- 提交前必过：`npm test` 全绿；`git status` 无杂物；`git diff --cached --check` 无空白错误。
- 行为变更同 commit 更新 README 与测试。

## DSH 插件约束

- **只消费 host 公开服务**：`tools`、`sessionPersistence`、`workspaceRegistry`、`commands`、`systemPrompt`、`skills`、`webServer`。不发布新服务（除非确有必要并在 PR 说明）。
- **插件，不是引擎改动**：不修改 DSH 引擎 / apiproxy / 官方 UI 包。
- **会话日志 append-only**：只 `create` + `append`，绝不改写历史事件；强制重导入走 archive + 新 id。
- **模型可见 ⟺ 落盘**：进入模型上下文的任何内容必须能从会话日志重建。
- **源文件只读**：绝不写入 Claude 数据目录；缓存只写 `$DSH_HOME/claude-move/`。
- **systemPrompt 提供者必须同步**（rc.6 不 await）：用 readFileSync + mtime 缓存。
- **失败要大声**：畸形 JSONL 行计数并报行号，绝不静默吞掉；未知 Claude 字段宽容跳过并计数。

## 质量约定

- 文件以恰好一个换行结尾；空 `catch` 说明吞掉什么且 `try` 只包一条语句；不注释显而易见的事实。
- `lib/` 保持零 DSH 依赖：任何 DSH 依赖只允许出现在 `index.mjs`。
- 测试描述行为而非背书正确性；fixtures 用合成数据，永不掺真实 transcript。
- 复用他人代码处标注 license 与出处（THIRD_PARTY_NOTICES.md + 文件头注释）。

## 编辑本文件

规则保持自包含；改完须与仓库现状一致。
