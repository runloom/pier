# Pier 资源监控终态设计

**日期**：2026-07-25  
**状态**：已确认  
**范围**：把工作台「系统资源」从整机仪表盘改为 **Pier 自身 + 终端/子进程 + 产品语义负载** 的资源账本；替换 `core.system-resources` 的数据语义与 UI 叙事  
**关联**：

- 调研结论：本会话（Chrome Task Manager / VS Code Process Explorer / iTerm Jobs / Agentinel 对照）
- **卡面视觉与尺寸纪律**：对齐成本总览物料（`cost-overview-widget.tsx` 的 compact / medium / full 密度；KPI 极简无框；container query 列数；`size` 做结构取舍）
- `docs/archive/superpowers/specs/2026-07-23-cost-overview-multi-view-design.md`（成本卡信息架构与密度先例）
- `AGENTS.md` 工作台物料协议 v3、物料 UI 质量红线、操作反馈、用户文案
- 活动域：`foreground-activity`（状态可见性，**不**承担 OS 资源）
- 实现锚点（现状）：`system-stats.ts`、`system-stats.store.ts`、`system-resources-widget.tsx`、`core-metrics.ts`
- 可复用先例：`background-task-process-ledger.ts`（只登记本 app 进程、禁全局扫杀）

---

## 1. 目标与完成标准

### 1.1 产品目标

工作台资源物料回答的问题从：

> 这台机器忙不忙？

改为：

> **Pier 现在吃多少？哪个终端 / 智能体 / 任务在烧 CPU 或内存？我该聚焦哪个面板？**

对标业界最佳实践的合成，而不是单产品抄袭：

| 业界能力 | 借鉴到 Pier |
| --- | --- |
| Chrome / VS Code **应用内进程浏览器** | Pier Electron 进程族（main / renderer / GPU / utility）CPU + 内存合计与分项 |
| iTerm **session job tree** | 每个终端 panel 以 shell 为根的进程树与聚合指标 |
| 多 agent 资源哨兵 | 用 `foreground-activity` / task 身份把进程树 **产品化分组**，不是裸 PID 列表 |
| 拉取式可见才采样 | 保持现有 acquire/release 零开销纪律 |

### 1.2 完成标准（终态）

1. **范围正确**：默认展示的是 Pier 相关负载，不是整机 CPU/内存/负载。
2. **Electron 完整**：Pier 本体内存/CPU 覆盖 `app.getAppMetrics()` 可见的全部关联进程，并提供合计；禁止再用「仅 main `process.memoryUsage().rss`」冒充应用占用。
3. **终端可归因**：每个存活终端 session 有 root shell PID、聚合 CPU%、聚合内存、前台/热点子进程摘要；可展开到有限深度进程树。
4. **产品语义可归因**：终端行能关联到 `agent` / `task` / `shell` / `idle` 活动（有则显示，无则退化为「终端」）。
5. **可行动**：点击行可聚焦对应 panel；可选「结束进程」仅限 **用户显式确认** 且仅作用于本 session 树内 pid（见非目标与安全）。
6. **可见才采样**：无订阅方时 main 侧无常驻高频采样；`visible=false` 必须停表。
7. **文案产品化**：中文界面用「工作台资源 / Pier 内存 / 终端 / 智能体」等产品词；禁止 DETACHED、renderer、ptyHost 等实现词进入前台主路径（开发者命令面板可保留技术名）。
8. **指标目录一致**：自定义卡片可消费同一快照投影的 `core.pier.*` 指标；旧 `core.system.*` 整机指标退出主路径或降为可选背景。
9. **卡面产品级、全尺寸可用**：视觉与信息节奏对齐成本总览（dense KPI、无装饰框堆砌、趋势区 `flex-1 min-h-0`）；`size` 驱动 **compact / medium / full** 结构降级，container query 驱动列数与行密度；**minSize 必须能读到核心数字**，窄/中/宽、矮/中/高均不破版、不横向溢出、不用 `display:none` 静默丢掉唯一有意义内容（可摘要化，见 §8）。

---

## 2. 现状为什么不对

| 层 | 现状 | 问题 |
| --- | --- | --- |
| 契约 | `SystemStatsSnapshot`：整机 CPU/mem/load + `appMemoryRss` | 叙事是「系统监控」；`appMemoryRss` 只是主进程 |
| 采样 | `os.cpus` / `freemem` / `loadavg` / `process.memoryUsage` | 与用户关心的 Pier/终端无关 |
| UI | 四格 + 整机 CPU 趋势 | 无法定位「哪个终端」 |
| 活动域 | `foreground-activity` 很完整 | 有状态无资源，两域未汇合 |
| 终端 native | 有 lifecycle / processAlive | 资源层尚未暴露稳定 shell PID 契约 |

根因不是缺图表，而是 **监控主体选错**：把 OS 整机当成工作台一等公民，却把 Pier 托管的工作负载当成黑盒。

---

## 3. 非目标

- **不是** 系统级 Activity Monitor / htop 替代品；不做全机进程表、磁盘/网络全景、GPU 整机仪表。
- **不是** 远程主机资源监控（SSH 远端 CPU/内存属远程会话能力，本设计不覆盖）。
- **不是** 把资源状态写进 `ForegroundActivity` 契约（活动域继续只表达会话/任务状态；资源域只 **只读关联** panelId）。
- **不是** 自动杀进程、后台看门狗、OOM 自动回收策略。
- **不是** 持久化历史时序到磁盘（ring buffer 仅内存；与现 system-stats 一致）。
- **不是** 插件贡献任意进程扫描（进程树枚举是宿主特权，不开放第三方扫描 API）。
- **不** 为「好看」保留整机四格作为默认主视图。

可选背景信号（见 §6.4）可以极轻量存在，但不得主导布局与命名。

---

## 4. 概念模型：三层账本

终态只认三层，UI 与契约都围绕它们展开：

```text
┌─────────────────────────────────────────────────────────────┐
│ L0  汇总（Pier 总 CPU / 总内存 / 终端数 / 热点负载）          │
└─────────────────────────────────────────────────────────────┘
          │                         │
          ▼                         ▼
┌──────────────────────┐  ┌──────────────────────────────────┐
│ L1  Pier 本体        │  │ L2  工作负载（按 panel 归因）      │
│ Electron 进程族      │  │ 终端 session → 进程树             │
│ main/window/gpu/...  │  │ + L3 产品身份（agent/task/shell） │
└──────────────────────┘  └──────────────────────────────────┘
```

### 4.1 L1 — Pier 本体（App Process Family）

- **定义**：Electron 认为与本 app 关联的进程（`app.getAppMetrics()` 返回集合）。
- **语义标签**（产品文案，非 Chromium 内部名直接露出）：

| type（实现） | 产品标签 |
| --- | --- |
| Browser（main） | 主进程 |
| Tab / Renderer | 窗口界面 |
| GPU | 图形 |
| Utility | 辅助服务 |
| 其他 | 其他 Pier 进程 |

- **指标**：每进程 `cpuPercent`（0–100，按核归一见 §7.3）、`memoryBytes`（优先 working set / private，见 §7.3）、pid、type。
- **合计**：`pierCpuPercent`、`pierMemoryBytes` = L1 各项之和（**不含** L2 外部 shell 子孙，见下条说明）。

> **重要边界**：PTY 内的 shell / claude / node 等是 **OS 子进程**，通常 **不在** `getAppMetrics()` 里。因此 **L1 合计 ≠ 「Pier 相关一切」**。完整「工作台占用」= L1 + L2 去重后的并集（§7.4）。

### 4.2 L2 — 终端会话进程树（Session Process Tree）

- **定义**：每个存活终端 panel 的 **root shell PID** 及其子孙进程集合。
- **根来源**：native Ghostty / PTY 层在 session 创建与存活期间提供稳定 `shellPid`（终态硬依赖；缺 pid 的 session 标记 `attribution: "unknown"`，只显示 panel 存在、资源为 null）。
- **指标**：
  - 树聚合：`cpuPercent`、`memoryBytes`（子树求和，注意 shared 内存口径 §7.3）
  - 摘要：`topProcess`（当前子树内 CPU 最高非 shell 进程，或前台 job 名）
  - 可选展开：深度有限的 `children[]`（默认深度 2–3，节点上限 N）
- **不含**：与本 panel 无关的全局进程；禁止「扫所有 node」。

### 4.3 L3 — 产品身份投影（Product Identity）

- **定义**：把 L2 行 **关联** 到已有活动/任务身份，不重新发明会话状态机。
- **关联键**：`panelId`（+ `windowId` 若需要消歧）。
- **来源优先级**（只读）：
  1. `foreground-activity` 中该 panel 的 activity（agent / task / shell / idle）
  2. 后台 task run 若绑在该 panel，补 `taskId` / `runId` / label
  3. 都无 → `kind: "terminal"`，标题用 panel 标题或「终端」
- **资源数字永远来自 L1/L2 采样**，不来自 hook 文案解析。

### 4.4 L0 — 汇总

| 字段 | 含义 |
| --- | --- |
| `pierAppMemoryBytes` / `pierAppCpuPercent` | 仅 L1 |
| `workloadMemoryBytes` / `workloadCpuPercent` | 仅 L2 全部 session 聚合 |
| `totalRelatedMemoryBytes` / `totalRelatedCpuPercent` | L1∪L2 去重后（终态主 KPI） |
| `terminalCount` / `hotCount` | session 数；超过阈值的热点数 |
| `sampledAt` | 采样墙钟 |

「热点」定义（可配置常量，默认）：`cpuPercent ≥ 25` 或 `memoryBytes ≥ 512MiB`（单 session 聚合）。

---

## 5. 所有权划分

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| native / 终端 session 注册表 | 暴露 `panelId → shellPid`、存活与 lifecycle 对齐 | 不做 CPU 百分比算法 |
| `pier-resource` main 服务 | 统一采样、组装快照、PID 树枚举、去重 | 不改 activity 状态机 |
| `app.getAppMetrics` 适配 | L1 读取与 type 映射 | 不扫外部进程 |
| 平台进程枚举器 | macOS/Linux/Windows 子孙枚举与 per-pid 资源 | 不暴露给插件 |
| 身份投影 | 读 activity / task store 快照做 join | 不反向写 activity |
| IPC + preload | 拉取式 `snapshot`（及可选 `list` 细粒度） | 不广播高频资源流 |
| renderer store | acquire 轮询、ring buffer 历史、错误态 | 不直接调 OS |
| 物料 UI | L0 KPI + 列表 + 可选展开 + 聚焦 | 不做全机图 |
| 指标目录 | `core.pier.*` 投影 | 旧 `core.system.*` 整机指标退出主路径 |
| 命令面板（可选） | `Developer: Open Pier Process Explorer` 完整表 | 不替代工作台主物料 |

模块边界建议：

```text
src/main/services/pier-resource/
  types.ts                 # 内部采样结构
  app-metrics.ts           # L1
  process-tree.ts          # 平台枚举门面
  process-tree-darwin.ts
  process-tree-linux.ts
  process-tree-win32.ts    # 可降级
  session-registry.ts      # panelId → shellPid 订阅终端层
  assemble-snapshot.ts     # L0+L1+L2+L3 join
  index.ts

src/shared/contracts/pier-resource.ts   # 对外契约（替换/演进 system-stats）
src/main/ipc/pier-resource.ts
src/preload/pier-resource-api.ts
src/renderer/stores/pier-resource.store.ts
src/renderer/panel-kits/workbench/core-widgets/pier-resources-widget.tsx
```

**dependency-cruiser**：`pier-resource` 可依赖 terminal session 只读查询与 electron `app`；**禁止** import `services/agents/` 实现细节；身份只通过 activity 投影端口（与 foreground-activity 单向：activity ⊥ resource 采样核心，join 发生在 assemble 层读 activity 快照）。

---

## 6. 数据契约（终态）

### 6.1 快照（renderer 主消费）

```ts
// 逻辑形状；实现用 zod strict
type PierResourceSnapshot = {
  sampledAt: number;

  /** L0 */
  summary: {
    pierAppCpuPercent: number | null;
    pierAppMemoryBytes: number;
    workloadCpuPercent: number | null;
    workloadMemoryBytes: number;
    /** L1∪L2 去重后的工作台相关合计 —— 物料主数字 */
    totalRelatedCpuPercent: number | null;
    totalRelatedMemoryBytes: number;
    terminalCount: number;
    hotCount: number;
    /** 可选背景：整机可用内存，仅作「机器是否见底」弱信号，默认 UI 可折叠 */
    hostMemoryFreeBytes?: number;
    hostMemoryTotalBytes?: number;
  };

  /** L1 */
  appProcesses: readonly AppProcessMetric[];

  /** L2 + L3 */
  sessions: readonly SessionResourceRow[];

  /** 采样元数据 */
  meta: {
    /** 首次 CPU 差分尚未就绪时 true */
    cpuWarmingUp: boolean;
    /** 进程树枚举降级说明（如 win32 仅 root） */
    treeCapability: "full" | "shallow" | "unavailable";
    platform: "darwin" | "linux" | "win32";
  };
};

type AppProcessMetric = {
  pid: number;
  role: "main" | "window" | "gpu" | "utility" | "other";
  cpuPercent: number | null;
  memoryBytes: number;
  /** 仅开发者视图使用；产品 UI 用 role 文案 */
  typeName?: string;
};

type SessionResourceRow = {
  panelId: string;
  windowId: string;
  shellPid: number | null;
  /** 子树聚合 */
  cpuPercent: number | null;
  memoryBytes: number | null;
  processCount: number | null;
  topProcess: {
    pid: number;
    name: string;
    cpuPercent: number | null;
    memoryBytes: number | null;
  } | null;
  /** 有限深度树；默认物料可不请求，见 §6.2 */
  tree?: readonly ProcessNode[];
  identity: SessionIdentity;
  hot: boolean;
};

type SessionIdentity =
  | {
      kind: "agent";
      agentId: string;
      status?: string;
      sessionTitle?: string;
    }
  | { kind: "task"; taskId: string; runId: string; label: string }
  | { kind: "shell"; commandLine?: string }
  | { kind: "idle" }
  | { kind: "terminal" };

type ProcessNode = {
  pid: number;
  ppid: number;
  name: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  children: readonly ProcessNode[];
};
```

### 6.2 拉取 API

保持 **拉取式**，与现 system-stats 同构：

```ts
// preload
pier.resources.snapshot(options?: {
  /** 是否带 sessions[].tree；默认 false，省枚举成本 */
  includeTrees?: boolean;
  /** 树深度与节点上限 */
  treeDepth?: number; // default 2
  treeNodeLimit?: number; // default 40 per session
}): Promise<PierResourceSnapshot>;
```

- 物料默认 `includeTrees: false`，仅汇总 + 行摘要 + topProcess。
- 用户展开某行时，可对 **单 panel** 再拉一次 `snapshot({ includeTrees: true })` 或增加细接口 `pier.resources.sessionTree(panelId)`（终态推荐细接口，避免全局重扫）。

细接口（终态推荐）：

```ts
pier.resources.sessionTree(panelId: string, opts?: {
  depth?: number;
  nodeLimit?: number;
}): Promise<ProcessNode | null>;
```

### 6.3 历史序列

renderer 侧 ring buffer（不落盘）：

| 序列 | 用途 |
| --- | --- |
| `totalRelatedCpu` | 主趋势图 |
| `totalRelatedMemory` | 可选第二趋势或切换 |
| 可选 per-panel 仅在展开/钉选时维护 | 避免 N 路历史默认开销 |

容量建议：2s × 150 ≈ 5 分钟（与现 CPU 历史一致）。

### 6.4 整机字段策略

- **默认物料不展示** 整机 CPU%、load average、整机已用内存进度条。
- `hostMemoryFreeBytes/Total` 仅作为 **弱背景**（例如页脚「本机可用 3.2 GB」），帮助判断「是 Pier 胖还是机器已经顶满」。
- 指标目录 **不** 再主推 `core.system.cpu` 等整机指标；迁移见 §11。

### 6.5 与旧契约关系

| 旧 | 终态 |
| --- | --- |
| `SystemStatsSnapshot` | 删除或仅 test 兼容层 |
| `PIER.SYSTEM_STATS_SNAPSHOT` | 替换为 `PIER.PIER_RESOURCE_SNAPSHOT`（+ sessionTree） |
| `core.system-resources` widget id | **已确认：同 id 换心**——保留 id，title/description/searchTerms/实现全部改为 Pier 资源叙事 |
| `core.system.*` metrics | 废弃；新增 `core.pier.*` |

---

## 7. 采样与算法

### 7.1 触发模型

```text
widget visible / metric subscribe
        │
        ▼
acquire() → refCount++
        │
        ├─ 立即 snapshot 一次
        └─ setInterval 2000ms
                │
                ▼
refCount==0 → clearInterval（零开销）
```

- 与现 `system-stats.store` 相同纪律。
- `refreshToken` 触发立即补采。
- **禁止** main 在无订阅时后台轮询。

### 7.2 分层采样成本

| 数据 | 成本 | 默认间隔 | 条件 |
| --- | --- | --- | --- |
| L1 `getAppMetrics` | 低 | 2s | 有订阅 |
| L2 shellPid 列表 | 极低（注册表） | 2s | 有订阅 |
| L2 per-pid CPU/mem | 中（按 pid 批量） | 2s | 有订阅；pid 集合为空则跳过 |
| L2 全树构建 | 高 | 仅展开/细接口 | 按 panel |
| 身份 join | 极低（内存快照） | 每次组装 | 始终 |

优化：

- 维护 `lastCpuSampleByPid: Map<pid, { t, totalTime }>` 做差分；pid 消失则删除。
- 单次 snapshot 的 wall time 预算：默认路径 **&lt; 50ms**（目标）；超时则返回上一帧 + `meta.degraded`（若加字段）。
- 同一 tick 内 L1+L2 共用采样时间戳 `sampledAt`。

### 7.3 CPU / 内存口径

**CPU**

- 使用平台进程 CPU 时间差分 / 墙钟差分，得到 **相对于单核的百分比**（可 &gt;100% 表示多核）。
- **已确认**：与 VS Code Process Explorer / macOS Activity 一致，采用 **单核基准、可超过 100%**，文案用 `12%` / `180%`。KPI **不**画「占满整机」的 Progress（避免与 0–100 整机条混淆）；session 行可用细条表达相对高低，但数值仍按单核基准。

**内存**

- 优先 **物理占用（RSS / working set）**。
- 子树求和会 **高估** 共享库映射——可接受；UI 用「约」仅在展开说明，不在 KPI 卖惨。
- L1 使用 Electron `ProcessMetric.memory` 字段（KB→bytes），与 L2 RSS **分开展示**，合计时在文案上称「相关进程合计（约）」。

**去重（L1∪L2）**

- 以 **pid 集合** 去重：同一 pid 只计一次（通常 shell 不在 app metrics 内，冲突少）。
- 若未来 utility 托管 pty（类似 VS Code ptyHost），注册表需标记 pid 归属，避免双计。

### 7.4 session 注册表

终态要求终端层提供只读查询：

```ts
type TerminalSessionResourceHandle = {
  panelId: string;
  windowId: string;
  lifecycleId: string;
  shellPid: number | null;
  alive: boolean;
};
```

- shellPid 在 PTY spawn 成功后写入；exit 后清空。
- panel 跨窗 transfer 时 **pid 随 session 走**，注册表以 lifecycle/session 为准，不以短暂 panelId 缓存资源历史。
- native 暂不可得时：`shellPid: null`，该行资源 null，但仍可显示 identity（活动层独立）。

### 7.5 平台能力

| 平台 | 进程树 | 说明 |
| --- | --- | --- |
| macOS | `full` | `libproc` / `sysctl` 枚举子孙；优先原生，避免每 2s 狂敲 `ps` |
| Linux | `full` | `/proc` 扫描 ppid 闭包 |
| Windows | `shallow` → 演进 `full` | 首期可仅 root + 直接子进程；Toolhelp 全树作后续 |

`meta.treeCapability` 驱动 UI：shallow 时隐藏深树、文案「此平台仅显示直接子进程」。

### 7.6 与 background-task ledger 的关系

- **ledger**：生命周期回收、防误杀，不是实时监控源。
- **资源监控**：可读 ledger 中仍存活的 background run pid，作为 **无 panel 的 workload 行**（可选 P1）：`kind: "background-task"`。
- 禁止资源模块调用 kill；杀进程若做，必须独立 command + 确认对话框 + 与 ledger 身份校验同一套指纹纪律。

---

## 8. UI 终态（工作台物料）

卡面必须达到与 **成本总览** 同级的产品完成度：dense 仪表盘节奏、清晰主数字、列表/趋势可伸缩，而不是旧版「四格 Meter + 粗 Progress」的系统监控感。

### 8.1 定位与命名

| 项 | 值 |
| --- | --- |
| 物料 id | **`core.system-resources`（同 id 换心，已确认）** |
| 标题 | 「工作台资源」（en: Workbench resources） |
| 描述 | 「查看 Pier 与终端占用的 CPU 和内存」 |
| 分类 | `system` 可保留；searchTerms：内存、CPU、终端、智能体、进程、资源 / memory, cpu, terminal, agent, process |
| 与「活动总览」分工 | **活动** = 在忙什么；**资源** = 吃多少。禁止两卡合并 |
| 与「成本总览」关系 | **正交数据、同构卡面**：成本看钱/token，资源看 CPU/内存；布局密度、KPI 样式、页脚新鲜度对齐成本卡 |

### 8.2 物料声明尺寸

对齐成本卡「min 能读核心、default 完整叙事」：

| 字段 | 建议 | 说明 |
| --- | --- | --- |
| `minSize` | `{ w: 2, h: 2 }` | compact 只保留主数字，与成本卡 min 同级 |
| `defaultSize` | `{ w: 4, h: 4 }` | medium/full 交界：KPI + 趋势或列表至少一块 |
| `maxSize` | `{ w: 12, h: 12 }` | 与其它 core 物料一致 |
| `refreshable` | `true` | 拉取式；refreshToken 立即补采 |
| `multiInstance` | `false` | 全局一份账本即可（与成本多视角不同） |
| `configurable` | `false`（P0–P2） | 卡面不堆筛选；若 P3 要「默认排序/隐藏本体」再开设置 |

### 8.3 密度模型（对齐成本总览）

实现上抽出与成本卡同构的密度函数（可本地复制，不必强行共享模块，避免 widget 交叉 import）：

```ts
type ResourceDensity = "compact" | "medium" | "full";

function densityFor(size: { h: number; w: number }): ResourceDensity {
  if (size.h <= 2 || size.w <= 2) return "compact";
  if (size.h <= 3) return "medium";
  return "full";
}
```

| 密度 | 触发 | 结构（`size` 决策） | 布局密度（container query） |
| --- | --- | --- | --- |
| **compact** | `h≤2` 或 `w≤2` | **仅 KPI**：相关合计内存 +（w≥3 时）相关 CPU；无趋势、无列表、无页脚、无滚动 | 单列或 2 KPI 横排；`justify-center`；字号略收（对齐成本 `KpiTile compact`） |
| **medium** | `h=3` 且 `w≥3` | KPI（2–4）+ **二选一主区**：优先 **负载列表**（Top N）；无完整描述 | KPI：`@[24rem]:grid-cols-2`；列表行更紧 |
| **full** | `h≥4` 且 `w≥3` | 可选短描述 + 完整 KPI + **趋势**（`flex-1`）+ **负载列表** + 页脚；Pier 本体可折叠 | KPI：`@[24rem]:2 @[36rem]:4`；列表随高度加行 |

**分工铁律（与 AGENTS 物料红线一致）：**

- `size` → 渲染哪些区块（结构）
- container query → 已渲染区块怎么排（列数/换行）
- **禁止** 用 container query `display:none` 丢掉唯一有意义内容
- 高度不足时列表 `min-content` + 卡片内滚动，不靠拉大间距假填满

### 8.4 KPI 集合与可见数量

KPI 使用成本卡同款 **无边框、无底色** 的 label + 大号 `tabular-nums`（禁止退回旧 MeterTile 的 bordered 卡套 Progress 作为主 KPI）。

| KPI id | 含义 | compact | medium | full |
| --- | --- | --- | --- | --- |
| `totalMemory` | 相关合计内存（L1∪L2） | **必显**（主数字） | 显 | 显 |
| `totalCpu` | 相关合计 CPU | w≥3 显，否则可只留内存 | 显 | 显 |
| `appMemory` | Pier 本体 | 不 | w≥6 可显 | 显 |
| `workloadMemory` | 终端负载 | 不 | w≥6 可显 | 显 |

```ts
function maxKpisFor(density: ResourceDensity, width: number): number {
  if (density === "compact") return width <= 2 ? 1 : 2;
  if (density === "medium") return width >= 6 ? 4 : 2;
  return 4;
}
```

主数字优先级固定：`totalMemory` > `totalCpu` > `appMemory` > `workloadMemory`，按 `maxKpisFor` 截断。

### 8.5 列表与趋势的可见规则

| 区块 | compact | medium | full |
| --- | --- | --- | --- |
| 描述文案 | 否 | 否 | `h≥4` 可一行说明（对齐成本 `showDescription`） |
| 相关 CPU 趋势 | 否 | 否（空间给列表） | `h≥4` 且历史 ≥2 点；区 `min-h-0 flex-1` |
| 负载列表（L2+L3） | 否 | Top `sessionLimit` | Top `sessionLimit`，可展开树 |
| Pier 本体（L1）折叠区 | 否 | 否 | 默认可折叠，展开见分项 |
| 页脚（刷新时间 + 可选本机可用） | 否 | 是（仅相对时间） | 是（时间 + 弱背景本机可用） |

```ts
function sessionLimitFor(density: ResourceDensity, height: number): number {
  if (density === "compact") return 0;
  if (density === "medium") return height <= 3 ? 3 : 5;
  return height >= 6 ? 12 : height >= 5 ? 8 : 6;
}
```

列表排序默认：**热点优先**（`hot`），其次 CPU 降序，再次内存降序。  
行内容（单行不换行，`truncate`）：

```text
[身份图标/色点]  标题（智能体名 / 任务 label / 命令摘要）  内存  CPU%
                 副行（可选，full 且行高允许）：topProcess 名
```

- 标题走 L3 产品文案；中文「需要你处理」等与活动域一致，不直出内部 status 码。
- 点击整行 → 聚焦 panel（强自然反馈，无 toast）。
- medium/full 行高保持 28px 节奏或略松的 32px 信息行；交互热区完整可点。

### 8.6 full 布局线框（默认 defaultSize）

```text
┌─ 工作台资源 ─────────────────────────────────────┐
│ （full）查看 Pier 与终端占用的 CPU 和内存          │
│                                                    │
│ 相关内存     相关 CPU      Pier 本体   终端负载   │  ← dense KPI，无框
│ 1.2 GB       48%           380 MB      820 MB     │
│                                                    │
│ ┌─ 相关 CPU 趋势 ──────────────────────────────┐ │  ← flex-1 min-h-0
│ │  area chart（chart-1，无动画刷屏）            │ │
│ └──────────────────────────────────────────────┘ │
│                                                    │
│ 终端与负载                                         │
│ ● Codex · 需要你处理              420 MB   32%  › │
│ ● 构建 · npm test                 210 MB   90%  › │
│ ○ 终端 · zsh                       12 MB    0%  › │
│                                                    │
│ ▸ Pier 进程（4）                    380 MB        │  ← 折叠
│ 3 秒前更新 · 本机可用 3.2 GB                       │
└────────────────────────────────────────────────────┘
```

### 8.7 各尺寸验收矩阵（实现必测）

| size 约 | 密度 | 必须可见 | 禁止 |
| --- | --- | --- | --- |
| 2×2 | compact | 相关内存 | 双滚动条、截断成空、整机 Progress |
| 3×2 / 4×2 | compact | 内存 + CPU | 列表、趋势 |
| 4×3 | medium | 2 KPI + ≥3 负载行 | 假空白、横向溢出 |
| 6×3 | medium | 最多 4 KPI + 列表 | KPI 换行把列表挤没（列表优先 min 高度） |
| 4×4 | full | KPI + 趋势或列表至少一主区完整 | 趋势区高度 0 |
| 6×5+ | full | KPI + 趋势 + 列表 + 页脚 | 内容用 `hidden` 藏数据 |

container 变窄时：KPI 由 4→2→1 列；列表标题截断、数值列 `shrink-0 tabular-nums`。  
**高度富余**：顶部对齐，不垂直居中整卡内容装腔（compact 除外可 `justify-center` 以利小组件观感，与成本卡一致）。

### 8.8 视觉与组件规范

| 点 | 要求 |
| --- | --- |
| KPI | 对齐成本 `KpiTile`：无 border/bg 卡套；label `text-xs text-muted-foreground`；value `font-semibold text-lg tabular-nums` |
| 趋势 | `ChartContainer` + `AreaChart`；`isAnimationActive={false}`；色 `var(--chart-1)` |
| 列表行 | 不用厚重 Meter；热点可用 subtle 左侧色条或 status token 点 |
| 进度条 | **不**用于主 KPI 表达「占整机比例」；session 可选极细相对条 |
| 三态 | `WidgetSkeleton` / `WidgetError`+重试 / 列表空用 `WidgetEmpty`（「暂无终端」+ 下一步） |
| 间距 | 卡内 `p-3`、区块 `gap-3`（compact `gap-2`），落在 12px 节奏 |
| 格式化 | `@pier/ui/format`：`formatBytes` / 百分比 / `formatRelativeTime` |
| 测试 id | `data-density`、`data-testid="pier-resources-…"` 便于 e2e |

### 8.9 交互

| 动作 | 行为 |
| --- | --- |
| 点击 session 行 | 聚焦并激活对应 panel |
| 展开 session（full） | `sessionTree(panelId)`；树缩进展示；再点收起 |
| 展开 Pier 进程 | 本地展开 L1 分项，无额外 IPC |
| 刷新 | refreshable + refreshToken |
| 结束进程 | **非 v1 必达**（P3 可选）；若做则 destructive confirm |

### 8.10 开发者完整浏览器（可选同终态）

命令面板：`开发者: 打开 Pier 进程浏览器`  
全表诊断；与工作台物料共用 `pier-resource` 服务。物料保持精简叙事，不做成内嵌全屏 htop。

---

## 9. 指标目录（自定义卡片）

终态注册：

| id | 含义 |
| --- | --- |
| `core.pier.totalMemory` | L1∪L2 合计内存 |
| `core.pier.totalCpu` | L1∪L2 合计 CPU |
| `core.pier.appMemory` | 仅 L1 |
| `core.pier.workloadMemory` | 仅 L2 |
| `core.pier.terminalCount` | 终端 session 数 |
| `core.pier.hotCount` | 热点数 |
| `core.pier.totalCpuHistory` | 相关 CPU 序列 |

废弃主路径：`core.system.cpu` / `memoryUsed` / `memoryPercent` / `load1` / `appMemory`（旧语义）。  
自定义卡片已引用旧 id 时：salvage 映射到最接近的 `core.pier.*` 或显示「指标已更新」空态（实现期定，推荐硬映射 `appMemory→core.pier.appMemory`，整机指标 → 移除并提示）。

---

## 10. 安全、隐私与纪律

1. **只枚举已登记 root**：shellPid 来自本 app session 注册表；background task 来自 ledger；**禁止** 枚举其他用户进程或「所有 node」。
2. **命令行展示**：`commandLine` / process name 可能含路径与参数——UI 截断；不上传、不写日志全文（对齐现有 shell activity 长度上限）。
3. **杀进程**：默认不做；若做必须 confirm + 子树归属校验 + 不杀 L1 关键进程（main/window）。
4. **插件**：不提供 `process.enumerate` 类 host API；插件只能通过工作台物料或指标只读消费宿主投影。
5. **性能**：可见才采样；树按需；平台原生 API 优先于 shell out。

---

## 11. 迁移策略

1. **契约替换**：新增 `pier-resource` 契约与 IPC；旧 `system-stats` 删除（或一版兼容 shim 返回映射后的 summary，仅过渡）。
2. **物料 id**：优先 **同 id 换心**，用户布局不丢卡。
3. **文案与搜索词**：system → 工作台/Pier/终端。
4. **测试**：
   - 单测：assemble 去重、身份 join、salvage、CPU 差分、`densityFor` / `maxKpisFor` / `sessionLimitFor`
   - 组件：**compact / medium / full** 结构快照或 testid 断言；2×2 仅主数字；4×3 有列表无趋势；4×4+ 有趋势或完整区；三态与热点行
   - 治理：禁止业务再读 `os.loadavg` 作为工作台主指标；禁止资源主 KPI 使用整机 Progress
   - e2e：物料可添加、可见轮询、不可见停表（可 spy IPC 调用次数）
5. **文档**：`AGENTS.md` 中 system-stats 引用改为 pier-resource；指标红线补充「工作台资源默认不展示整机 CPU」。

---

## 12. 分阶段交付（仍指向同一终态）

终态一次设计、分 PR 落地，避免半套整机 + 半套 Pier 长期共存。

| 阶段 | 交付 | 验收 |
| --- | --- | --- |
| **P0** | L1 全量 + L0（Pier 本体作 total 近似）+ **成本级卡面**（dense KPI + compact/medium/full）+ 去整机主 KPI；shellPid 注册表打通 | 2×2/4×3/4×4 均可用；内存接近 Activity 中 Pier 量级 |
| **P1** | L2 聚合 + L3 身份 + 列表 + 点击聚焦；L0 改为真·相关合计 | 列表能指出最肥终端；medium/full 列表行数随 h 变化 |
| **P2** | 趋势 + 按需进程树 + `core.pier.*` 指标 + 旧 metric 迁移 | full 有趋势；展开可见 job tree |
| **P3** | 开发者进程浏览器；可选 background-task 行；可选结束进程 | 诊断闭环 |

每一阶段结束后：叙事必须是「工作台/Pier」；卡面必须保持成本级密度，不得回退整机四格 Meter。

---

## 13. 与相邻系统的边界

| 系统 | 关系 |
| --- | --- |
| `foreground-activity` | 只读 join；资源数字不进入 activity broadcast |
| 活动总览物料 | 互补；可交叉跳转同一 panel，不合并 |
| 成本总览 | 金钱/token 与 CPU/内存 **数据正交**；**卡面密度/KPI/页脚/三态同构**，资源卡实现时应对照 `cost-overview-widget.tsx` 验收，而不是对照旧 system-resources |
| 终端状态栏 | 可未来挂「本 session 内存」轻量项，数据仍来自 pier-resource 单 session 查询，不另起炉灶 |
| Agent attention / 通知 | 不因 CPU 高自动通知（避免噪声）；除非未来独立「资源告警」设置 |

---

## 14. 推荐默认参数与常量

```ts
const PIER_RESOURCE = {
  pollIntervalMs: 2000,
  historyCap: 150,
  defaultTreeDepth: 2,
  defaultTreeNodeLimit: 40,
  hotCpuPercent: 25,      // 单核基准
  hotMemoryBytes: 512 * 1024 * 1024,
  commandLineMax: 200,    // UI 截断
  snapshotBudgetMs: 50,   // 软预算
} as const;
```

---

## 15. 成功画面（Dogfood 场景）

1. 开 3 个终端：一个 idle zsh，一个 `npm test` 打满 CPU，一个 Codex 会话。  
2. 工作台资源卡（约 4×4）：KPI 像成本卡一样干净；**相关合计**上升；列表中 npm CPU 最高、Codex 内存突出。  
3. 把卡缩到 2×2：仍能读到相关内存，不破版、不空壳。  
4. 拉到 6×5：出现趋势 + 更长列表 + 页脚；点击 Codex 行聚焦 panel。  
5. 展开 npm 行 → 看到 node 子进程。  
6. 关掉工作台或不可见 → 采样停止。  
7. Activity Monitor 中 Pier 本体与卡上「Pier 本体」同量级；终端 node 归在「终端负载」。

---

## 16. 已确认决策

| # | 议题 | 决定 |
| --- | --- | --- |
| 1 | CPU 展示 | **单核基准，可 &gt;100%** |
| 2 | 物料 id | **`core.system-resources` 同 id 换心** |
| 3 | 结束进程 | **不进 v1 必达**；P3 可选 |
| 4 | Windows 进程树 | **首发允许 `shallow`**，`meta.treeCapability` 标明 |
| 5 | 卡面品质 | **对齐成本总览**：dense KPI、compact/medium/full、全尺寸可验收 |
| 6 | 整机指标 | **退出主 KPI**；最多页脚弱提示本机可用内存 |

---

## 17. 结论

最佳实践终态不是「更好看的系统监控」，而是：

> **以 Pier 为根的资源账本：Electron 本体（L1）+ 终端进程树（L2）+ 活动/任务身份（L3）；工作台物料用与成本总览同级的产品卡面讲清楚「相关合计」与「归到哪个面板」，并在 compact / medium / full 全尺寸下可读可用；采样可见才工作，绝不扫全机。**

这与 Chrome / VS Code 的应用内进程浏览器、iTerm 的 session jobs、多 agent 归因需求一致，并贴合 Pier 已有的 panel / activity / task 模型与工作台物料视觉体系。
