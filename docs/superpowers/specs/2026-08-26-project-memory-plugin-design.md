# 项目记忆插件（pier.memory）

日期：2026-08-26  
作者：待填  
状态：v3 草稿（codex 四轮评审定稿：R1 4 blocker+11 major → 全采纳重写 v2；R2 blocker 清零、补 5 项遗留；R3 验收 4/5、补全 WAL 协议；R4 结论「可进实现计划」）  
范围：Pier 宿主新增受管资产注册服务与命令接线 + 新增 builtin 插件 `pier.memory`（纯 renderer 表面）；记忆交付覆盖 claude / codex / cursor / gemini / opencode / omp 六个智能体。  
取代：同日 v1 草稿（其「插件 main 编排」「全局 enabled 配置」「realpath 收敛 projectKey」「pierManaged 注入字段」等设计作废）。  
相关：

- [Claude Code Memory 官方文档](https://code.claude.com/docs/en/memory)（auto memory 设计参照）
- [MCP 官方参考记忆服务器](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)（唯一引擎，**锁定 `@modelcontextprotocol/server-memory@0.6.3`**）
- [OpenHuman Memory Tree / Obsidian Wiki](https://tinyhumans.gitbook.io/openhuman/features/memory-tree)（「Markdown 即记忆镜像」路线的重量级印证；其 markdown 镜像与热度主题树列入 L2 参考）
- 宿主既有底座：`src/main/services/agent-rules/service.ts`、`src/main/services/agent-mcp-catalog/{adapter-facts,parse-server-names}.ts`、`src/main/services/files/path-transaction-lock.ts`、`src/shared/contracts/permissions.ts`

---

## 概述

Pier 目前没有跨会话、跨智能体的知识积累层。本设计把「项目记忆」做成 builtin 插件 `pier.memory`：

1. **引擎零自研**：托管官方 memory MCP 服务器（本地 JSONL 知识图谱）。读写检索全部由各智能体在会话中经原生 MCP 工具完成。引擎可行性已 PoC 实测（stdio 握手、定向存储、claude 真实会话写入与召回全链路通过）。
2. **宿主承担全部编排与文件操作**：`agent-managed-assets` 服务负责 store 管理、五个 canonical MCP 配置的受管条目写入/移除、AGENTS.md 托管引导段维护、ownership ledger 与状态派生。插件不触碰文件系统。
3. **插件只做产品表面**：一个轻量 dockview 面板（开关 + 状态摘要），经宿主提供的窄 facade 表达意图。

判定对齐产品哲学：去掉 Pier 后用户手动贴同样配置效果相同；Pier 的价值是零配置托管、跨智能体一致、可视化治理。

---

## 背景与动机

### 业界调研结论

两大流派：编码工具「文件即记忆」（Claude Code auto memory 为金标准：索引常驻 + 按需读详情、仓库级共享、机器本地）与记忆引擎框架（mem0 / Letta / Zep，为自建 agent 服务，对桌面工作台过重）。工程共识：提取 ≠ 摘要；遗忘是一等公民；写入门控决定质量；MCP 是跨工具记忆的标准接口。同类终端/编排工具（cmux / herdr / Orca）均不做持久记忆——「宿主托管 + 跨智能体共享」在本品类是空白。

### PoC 证据（2026-08-26 本机实测）

```
✓ npx @modelcontextprotocol/server-memory stdio 握手，9 个工具可用
✓ MEMORY_FILE_PATH 定向存储，JSONL 正确落盘
✓ claude -p 真实会话主动调 create_entities/add_observations 写入既有实体
✓ search_nodes 精确召回全部观察
✓ 多客户端共享同一 JSONL 文件
```

关键事实：

- `MEMORY_FILE_PATH` 相对路径按包安装目录解析而非 cwd（引擎源码确认），必须传绝对路径。
- 引擎 npm dist-tag latest 为 2026.7.4，但本设计**精确锁定 PoC 验证过的 `0.6.3`**，升级随 Pier 发版走（供应链约束，见风险表）。

---

## 目标与非目标

### 目标（L1）

1. 用户在「项目记忆」面板一键为当前项目开启/关闭记忆。
2. 开启后，全部已装且支持 MCP 的智能体在该项目内获得同一套记忆工具与使用引导。
3. 记忆随项目积累：约定、坑、决策、环境事实跨会话、跨智能体复用。
4. 关闭可完整回退托管内容；ownership ledger 保证只动 Pier 自己写入的东西。

### 非目标（L2 及以后）

- 记忆浏览/编辑面板增强、回合末蒸馏候选队列
- 团队共享存储（git 内记忆文件）
- mem0 云 provider（serverSpec 参数化留缝）
- 替代各智能体原生 auto-memory；user 级 MCP 配置写入
- 插件停用时的自动领域清理；但三个宿主命令常驻命令面板（分类「项目记忆」），插件面板消失后关闭路径仍可达

---

## 总体架构

```
┌─ 插件 pier.memory（纯 renderer 产品表面）──────────────┐
│ panel: 开关(desiredState) + 状态摘要 + dialogs 详情      │
└──────────────┬───────────────────────────────────────────┘
               │ context.projectMemory 窄 facade（宿主实现）
               │ → IPC → PierCommand（allowedClientKinds: desktop-renderer）
┌──────────────▼───────────────────────────────────────────┐
│ 宿主 main：agent-managed-assets 服务（唯一编排者）          │
│ · ensureMemoryStore(projectIdentity)                      │
│ · reconcile(projectIdentity, desired) ← 全部文件操作在此    │
│ · snapshotStatus(projectIdentity) ← 派生状态               │
│ · ownership ledger（userData JSON，单一真源）               │
│ · FilePathTransactionLock 单例 + per-project 互斥           │
│ 写入目标 = 5 个 canonical 项目级 MCP 配置 + AGENTS.md 托管段 │
│ 路径事实：从 adapter-facts 抽出共享 facts 模块，单向消费      │
└──────────────┬───────────────────────────────────────────┘
               │ 各智能体原生 MCP 运行时
┌──────────────▼───────────────────────────────────────────┐
│ npx -y @modelcontextprotocol/server-memory@0.6.3           │
│ env MEMORY_FILE_PATH=<store 绝对路径> → memory.jsonl       │
└───────────────────────────────────────────────────────────┘
```

分工：宿主提供通用能力与全部副作用；插件是领域入口与 UI。与 agent-accounts 迁移终态的「宿主通用能力 / 插件领域」划分一致。

---

## 授权与接线（v2 重做）

v1 假设「manifest permissions 声明即可授予」不成立：main 侧 `authorizeCommand` 按 client-kind 授权（AGENTS.md 明示不区分插件主体），且 desktop-renderer 默认集不含新能力时会一律拒绝。v2 采用与 git 能力完全相同的既有模式：

1. **capability**：`pierCapabilitySchema` 新增单项 `managedAssets:write`（合并 v1 的两项），**加入 desktop-renderer 默认集**——先例即 `git:write`（permissions.ts L110 注释：「主体提供能力，二次确认由插件 UI 负责」）。不进入其它 client-kind 默认集。
2. **命令**：宿主注册 `pier.memory.enable` / `pier.memory.disable` / `pier.memory.status` 三个 PierCommand 并**同时登记进命令面板**（分类「项目记忆」，标题走宿主 locale）；`CommandMetadata.allowedClientKinds = ["desktop-renderer"]`，不进 CLI local-control。shared 契约（zod strict schema）+ command metadata + router executor + app-core wiring + preload 暴露，全套走既有命令基建。命令面板入口不依赖插件运行态——插件停用后用户仍可从面板执行「关闭项目记忆」。
3. **插件 facade**：`RendererPluginContext` 新增窄门面 `context.projectMemory`（enable/disable/status 三方法，类型在 `src/plugins/api/renderer.ts`，宿主实现于 `src/renderer/lib/plugins/host/context.ts`，内部转发上述 IPC 命令并对本插件断言 `managedAssets:write`）。
4. **manifest**：插件自身不声明 commands（palette 入口是宿主命令，见上）；声明 `panels`（见下节）与 top-level `permissions: ["workspace:read", "panel:register", "panel:open", "managedAssets:write"]`。

---

## 插件表面

```ts
// manifest 片段（对齐 files 插件形态）
{
  name: "Memory",
  panels: [{
    component: "memory",
    id: "pier.memory.panel",
    permissions: ["workspace:read", "panel:open"],
    title: "Project Memory",
  }],
  permissions: ["workspace:read", "panel:register", "panel:open", "managedAssets:write"],
}
```

- 面板即开关与状态的家：顶部 Switch（写 `desiredState`）+ 状态摘要（派生状态、接入的配置计数、引擎版本、store 位置）+ degraded 时内联告警行。
- main module 保持空激活壳（与 git/files 现状一致）；插件零 Node 侧逻辑。
- 面板上下文取当前项目身份来自宿主 PanelContext（`projectRootPath`），不接受任意路径输入。

---

## 数据模型与身份

### projectKey（v2 修正）

git 项目以 `git rev-parse --absolute-git-dir --git-common-dir` 的 **commonDir 规范化路径** 派生（linked worktree 的 commonDir 相同 → 天然共享一份记忆；主仓与 worktree 收敛）。非 git 目录退化为目录 identity。key 形态：sha256 前 16 位十六进制。测试须覆盖：主仓 ↔ linked worktree 收敛、symlink 进入、仓库移动后 key 变化的语义（变化即新记忆库，不做迁移）。

### 存储

`{userData}/plugin-data/pier.memory/<projectKey>/memory.jsonl`，目录权限 0700、文件 0600。JSONL 行格式为引擎原生 entity/relation 行。

### entityType 四类约定（写进引导段）

| entityType | 记什么 |
|---|---|
| `convention` | 项目约定 |
| `pitfall` | 踩过的坑 |
| `decision` | 拍板决策及理由 |
| `environment` | 环境事实 |

### ownership ledger（v2 新增，单一真源）

`{userData}/plugin-data/pier.memory/<projectKey>/ledger.json`（原子写）：

```ts
interface MemoryLedger {
  projectIdentity: { canonicalRoot: string };   // 诊断用；key 才是身份
  desiredState: "enabled" | "disabled";
  enginePackage: string;                        // 固定 "@modelcontextprotocol/server-memory@0.6.3"
  trackedAcknowledged?: boolean;                // 用户已确认写入 git 跟踪的配置（每项目一次）
  targets: Record<string, {                     // 键 = canonical 配置绝对路径
    existedBefore: boolean;                     // Pier 是否创建了骨架文件
    fingerprint: string;                        // 写入后托管条目指纹
    lastOutcome: "written" | "removed" | "failed" | "skipped";
    detail?: string;
  }>;
  rulesSection: {
    inserted: boolean;
    fingerprint: string;
    agentsMdExistedBefore: boolean;             // AGENTS.md 是否由 Pier 经 ensure 创建
  };
  claudeReference: { present: boolean; insertedByPier: boolean };
  /**
   * Write-ahead 意图（崩溃一致性）：P1 先持久化完整计划再动文件。
   * priorFingerprint = 动作前实况指纹（文件不存在为 "absent"）；commitRecord =
   * 动作生效后应提交的完整 target 记录——P2 之后任意时刻崩溃都可零推导直接提交。
   */
  pending: readonly {
    kind: "mcp-target" | "rules-section" | "claude-reference";
    targetPath: string;
    action: "write" | "remove";
    priorFingerprint: string;
    expectedFingerprint: string;                // 动作生效后应呈现的指纹；移除动作为 "absent"
    commitRecord: {
      existedBefore: boolean;
      fingerprint: string;
      lastOutcome: "written" | "removed";
    };
  }[];
}
```

启用状态的**唯一解释权在 ledger + 磁盘实际内容**：`snapshotStatus` 派生 `disabled | enabled | degraded`（desired=enabled 且存在未达成目标即 degraded；enabling/disabling 只是命令进行中的瞬时返回值，不持久化）。不存在全局 enabled 布尔设置。

---

## 宿主服务：`agent-managed-assets`

### API（宿主内部 + 命令面）

```ts
reconcile(identity: ProjectIdentity, desired: "enabled" | "disabled"): Promise<ReconcileReport>;
snapshotStatus(identity: ProjectIdentity): Promise<MemoryStatusSnapshot>;
```

每次 `reconcile` / `snapshotStatus` 先跑**恢复阶段**：逐条清算 `ledger.pending`，按目标实况指纹三分支——① 等于 `expectedFingerprint`：动作已生效，直接提交 `commitRecord` 并清除该条；② 等于 `priorFingerprint`：动作未发生且前置条件未变，幂等重放后再按①提交；③ 两者皆非：第三方在崩溃窗口内改动过，保留现场、该 target 记 failed（冲突明细）并清除 pending，绝不自动认领。随后 forward-only 幂等收敛到 desired：enable = 确认门 → ensureStore → 逐 target 写入 → 引导段；disable = 逐 target 移除 → 自建文件还原 → 引导段移除（store 与 ledger 保留）。任一 target 失败不中断其余目标，逐项 outcome 进 report；整体状态按派生规则落 degraded。

**确认门**：预检发现任一目标被 git 跟踪且 ledger 无 `trackedAcknowledged` 时，命令返回 `needsConfirmation`（附跟踪目标清单）；facade 弹 `dialogs.confirm`（intent=default，说明「记忆文件位置在本机，这些配置通常会被 git 跟踪，其它机器上无效」）；确认后持久化 ack 并继续，取消则干净中止、零写入。TOML 不可解析等其它预检失败记 failed/detail，不阻塞其它目标。

### 写入目标与选择规则（每智能体一个首选目标）

facts 模块为每个智能体声明**唯一首选项目配置**；实际写入集合 = 已安装智能体首选目标的去重并集：

| 智能体 | 首选目标 | 格式 | 同路径消费者 |
|---|---|---|---|
| claude | `.mcp.json` | mcp-servers-json | omp（经发现复用同一份） |
| omp | `.mcp.json` | mcp-servers-json | claude（若同装则合并为一次写入） |
| cursor | `.cursor/mcp.json` | mcp-servers-json | — |
| codex | `.codex/config.toml` | codex-toml | — |
| gemini | `.gemini/settings.json` | gemini-settings-json（顶层键即 `mcpServers`） | — |
| opencode | `opencode.json` | opencode-json | — |

仅装 OMP 时只写 `.mcp.json` 一份；claude+omp 同装同样只写一份。未安装智能体的首选目标不写。

路径事实抽到无副作用 facts 模块（discovery locations 归 adapter-facts，managed write targets 归新 facts 文件），catalog 与本服务各自单向消费，互不依赖。

### 每 format serializer 与期望输出 fixture（单测以此为准）

未安装对应 CLI 的目标照常跳过（reason: not-installed）；配置文件不存在则创建最小骨架并记 `existedBefore=false`。

```jsonc
// mcp-servers-json（.mcp.json / .cursor/mcp.json）与 gemini-settings-json 同形
{ "mcpServers": { "pier-memory": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-memory@0.6.3"],
    "env": { "MEMORY_FILE_PATH": "<store 绝对路径>" } } } }

// opencode-json（官方 local server schema：command 数组 + environment）
{ "mcp": { "pier-memory": {
    "type": "local",
    "command": ["npx", "-y", "@modelcontextprotocol/server-memory@0.6.3"],
    "environment": { "MEMORY_FILE_PATH": "<store 绝对路径>" } } } }

// codex-toml
[mcp_servers.pier-memory]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-memory@0.6.3"]
env = { MEMORY_FILE_PATH = "<store 绝对路径>" }
```

### 写入与移除隔离规则

- **不向第三方配置注入任何非 schema 字段**（v1 的 `pierManaged` 作废）。归属判定靠 ledger fingerprint。
- JSON：读-验-改-写（JSON.stringify 固定 2 空格缩进 + 尾换行；不追求保留用户原格式注释——这些格式均为机器管理文件）。同名 key 已存在且非 Pier 写入（fingerprint 不匹配）→ 该目标 failed（key 冲突明细）。
- TOML：新增 devDependency `smol-toml` **仅用于 parse 验证**（不重序列化、不破坏注释）。追加前必须 parse 通过且不存在 `mcp_servers.pier-memory` 的任何定义形式（table/inline/dotted）；否则拒写。移除时 parse 后按 marker 包裹块定位，校验块内容 fingerprint 未漂移才删；漂移则保留并报冲突。
- 全部读-判-写发生在 `FilePathTransactionLock` 单例锁内（app-core 同款）；另加 per-projectKey 操作互斥，enable/disable/status 不会交错执行；命令在 main 侧完成或补偿后才返回，不依赖 renderer 存活。
- **崩溃一致性（WAL）**：每个 target 动作前先把完整意图（含 `priorFingerprint` / `expectedFingerprint` / `commitRecord`）原子写入 `ledger.pending`（P1）→ 执行文件变更（P2）→ 按 pending 提交 target 记录并清除该条（P3）。P1 先于任何文件变更，因此任意时刻崩溃都不会留下「无法证明归属」或「虚假归属」的中间态：恢复阶段按上述三分支收敛，绝不自动认领。

### 引导段（AGENTS.md 托管段 + CLAUDE.md 引用）

- 组合方式：在锁内经 `agent-rules` ensure（AGENTS.md 不存在时按模板创建，`agentsMdExistedBefore=false` 记 ledger）→ read → marker 段替换 → write。agent-rules 本体**不新增 section API**。
- disable 还原语义：移除 marker 段后，若 AGENTS.md 系 Pier 创建（existedBefore=false）且剩余内容恰为 ensure 模板正文，则删除该文件还原「从未存在」；否则仅去段保留用户内容。
- marker：`<!-- pier-managed:memory begin -->` / `<!-- pier-managed:memory end -->`，段内整体替换，幂等。
- CLAUDE.md：存在且无 `@AGENTS.md` 引用时插入引用行，`insertedByPier=true` 记 ledger；disable 只移除自己插入的引用行，用户原有引用不动。

### 引导段内容（全文，面向智能体，英文）

```markdown
# Project memory (managed by Pier)

You have persistent project memory tools from the "pier-memory" MCP server.
Use them to make future sessions in this repository more effective:

- Before starting a non-trivial task, call search_nodes with keywords of the task domain.
- When you learn a durable fact, record it as an observation on the matching entity
  (create the entity when absent). entityType MUST be one of:
  convention | pitfall | decision | environment.
- Do NOT record anything derivable from the codebase (file layout, dependency lists,
  command --help output), transient task state, or secrets/tokens.
- When you notice an observation is outdated, delete it (delete_observations).
  This store has no automatic decay; pruning is your responsibility.
- Keep observations atomic: one fact per observation, self-contained wording.
```

---

## 安全约束

- `projectRoot` 仅接受宿主 PanelContext 解析出的已注册项目身份；服务入口拒绝任意字符串路径。canonical containment 校验复用 `files/path-identity.ts`。
- TOML 值经合规 encoder 转义；JSON 一律 serializer 输出；escape 测试覆盖引号/反斜杠/换行/symlink 替换。
- store 目录 0700、文件 0600；ledger 同权限。

---

## 操作反馈与 i18n（对齐宿主治理）

- 开关切换与状态摘要本身就是强自然 UI 反馈，**不加成功 toast**。
- degraded / 部分失败：面板内联告警行 + 「查看详情」经插件 dialogs facade 弹 alert 展示逐项目标 outcome（技术详情允许），禁止 silent catch；confirm 类交互走 `dialogs.confirm` 并显式 `intent`。
- 文案全部 i18n：`src/plugins/builtin/memory/locales/{en,zh-CN,ja,ko}.json`，覆盖面板标题、开关标签、派生状态、空态、失败/跳过原因、引擎版本行。中文遵循产品词表：「智能体」「记忆文件位置」，不说 MCP/store/renderer 等实现词；英文同步可读。
- 已知原生行为首次提示（一次性，i18n）：Claude Code 对项目级 `.mcp.json` 有一次性信任确认；引擎首次冷启动约 20 秒。

## 状态统计

`snapshotStatus` 的实体/观察计数：异步流式读取，单次扫描上限 8MB（超出显示「较大」而不计数值），按 mtime 缓存；容忍 ENOENT、破损行、未完整末行。不在 main 主线程同步扫描。

---

## 已知风险与取舍

| 风险 | 取舍/缓解 |
|---|---|
| 引擎无语义排序、无自动衰减 | 四类 entityType + 引导段修剪责任；语料小；L2 可换 provider |
| 记忆质量依赖智能体自觉 | 引导段约束 + 用户可关可清；L2 蒸馏队列加人工确认环 |
| 项目级配置含机器本地绝对路径，git 跟踪后跨机器失效 | reconcile 预检检测目标是否 git-tracked，warn 进状态详情；文案明示「本机记忆」。团队共享是 L2，前置为上游接受相对 cwd 解析 |
| npx 供应链 | **精确固定 `@0.6.3`**，升级随 Pier 发版并在状态显示版本 |
| TOML 追加策略 | smol-toml parse 验证 + 冲突拒写 + fingerprint 移除，见 writer 规则 |
| OpenCode/Cursor/Gemini schema 未来收紧 | serializer 按 format 独立演进 + verifiedOn 复查机制（adapter-facts 同款）；fixture 单测锁定 |

---

## 测试与治理计划

- **serializer fixture 矩阵**：5 格式 × {全新创建骨架 / 幂等重写 / 移除还原（自建骨架文件删除）/ 用户条目隔离 / key 冲突拒写 / fingerprint 漂移拒删}。TOML 另测：解析失败拒写、inline/dotted 冲突拒写、marker 块外内容字节不变。
- **并发**：双窗口同时 enable 的串行化；enable/disable/status 互斥；锁外不可见中间态。
- **ledger 与状态派生**：desired/outcome → disabled/enabled/degraded 映射；forward-only 重试收敛。
- **projectKey**：主仓 ↔ linked worktree 收敛、非 git 目录稳定、symlink、仓库移动。
- **安全**：未注册 projectRoot 拒绝；escape/symlink 用例；文件权限断言。
- **统计**：大文件截断、破损行容忍、mtime 缓存命中。
- **崩溃一致性**：P1 后未 P2 → 分支② 幂等重放；P2 后崩溃（含首次创建）→ 分支① 由 commitRecord 零推导提交；第三方漂移 → 分支③ 冲突保留不认领；remove 的 `"absent"` 指纹语义与引导段/引用两类 pending 全覆盖。
- **选择规则与确认门**：仅装 OMP 只写 `.mcp.json` 一份；claude+omp 同装单份；tracked 目标首次写入确认流（ack 持久化、取消零写入）；AGENTS.md 自建模板在 disable 后还原为不存在；插件停用后面板命令仍可关闭记忆。
- **治理检查点**：`tests/unit/plugins/pier-memory-governance.test.ts` 锁定本设计标题、四类 entityType、marker 常量单一来源、capability 仅进 desktop-renderer 默认集；service 测试在 `tests/unit/main/agent-managed-assets/`。

---

## 分阶段交付

1. **本设计（L1）**：facts 抽取 + 宿主服务/命令/preload/facade 接线 + 插件面板 + 全量测试。
2. **L2 候选（另行立项）**：记忆浏览增强、蒸馏候选队列、团队共享存储、mem0 provider seam 兑现；OpenHuman 式 Markdown 镜像（JSONL 知识图谱投影为人类可直接编辑的 md 笔记目录，编辑回流引擎）与语料增长后的实体热度主题组织。
