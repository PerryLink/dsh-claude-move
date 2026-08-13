# OPTIMIZATION.md — 系统优化与提升研究

对 dsh-claude-move 及其与 DSH 平台协作方式的深入研究结论。基线数据来自本机真实 Claude 数据（40 项目 / 2387 会话）：全量首扫 **11.7s**、7k 消息单 transcript 转换 **154ms**、52 用例测试 **~290ms**。候选按「价值 × 成本」排序；已落地的标注状态。

## A. 已落地（本轮）

1. ✅ **S4 正则重叠修复**：`sk-` 会吞掉 `sk-ant-`（双计），改为更具体前缀在前 + 负向先行断言。
2. ✅ **导入结果携带工作区挂接状态**（`workspace.attached`），失败不再只进 console。
3. ✅ **cordis peerDependency**（官方红线 5）；`listPersistedIds` 双通道读取（注入值/`ctx.get`）。
4. ✅ **增量缓存**：mtime+size 书签，重扫只读变化文件（测试证明 2 文件改 1 → 只重扫 1）。

## B. 高价值候选（P0：性能/响应性，建议 Phase 3 内完成）

1. **并行项目扫描**（concurrency cap 8）。当前逐项目串行，40 项目 11.7s 中大部分是等待。预期 11.7s → 2~3s。实现：`scanClaudeHome` 内用信号量池并发 `scanProjectDir`；书签合并不变。风险：git 子进程并发需上限（cap 8 内共享）。
2. **批量导入并行**（cap 4）。2387 会话全量导入串行不可接受；`create+append` 互不相关，幂等快照只读。预期接近线性加速；中断可续跑（幂等）。
3. **transcript 自带 `gitBranch` 复用**：Claude 每行都带 `gitBranch`（resume-plugin 已利用）。`scanTranscriptFile` 捕获后，git 探测只需 `status --porcelain` 算脏行（或缓存），砍掉一半 git spawn。
4. **personal 上下文 mtime 缓存**：skills/memory frontmatter 每扫必读（数十次 IO）。并入 index.json 书签，未变化直接复用。
5. **`exec.signal` 接入批量循环**：每文件边界检查取消信号，用户中断立即停止（合规待办，官方工具契约要求）。
6. **git 状态缓存 + 脏状态可关**：`scanGit: 'branch' | 'full' | false` 三级；`branch` 只用 transcript 字段，零 git 调用。

## C. 结构级优化（P1：内存/规模）

7. **流式分块导入**：当前单 transcript 内存峰值 = 原文 + 全量事件数组（超大文件被 `maxTranscriptBytes` 拒绝）。`sessionPersistence.append` 支持跨批次连续 seq → convert 增加流式变体（逐行合成、每 10k 事件 append 一批），内存 O(块)，可导入任意大文件而非拒绝。是 vendored convert 的最大改造，需单独一轮 + 平衡性测试。
8. **in-flight 锁**：并发导入同一源文件时 `create` 抛 duplicate 会被记为 failed（可重跑，但难看）。进程内 `Map<源路径, Promise>` 去重并发调用。
9. **imports.json 清理**：已导入会话被用户删除后映射残留；scan 标注已用 `sessionPersistence.list()` 二次校验（正确），映射本身可在 scan 时惰性清理。
10. **索引裁剪参数**：2387 会话的完整索引作为 `claude_scan` 输出约数 MB（模型上下文压力）。加 `projectsLimit`/`fields` 可选参数，默认全量、模型可请求摘要。
11. **删除文件书签清理**：缓存中源文件已删除的条目目前随扫描自然消失，但无显式「removed 计数」报告——加一行统计即可让用户感知。

## D. 产品与生态（P2：发布后）

12. **增量同步模式**（最高产品价值）：验收是一次性迁移，但用户会继续用 Claude Code。基于现成的 mtime 增量书签，`claude_import_all` 可提供 `sync: true`——只导入新出现/变化的新会话。与「迁移」哲学一致（幂等 append-only），建议 Phase 6 或 v0.2。
13. **续聊摘要的上下文预算**：Phase 4 交接摘要按「目标+停止点+下一步」结构化（resume-plugin 模型），把 token 预算做成 Config（默认 ~2KB），模型可选扩展。
14. **Web 面板复用官方 RPC 而非自建路由**（备选研究）：`ctx.webServer` 路由是公开 seam 且已选；若 Phase 5 spike 发现 apiproxy 白名单域足以承载（如 `session.list`+`command.execute`），可完全去掉自建路由，进一步缩小攻击面。
15. **生态对齐**：`create-dsh-plugin` 脚手架结构、`dsh-plugin` topic、awesome 清单收录（AdamPlatin123/awesome-dsh-plugins、0xsline/awesome-deepseek-harness 均有每日兼容追踪）；`zhu1090093659/dsh-web-ui`、`omdsh-dev/DSH-better-sidebar` 是面板先例。
16. **双语文档**：README.en.md 双轨（合规待办），随 v0.1 发布。

## E. 平台协同观察（不改 DSH，只说明选择）

- 持久化 seam 无 delete → 我们选择 archive + 新 id 的重建语义；若官方未来提供 delete，force 路径可简化（预留 switch）。
- `host/session-added` 帧是否覆盖「cold 导入」决定 F18 的面板自动刷新方案；Phase 5 spike 实测后要么依赖帧、要么面板显式刷新 `session.list`。
- systemPrompt 同步提供者（rc.6 实测不 await）→ Phase 3 注入层必须 `readFileSync`+mtime 缓存；若官方未来支持 async 提供者，可切换（留 TODO 注释）。
- 建议给官方仓库提一条讨论（GitHub Discussions）：为「外部来源导入的会话」提供可选的 `origin: 'import'` 标记（SessionHeader 已有 `origin` 字段雏形），让会话列表 UI 能过滤/标注迁移来源——这是我们在不改引擎前提下唯一做不到的展示项。
