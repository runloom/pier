# 项目记忆 v3(全局注册 + 运行时解析)Implementation Plan

> Spec:`docs/superpowers/specs/2026-08-27-project-memory-global-registration-v3-design.md`。
> 沿用约束:引擎精确 `@modelcontextprotocol/server-memory@2026.7.4`;单文件 ≤500 行;不 commit;测试 `pnpm vitest run <file>`。

## P1 启动器 + 全局注册 + 迁移

- [x] **T1 启动器资产**:`resources/memory-launcher/memory-mcp.mjs`(零依赖纯 Node)。
  解析顺序 env `PIER_MEMORY_STORE` → cwd `git rev-parse --git-common-dir`(projectKey 算法与宿主一致);
  读 `~/.pier/memory/<key>/ledger.json`(缺失 = 启用);启用 → `spawn("npx", ["-y", ENGINE], { stdio: "inherit", env+MEMORY_FILE_PATH })` 退出码跟随;
  停用/无法解析 → 内置空工具 JSON-RPC 应答(initialize/initialized/tools/list/ping,newline-delimited)。
  测试:`tests/unit/main/agent-managed-assets/launcher-contract.test.ts` 以子进程驱动 stdio 握手(空工具与透传两分支)、projectKey 一致性(与 `resolveProjectIdentity` 共享 fixture)。
- [x] **T2 启动器安装器**:`src/main/services/agent-managed-assets/launcher-install.ts`,对齐 `hooks-install` 世代模式:`~/.pier/memory/launcher/v{N}` + `current` symlink + `GENERATION`;boot 幂等(已接线 pier-home boot;`electron-builder.yml` extraResources 已加 `memory-launcher`)。
- [x] **T3 全局注册器**:`registry.ts`(单机账本 `~/.pier/memory/registry.json`,WAL 复用 `recoverPendingTargets`/`applyMemoryTarget` book 接口;serializer 已 entry 化,`buildLauncherEntry` 系列);boot 幂等收敛(pier-home 接线:装启动器 → converge → 预热)。新装智能体在下次 boot 收敛(与 v2 语义一致)。
- [x] **T4 v2 迁移**:逐项目账本 targets 反向移除(复用 `applyMemoryTarget` disable 分支语义),清 targets/pending(漂移 failed 保留作诊断);registry 记 `migratedFromV2` 一次性标记;测试覆盖骨架删除 + 不再重扫。
  **⚠ 时序硬约束:T4 必须与 T7 的「停用 v2 默认启用扫描(`ensureDefaultEnabled`/`memoryDefaultsSweep`)」同批落地**——否则迁移刚移除项目配置条目,v2 boot 收敛又会把它们写回去,两套机制互相打架。T3/T4/T7/T8 是一个原子交付单元。
  另:serializer 需先做 entry 化重构(plan 函数从收 `storePath` 改收 entry 对象;新增 `buildLauncherEntry`(json:`{command:"node",args:[launcherPath]}`;opencode:`{type:"local",command:["node",launcherPath]}`;toml 块无 env 行);`applyMemoryTarget` 的账本耦合抽成 `{targets,pending,save}` book 接口供 registry 复用。
- [ ] **T5 实现期核实项**(记录进 spec 风险表 verifiedOn):claude/codex/gemini/opencode/cursor 拉起 stdio server 的 env 透传;omp 是否读 `~/.claude.json`。
  T6 落地后此项不再承重(Pier 内恒经 env;透传失败的最坏面 = 空工具应答,零错误噪声):验证方式 = 真实会话跑 `/mcp` 看 `pier-memory` Connected 并写读一条记忆;需要真实智能体账号,不代跑。

## P2 env 注入 + 状态语义

- [x] **T6 PTY/任务/AI 注入 `PIER_MEMORY_STORE`**:`agent-managed-assets/env.ts`(`memoryStoreEnvPatch`,与 reconciler 同一 `resolveProjectIdentity` 派生,含非 git 目录身份);挂 `applyLaunchWrapForCreate`(agent 终端)与 ai/service one-shot;不覆盖显式已设值。**Pier 内确定性不再依赖各智能体拉起 stdio server 的 cwd 行为**;启动器 cwd 兜底降级为「Pier 之外」的 bonus 路径。
- [x] **T7 reconcile 面收敛**:`enable/disable` 只写 desiredState + 引导段;`status` = registry 健康(注入 `registryStatus` dep)+ desiredState(缺账本 = 默认启用)+ 计数;`ensureDefaultEnabled`/`memoryDefaultsSweep`/确认门/`acknowledgeTracked`/tracked 通知(`notify.ts`)/`needsConfirmation` 契约全部删除。
- [x] **T8 设置页**:git 确认分支删除;degraded 单文案(registry 健康);新增「开关变更对新会话生效」说明;四语言清理 `confirm.tracked.*`/`degraded.statusOff` + 新增 `summary.newSessionNote`。

## P3 清理与收口

- [x] **T9 删除死代码**:`write-targets.ts` + 测试、`notify.ts` + 测试已删;`target.ts` 保留(registry 写入与迁移移除共用);prewarm 触发 = 注册收敛后 + 显式 enable。dir-density/file-size 复查通过。
- [x] **T10 治理**:governance 锁 v3 spec 标题 + 「reconcile 不含 applyMemoryTarget/isTracked」红线。`pnpm preflight:push` 待跑(T5 核实项完成后)。

## P4 多模评审加固(2026-08-27 全量修复)

- [x] **H1 引擎版本勘误**:`0.6.3` npm 不存在(包 0.6.2 后改 CalVer,"0.6.3" 只是内部 serverInfo 串)→ 全线锁 `@2026.7.4`;一手核实 dist 源码读 `MEMORY_FILE_PATH` 且无 mkdir;契约测试锁 CalVer 格式,防回退虚构 semver。
- [x] **H2 store 目录兜底**:启动器 spawn 前 `mkdirSync(dirname(store))`(默认启用项目从未经过设置页 `ensure`,引擎首写会 ENOENT);契约测试断言目录落地。
- [x] **H3 僵尸启动器**:引擎按信号退出后,先摘自身 SIGINT/SIGTERM 监听器再 re-raise(否则信号被自己吞掉 + 事件循环钉死);契约测试锁「SIGTERM 后进程按信号终止」。
- [x] **H4 引擎覆盖钩子加固**:`PIER_MEMORY_ENGINE` 仅在 `PIER_MEMORY_ENGINE_TEST=1` 门闩下生效;非法 JSON/空数组/非字符串数组 try/catch 回退默认,不再裸抛。
- [x] **H5 用户决策保护**:v3 显式开关落 `decidedBy: "user"`;门残留清理一票否决该标记(用户决策不靠形态推断保护);清理并入 `migratedFromV2` 同批(registry 丢失重扫时决策仍受字段保护)。
- [x] **H6 迁移先 WAL 恢复**:`migrateV2ProjectTargets` 先 `recoverPendingTargets`(崩溃窗口的已写盘条目提交为 written 后同样反向清理),不再裸清 pending 销毁归属证据。
- [x] **H7 迁移/清理/全局写入加锁**:`convergeMemoryRegistry` 接宿主 `FilePathTransactionLock`,项目账本与全局配置逐路径串行,与用户开关互斥。
- [x] **H8 损坏账本语义对齐**:宿主把「存在但不可解析」视同缺失(默认启用,与启动器 fail-open 一致),status 不再把 load() 默认值落盘固化;测试锁「损坏文件原样保留」。
- [x] **H9 opencode.jsonc 诚实降级**:jsonc 存在(优先级高于 json)时记 failed(detail 指明),不写会被忽略的 `.json` 假 written;设置页可见 degraded。
- [x] **H10 逐目标错误隔离**:单个全局配置 EACCES/损坏不再中止整轮收敛;failed 行入 registry。
- [x] **H11 安装器加固**:GENERATION 防降级(磁盘世代更新则跳过)+ current 被换成真实目录时清理重建 + GENERATION 仅变更时写。
- [x] **H12 显式 enable 触发全局重收敛**:开关重开 = 漂移修复动作(幂等),补齐「新装智能体/手改配置」的非 boot 修复路径。
- [x] **H13 小项收尾**:CODEX_HOME 相对路径回退默认;`memory.list`/`status` 能力对齐 `workspace:read`;8MB 上限单一来源(store 复用 `MEMORY_JSONL_MAX_BYTES`);统计计数与列表同口径(四类 entityType);删除最后一条 observation 级联清悬空 relation;prewarm 超时不再记成功;设置页开关加载态禁点;列表 key 加 entityType;adapter-facts 注释与 v3 对齐。
