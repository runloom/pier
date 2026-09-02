# 项目记忆 v3:全局注册 + 运行时解析

日期:2026-08-27  
状态:已确认(取代 [2026-08-26 设计](./2026-08-26-project-memory-plugin-design.md) 的「写入目标与选择规则」「确认门」「默认启用扫描写入面」;引擎选型、`~/.pier/memory` 存储、账本理念、[2026-08-27 设置页表面](./2026-08-27-project-memory-settings-ui-design.md) 沿用)  
范围:MCP 交付面从「每项目写 N 份智能体项目配置」重构为「每智能体用户级全局配置写一次 + 启动器运行时按项目解析」。

## 一句话终态

每个智能体的**用户级全局配置**里只有一条永不变化的 `pier-memory` 条目,指向 Pier 安装在 `~/.pier` 的启动器;启动器在被智能体拉起的那一刻自己决定「服务哪个项目的记忆、还是不服务」。**仓库内文件零写入,确认门整类删除。**

## 业界依据(2026-08-27 调研)

| 模式 | 代表 | 结论 |
|---|---|---|
| 完全不管 | herdr、Conductor、Orca | 只管终端,MCP 交给智能体原生配置 |
| 只读发现 | Warp | 读第三方配置复用,从不写入 |
| **一次性写用户级全局配置** | **cmux-agent-mcp** | 安装时合并写入各智能体用户级配置,"One install, every project, every tool",永不碰项目文件 |
| 网关聚合 | MetaMCP、Docker MCP Gateway | 客户端只配一个入口,后面动态路由 |

没有任何同类产品往项目仓库写配置矩阵。v3 = 模式三(注册面)+ 模式四的单机极简形态(启动器 = 单 server 的路由层)。

## 架构

```
┌ 各智能体用户级全局配置(写一次,merge-don't-clobber)────────┐
│ pier-memory: node /Users/<u>/.pier/memory/launcher/current/  │
│              memory-mcp.mjs                                  │
└──────────────┬───────────────────────────────────────────────┘
               │ 智能体在项目里拉起 stdio server(继承 env + cwd)
┌──────────────▼───────────────────────────────────────────────┐
│ 启动器 memory-mcp.mjs(Pier 随版本安装,零依赖纯 Node)        │
│ 1. 解析项目:PIER_MEMORY_STORE env(Pier PTY 注入,权威)      │
│    → 兜底:cwd `git rev-parse --git-common-dir` → projectKey │
│ 2. 读 ~/.pier/memory/<key>/ledger.json:                      │
│    缺失或 desiredState=enabled → 启用;disabled → 停用        │
│ 3. 启用:spawn npx -y @modelcontextprotocol/server-memory     │
│    @2026.7.4;stdout 握手注入 instructions 后 splice         │
│    停用/解析失败:内置空工具 MCP 应答(initialize 正常、       │
│    tools/list 恒空),智能体侧不报连接错误                     │
└───────────────────────────────────────────────────────────────┘
```

### 启动器安装与版本化(对齐 `~/.pier/hooks` 先例)

- 目录 `~/.pier/memory/launcher/v{N}/memory-mcp.mjs` + `current` 符号链接 + `GENERATION` 指针;每次 Pier 启动按世代号幂等更新,`current` 原子切换。
- 全局配置里写 **绝对路径**(用户级配置本就单机私有,绝对路径无跨机语义问题;智能体不做 `~` 展开)。
- 启动器**零 npm 依赖**(纯 Node ≥18 标准库)。启用时 `stdio: ["pipe","pipe","inherit"]`:stdin 原样 pipe 进引擎,stdout 握手期注入 `instructions` 后 splice(`pipe({ end: false })`,引擎 EOF 不提前关掉客户端通道)。停用路径仍是空工具 NDJSON 应答。自研面 = 空工具应答 + 握手注入,见 [2026-08-28 引导随工具走](./2026-08-28-project-memory-mcp-instructions-design.md)。

### 项目解析顺序

1. `PIER_MEMORY_STORE`(绝对 store 路径):Pier 在 PTY / 任务 / AI one-shot 环境注入(与 `PIER_AGENT_HOOKS_DIR`、系统技能 extra-root 同管线),Pier 内启动的智能体**恒定命中**,不依赖智能体的 cwd 行为。
2. cwd 推导:`git rev-parse --git-common-dir` → realpath → sha256 前 16 位(与宿主 `resolveProjectIdentity` 同算法,启动器内置实现并以契约测试锁定一致);**仅限 git 目录**——非 git 目录不猜身份(在家目录随手拉起的会话不该悄悄建 store),Pier 注册的非 git 项目由 env 注入覆盖。覆盖「Pier 之外直接跑智能体」的场景——去掉 Pier 记忆仍可用,比 v2 更符合产品哲学。
3. 两者皆无(如从 home 拉起且非 git)→ 空工具应答。

### 全局注册面(替代 v2 的项目级五格式矩阵)

**真源是 `MCP_DISCOVERY_ADAPTERS`(与 skills 适配器同一纪律),不是平行的智能体白名单。** 每个 `AgentKind` 必须登记为 consuming 或显式不支持;治理测试锁完整性。记忆写入目标 = consuming 适配器的 **第一条 userConfig** 去重并集(原生路径;交叉复用路径只做发现、不重复写)。新增智能体只需在 adapter-facts 补一行,不必再改 registry 名单——否则会再漏 Grok 这类「目录有、记忆没接上」的缺口。

可写格式:`mcp-servers-json` / `opencode-json` / `codex-toml` / `amp-settings-json` / `goose-yaml` / `hermes-yaml` / `vibe-toml`。**consumesMcp 只表示产品官方吃 MCP**,禁止用 false 顶替「serializer 还没写」。none 表只留没有官方用户级 MCP 的产品。

- 写入规则沿用 v2 serializer 全套纪律:merge-don't-clobber、账本指纹识别本体(引擎/路径升级可重写)、冲突拒写、TOML marker 块。**未标记但 stdio 身份等价**（command/args 一致、env 一致或皆空、没有我们不会写的额外键）视为本体:补 marker 后写入。JSON/YAML 用整段条目 sha 判定等价;TOML named table 与 Vibe `[[mcp_servers]]` 用同一套字段比较。内联 `mcp_servers = { "pier-memory" = … }` 剥不了 named table,仍拒写。
- 目标账本从 per-project 收敛为**单机一份** `~/.pier/memory/registry.json`(由适配器推导的目标指纹 + WAL pending,结构同 v2 ledger.targets/pending)。
- 注册时机:启动幂等收敛(已注册且指纹匹配 → 零写入)+ 智能体新装检测后 + 用户显式打开项目记忆开关。这些文件在用户家目录,**不存在 git 跟踪问题,确认门与 tracked 通知整类删除**。
- `snapshotStatus` / `registryStatus` **只核对**磁盘指纹与账本,不在读路径重放收敛。等价未标记条目由启动/显式开启的 `convergeMemoryRegistry` 收编。

### 项目级状态(大幅简化)

- `~/.pier/memory/<key>/ledger.json` 只承担 `desiredState`(+ 诊断字段);**缺失即默认启用**——「默认启用」变成纯声明语义,启动扫描/收敛/needs-confirmation 全部删除。
- 设置页开关 = 写 desiredState;关闭即时生效于**新**会话(运行中的引擎进程不猎杀,下轮会话生效,文案注明)。
- `snapshotStatus`:全局注册健康(已装 consuming 智能体的目标指纹核对)+ 项目 desiredState + 条目计数。「部分接入」只在全局注册失败/漂移时出现。读路径不写盘。

### 保留与删除

- **保留**:引擎锁定 `@2026.7.4`、`~/.pier/memory/<key>/memory.jsonl` 存储与权限、AGENTS.md 引导段(纯文本无机器路径,继续走仓库 + marker 幂等)、CLAUDE.md 引用、设置页表面与 list/delete/clear 命令、引擎预热、删除三元组校验、8MB 守卫。
- **显式取舍——引导段只随显式开启写入**:默认启用(声明式)的项目**不**自动写 AGENTS.md,「零弄脏仓库」红线优先于仓库内引导覆盖率。用法引导改走启动器注入的 MCP `initialize.result.instructions`(见 [2026-08-28 引导随工具走](./2026-08-28-project-memory-mcp-instructions-design.md)),默认启用不再是「只有工具没有用法」。用户显式开启开关(自己看着 diff)才落 AGENTS.md 托管段,给不吃 `instructions` 的客户端兜底。
- **删除**:项目级 MCP 目标写入/移除(五格式 per-project)、`selectMemoryTargets` 安装矩阵、确认门 + `trackedAcknowledged` + tracked 通知、默认启用扫描(`ensureDefaultEnabled` / `memoryDefaultsSweep`)、per-project targets/pending 账本段。

### v2 → v3 迁移(一次性)

1. 启动时逐项目账本:**先跑 WAL 恢复**(v2 崩溃窗口内「已写盘、未 commit」的条目经分支①提交为 written,否则裸清 pending 会销毁唯一归属证据,留下永久无人认领的仓库写入);再对 `targets` 中 lastOutcome=written 的项目配置执行 v2 disable 同款移除(指纹匹配才删,漂移保留并记诊断);清空 targets/pending;desiredState 保留。
2. **v2 确认门残留清理**:v2 自动路径被跟踪门拦下时落过 `desiredState: "disabled"` 的「别再自动尝试」标记——非用户决策,会在 v3 挡住默认启用。保护规则分层:**带 `decidedBy: "user"`(v3 显式开关落的决策来源标记)一票否决,用户决策绝不靠形态推断保护**;其余按形态判残留(disabled + 空 targets/pending + 无 ack + 无引导段痕迹)命中即删账本,恢复「从未决策 = 默认启用」;真实 v2 用户关闭(留有 removed/skipped 记录或 ack/引导段痕迹)不受影响。与第 1 步同批,共用 `migratedFromV2` 一次性标记(registry 丢失重扫时,v3 决策由 decidedBy 保护,不依赖标记)。
3. 安装启动器 + 全局注册。
4. 迁移与清理标记入 registry.json,幂等。迁移/清理写项目账本与全局配置写入均经宿主 `FilePathTransactionLock` 路径级串行,与用户开关及其它写入方互斥。

## 风险与取舍

| 风险 | 缓解 |
|---|---|
| 智能体拉起 stdio server 的 env/cwd 透传差异 | Pier 内恒走 env 注入;外部走 cwd 兜底;两者皆无 = 空工具,无错误噪声。实现期逐智能体验证并记录 verifiedOn |
| 空工具应答与握手注入是自研面 | 契约测试锁定 stub 握手、instructions 注入、splice 后 SIGTERM;豁免见 2026-08-28 spec |
| 用户手改全局配置条目 | registry 指纹判本体,漂移 → 设置页警示;显式重开开关触发全局重收敛(幂等修复),不静默覆盖 |
| node 不在智能体 PATH | 与 v2 的 npx 前提同级;失败面等价 |
| 关闭项目后运行中会话仍持有引擎 | 声明式语义:新会话生效;设置页文案注明 |
| 引擎版本是日历版(npm 无 0.6.x 之后的 semver) | 锁 `@2026.7.4`,契约测试锁 CalVer 格式;不得回退 0.6.2(存储路径硬编码不读 `MEMORY_FILE_PATH`,已核实上游源码) |
| 引擎 saveGraph 不建父目录 | 启动器 spawn 前 `mkdirSync(dirname(store), {recursive, 0o700})` 兜底;默认启用(从未进设置页)的项目首写不再 ENOENT |
| 客户端信号终止会话 | 启动器转发信号 → 引擎退出后**摘掉自身监听器**再 re-raise,退出码跟随;契约测试锁「SIGTERM 后不留僵尸」 |
| 项目账本损坏(JSON 不可解析) | 双端一致 fail-open:启动器视为启用,宿主视同「从未决策」(默认启用)且 status 绝不落盘固化损坏态 |
| opencode 用户用 `opencode.jsonc` | JSONC 优先于 JSON;目标改到 jsonc,用 jsonc-parser 局部编辑写入 `mcp.pier-memory` 并保留注释;禁止改写会被忽略的 `.json` |
| 单个全局配置不可读写(EACCES 等) | 逐目标错误隔离:失败记 failed 行,其余智能体照常收敛 |
| `~/.pier` 跨 build 共享,旧版 App 回退启动器 | GENERATION 防降级:磁盘世代更新时跳过安装;current 被外力换成真实目录时清理后原子重建 |

## 测试与治理

- 启动器契约:env 优先/cwd 兜底/禁用 stub/引擎透传退出码;projectKey 算法与宿主一致性(共享 fixture)。
- 注册器:由 `MCP_DISCOVERY_ADAPTERS` 推导目标(含 Grok / OMP 原生路径)、幂等、owned 重写、冲突拒写、WAL 三分支;AgentKind 完整性与「consumesMcp 必有可写第一条 userConfig」由治理测试锁定。
- 迁移:v2 存量项目条目移除 + 漂移保留;标记幂等。
- 治理检查点沿用 `tests/unit/plugins/pier-memory-governance.test.ts`,锁定本 spec 标题与「仓库内文件零写入」红线(禁止 reconcile 代码 import 项目路径写入)。

## 分阶段交付

1. **P1**:启动器(含版本化安装)+ 全局注册器 + registry 账本 + v2 迁移。
2. **P2**:env 注入管线 + 设置页状态语义切换 + 旧命令面收敛。
3. **P3**:删除 v2 写入引擎死代码,spec/治理测试收口。
