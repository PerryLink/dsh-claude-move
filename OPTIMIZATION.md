# OPTIMIZATION.md — 系统优化与提升研究

对 dsh-claude-move 及其与 DSH 平台协作方式的深入研究结论。基线数据来自本机真实 Claude 数据（40 项目 / 2387 会话）：全量首扫 **11.7s**、7k 消息单 transcript 转换 **154ms**、52 用例测试 **~290ms**。候选按「价值 × 成本」排序；已落地的标注状态。

## A. 已落地（含 Phase 5 真实运行时实测修复）

1. ✅ **S4 正则重叠修复**：`sk-` 会吞掉 `sk-ant-`（双计），改为更具体前缀在前 + 负向先行断言。
2. ✅ **导入结果携带工作区挂接状态**（`workspace.attached`），失败不再只进 console。
3. ✅ **cordis peerDependency**（官方红线 5）；**未声明服务一律 `ctx.get()`**——真实 Cordis 对未声明属性访问抛 "cannot get property without inject"，实测暴露并修复，测试已覆盖。
4. ✅ **可选服务响应式注册**（`internal/service` 事件）：systemPrompt/skills/commands/webServer 可能晚于本插件就绪；apply 缺失则等事件（真实 boot 实测触发 404 竞态）。
5. ✅ **增量缓存 + ctime**：mtime+ctime+size 书签，同毫秒等尺寸重写也能检出（文件缓存与扫描书签同步加固）。
6. ✅ **单读批量导入**：批量路径 stat→read→convert 一次完成，不双读大文件。
7. ✅ **面板任务化 + 进度轮询**：导入异步 job + `/api/claude-move/progress` 轮询，UI 不阻塞主循环。

## B. 高价值候选（P0：性能/响应性，建议 Phase 3 内完成）

1. ✅ **并行项目扫描**（已落地）：`scanConcurrency`（默认 8）信号量池并发 `scanProjectDir`，书签按槽位写入、排序确定性不变，中止传播 `signal.reason`；git 子进程在池内共享受限。
2. ✅ **批量导入并行**（已落地两阶段形态）：`importConcurrency`（默认 4）并发「读取+转换」，落盘按文件名序串行（id 后缀避让与 imports.json 映射依赖顺序，保证确定性）。剩余候选：id 预分配后可进一步并行落盘（`create+append` 互不相关、幂等快照只读），中断可续跑（幂等）。
3. ✅ **transcript 自带 `gitBranch` 复用**（已落地）：`scanTranscriptFile` 捕获后，`gitStatus` 已知分支时跳过 `rev-parse`，只跑 `status --porcelain` 算脏行。
4. **personal 上下文 mtime 缓存**：skills/memory frontmatter 每扫必读（数十次 IO）。并入 index.json 书签，未变化直接复用。（仍开放）
5. ✅ **`exec.signal` 接入**（已落地）：扫描（流式逐行/项目边界）与批量导入（并发阶段与落盘阶段每文件）全程检查 `exec.signal`，中止抛 `signal.reason`；`gitTimeoutMs` 同时配置化。
6. ✅ **git 状态三级开关**（已落地）：`scanGit: true | 'branch' | false`；`'branch'` 只用 transcript 字段，零 git 调用。

## C. 结构级优化（P1：内存/规模）

7. ✅ **流式分块导入**（已落地）：convert 增加 `createClaudeStreamConverter`（逐行 feed、按回合边界分批、`skipTurns`/`startSeq` 续写），`fs.streamText` 存在时超大文件走流式路径（内存 O(当前回合+单批)，每 10k 事件 append 一批）；无流式面的环境保持响亮拒绝。
8. ✅ **in-flight 锁**（已落地）：`lib/imports-store.mjs` 进程内 `Map<源路径, Promise>` 排队去重并发调用；imports.json 读-改-写经写队列串行 + tmp/rename 原子写。
9. ✅ **imports.json 清理**（已落地）：全量扫描时惰性清理「映射指向已删除会话」的残留并报告 `importsCleaned`；标注优先 `listSnapshots` 快照。
10. ✅ **索引裁剪参数**（已落地）：`claude_scan { projectsLimit, sessionsLimit, fields: 'brief' }` 裁剪输出体量。
11. ✅ **删除文件书签清理**（已落地）：scan 报告 `removedBookmarks` 计数，书签随扫描清理。

## D. 产品与生态（P2：发布后）

12. **增量同步模式**（已实现 v0.1）：验收是一次性迁移，但用户会继续用 Claude Code。基于现成的 mtime 增量书签与 imports.json 记录，重复导入会自动把新增轮次续写到同一 DSH 会话（`appended`）；后续可再扩展「新增会话自动发现 + 定时同步」。
13. **续聊摘要的上下文预算**：Phase 4 交接摘要按「目标+停止点+下一步」结构化（resume-plugin 模型），把 token 预算做成 Config（默认 ~2KB），模型可选扩展。
14. **Web 面板复用官方 RPC 而非自建路由**（备选研究）：`ctx.webServer` 路由是公开 seam 且已选；面板已改用官方客户端 `sessions.refresh/open` 做列表刷新与会话打开，自建路由保留扫描/导入/进度/取消/重置职责。若未来 apiproxy 白名单域足以承载导入进度，可再评估收敛。
15. **生态对齐**：`create-dsh-plugin` 脚手架结构、`dsh-plugin` topic、awesome 清单收录（AdamPlatin123/awesome-dsh-plugins、0xsline/awesome-deepseek-harness 均有每日兼容追踪）；`zhu1090093659/dsh-web-ui`、`omdsh-dev/DSH-better-sidebar` 是面板先例。
16. **双语文档**：五语 README（EN 主 + zh/es/pt/hi）+ 面板 zh/en 文案 + 工具/命令双语描述已落地；CI 矩阵 linux/macos/windows 兑现 macOS/Linux 验证待办。

## E. 平台协同观察（不改 DSH，只说明选择）

- 持久化 seam 无 delete → force 采用「新 id 完整副本、旧副本保留」的复制式语义（不归档：归档会隐藏历史，与复制式迁移冲突）；若官方未来提供 delete，删除旧副本路径可再加开关。
- `host/session-added` 帧只覆盖 live `session/created`（cold 导入不发）→ 面板经官方客户端 `sessions.refresh` 免刷新更新列表（特性探测，老 shell 回退整页刷新）。
- systemPrompt 同步提供者（rc.6 实测不 await）→ Phase 3 注入层必须 `readFileSync`+mtime 缓存；若官方未来支持 async 提供者，可切换（留 TODO 注释）。
- 建议给官方仓库提一条讨论（GitHub Discussions）：为「外部来源导入的会话」提供可选的 `origin: 'import'` 标记（SessionHeader 已有 `origin` 字段雏形），让会话列表 UI 能过滤/标注迁移来源——草案已记入 RELEASE.md 待办（B6）。
