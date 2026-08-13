# COMPLIANCE.md — 官方约束合规对照

dsh-claude-migrate 对照五个官方文档源的插件开发约束逐条审计。状态：✅ 满足 · ⚠️ 已计划/待验证 · N/A 不适用（附理由）。约束原文以官方文档为准；冲突时以官方仓库 `AGENTS.md` 为最高优先级。

## 1. [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（仓库 AGENTS.md / docs/）

| 官方约束 | 本插件 | 状态 |
|---|---|---|
| 一切皆插件；新行为挂已文档化扩展点，不改 agent-loop | 只注册 `ctx.tools`（后续 `commands`/`systemPrompt`/`skills`/`webServer`），不碰 agent-loop/引擎/apiproxy/官方 UI 包 | ✅ |
| 注册即 effect：贡献走 `ctx.effect()`/`ctx.on()`/服务 `register()`（返回 disposer） | 工具经 `ctx.tools.register()`（返回 disposer）；无手动清理 | ✅ |
| waterfall 监听器必须 `next()` | 不监听任何 waterfall 事件 | N/A（无监听） |
| 模型可见 ⟺ 已记录 | 工具描述/结果即落盘 `tool/result`；Phase 3 注入走 `ctx.systemPrompt` 组装（可重建）；Phase 4 交接摘要走 `agent.inject`（logged 持久上下文） | ✅（设计保证） |
| 类型化事件/服务 declaration merging；事件标注 `@mode` | 纯 JS 插件，不声明/不派发自定义事件与自定义服务 | N/A |
| 配置用 Schemastery；非法配置加载期响亮失败；不得硬编码可调参数 | `Config = Schema.object(...)`；全部可调参数（claudeHome/scanGit/maxTranscriptBytes/excludeProjects）可 cordis.yml 覆盖 | ✅ |
| 工具 DSL：`defineTool`、execute 只返回 `output.schema` 规范值、人读内容在 `output.render`、UI presenter 纯函数、尊重 `exec.signal` | defineTool + 输出 schema 经 `validateJsonSchemaValue` 校验；render 生成中文摘要；未定义 presenter（回退 generic 卡）；**exec.signal 尚未接入批量循环** | ⚠️ exec.signal 列入优化待办 |
| 可替换能力按三层接缝拆分；不提前拆 | 本插件是固定来源的迁移器，无可替换 provider 需求 | N/A |
| bundle 清单 `dsh.bundle.patch`；按 id 整行替换 config；`!!js` 双感叹号 | `dsh.bundle` 声明 ✅；不使用 `!!js`（无环境选择需求） | ✅ |
| 独立插件包：cordis 是 peerDependency；ESM；git 安装需 `prepare`+`allowBuilds`；发布带构建产物 | cordis/dsh-tools/schemastery 均 peer（锁 rc.6）；纯 ESM 无构建步骤 → git 安装免 `prepare`/`allowBuilds` | ✅ |
| 包 README 含 Model Experience / Known Limitations（仓库门禁惯例） | README 已含两段 | ✅ |
| 双语文档成对 | 计划 Phase 6：README.en.md + 中文双轨（i18n 结构） | ⚠️ 待办 |
| 测试：纯函数单测 + mock 集成 + 畸形/平台用例 | 52 用例：vendored convert + 扩展单测 + discovery 单测 + import/report mock 集成 + 畸形行/密钥/大小防护；三平台路径用例（locateClaudeHome/Windows 路径） | ✅ |
| 加载验证 `--dump-config` / 行为验证 | Phase 5 集成验证（真实 dsh web profile + 续聊实测） | ⚠️ 待验证 |

## 2. [deepseek.com/harness](https://www.deepseek.com/harness/)（官网开发者预览页）

| 官网承诺/要求 | 本插件 | 状态 |
|---|---|---|
| 能力皆插件、可替换可重组 | 迁移能力全部以插件注册表形式挂载，无 fork | ✅ |
| Cordis 内核管理挂载/卸载/依赖 | 依赖声明 `inject: ['tools']`，卸载自动撤销注册 | ✅ |
| 配置组合不改源码 | 全部行为参数化（cordis.yml） | ✅ |
| 每轮可追溯（append-only 日志） | 导入只 `create`+`append`，不篡改既有事件 | ✅ |
| 通过 GitHub 仓库 + 文档站 + `dsh-plugin` topic 生态分发 | keywords 含 `dsh-plugin`；README 引用官方文档；发布后标注 topic | ✅（发布后补 topic） |

## 3. [deepseek-harness.github.io/develop/basic/](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)（四篇教程）

| 教程条款 | 本插件 | 状态 |
|---|---|---|
| 第一个插件：导出 `name`/`apply(ctx)`；绝对路径 patch；`ctx.effect` 清理 | 函数式插件 ✅；README 给出 `dsh plugin add -w link:` 安装（bundle 形态） | ✅ |
| 构建工具：`defineTool`、parameters 推断校验、output.schema 规范值、output.render 模型内容、`inject: ['tools']` | 全部照做；两个工具输出均过 schema 校验 | ✅ |
| 插件配置：导出同名 Schemastery schema、默认值在 schema、非法配置加载失败、HMR 兼容 | `Config` schema 带默认值；注册即 effect → HMR 热替换自动清理 | ✅ |
| 打包安装：bundle（`dsh.bundle`）vs profile（`dsh.profile`）；层顺序 bundle→profile→home→`--patch`；三种安装方式；git 安装的 `prepare`/`allowBuilds` 坑 | 纯 ESM 无构建 → git/link/npm/tarball 全部免构建许可；README 覆盖安装与卸载、层覆盖语义 | ✅ |

## 4. [cordiverse/cordis](https://github.com/cordiverse/cordis)

| Cordis 契约 | 本插件 | 状态 |
|---|---|---|
| 插件 = 实现 Service 的对象（函数形态带可选 `inject`/`apply`） | 函数形态 `export { name, inject, apply }` | ✅ |
| 上下文是服务仓库；依赖经 `inject` 声明，服务就绪前插件等待 | `inject: ['tools']`；可选服务用 `ctx.get()`（sessionPersistence/workspaceRegistry） | ✅ |
| 依赖服务消失 → 自动卸载，恢复 → 自动重载 | 全部贡献在 apply 内注册（可撤销），无持久引用 | ✅ |
| 注册可撤销（disposer） | 工具注册返回 disposer，交给 Cordis 生命周期 | ✅ |
| 类型化事件/服务（declaration merging） | 不声明自定义事件/服务（纯消费方） | N/A |
| 文档指针：primers 与教程 | README 链接官方 cordis-primer | ✅ |

## 5. [cordiverse/paper](https://github.com/cordiverse/paper)（时空可组合范式）

| 论文机制 | 本插件 | 状态 |
|---|---|---|
| 时间可组合（revertible effects）：每个上下文变换带逆操作，运行时追踪，移除时完整回退 | 全部贡献（2 个工具注册 + 缓存文件）经 disposer 或显式 owned 目录管理；卸载后无残留注册 | ✅ |
| 空间可组合（reactive coeffects）：依赖变化通知组件按 coeffect 规格响应 | `inject` 声明依赖；服务缺位时插件不加载（PENDING），就绪后加载 | ✅ |
| 配置调和与热替换（loader reconciliation/HMR） | Config schema + 可撤销注册 → HMR 与 patch 覆盖均安全 | ✅ |

## 审计结论

- **无红线违规**；唯一代码级待办：`exec.signal` 接入批量导入循环（取消响应）。
- 待验证项集中在 Phase 5 集成：`--dump-config` 行生效、真实 profile 续聊、导入后会话列表刷新行为。
- 计划 Phase 6：双语文档、npm 发布面核对（`npm pack --dry-run`）、`dsh-plugin` topic。
