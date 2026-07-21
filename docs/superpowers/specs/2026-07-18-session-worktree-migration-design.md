# 会话新建工作树：检测与展示

> 日期：2026-07-18  
> 状态：设计稿待审（已按「AI 只建树、不改目录」重写）  
> 相关：[Worktree 创建](./2026-07-02-worktree-creation-design.md)、[Git 状态栏](./2026-07-01-git-status-bar-design.md)

## 1. 要解决的真实问题

智能体在**当前终端会话**里执行 `git worktree add`（或等价操作）时，常见行为是：

- **只创建新工作树目录**；
- **不** `cd` 进新目录；
- shell / 终端 panel 的 `cwd` 仍停在主仓（或会话原点）；
- 随后用绝对路径、工具 `cwd` 参数、或下一轮指令在**新树**里改文件。

因此：


| 层                                   | 实际状态                                    |
| ----------------------------------- | --------------------------------------- |
| 终端 `cwd` / 该 panel 的 `PanelContext` | 仍是主仓 · main                             |
| 磁盘与 git                             | 已多出一个 checkout，改动往往落在新树上                |
| 用户看到的窗口                             | 仍像「在 main 干活」，**不知道多了一棵工作树，更不知道活已经挪到那** |


**现有 Pier 能力帮不上主场景：**

- `terminal.cwd.changed` → 重解析 context：只有 **cwd 变了**才更新。AI 不 `cd` 时整条链路不响。
- 官方 `worktree.create` + `openTerminal`：人走宿主向导时没问题；**不限制** AI 自己 `git worktree add`，故不能假设走官方 API。

本设计只做两件事：

1. **检出**：是否出现了「与本会话相关的新建工作树」；以及在不依赖 `cd` 的前提下，如何判断「会话工作目标是否已落到新树」。
2. **展示**：UI 如何说清楚，并给出可选「打开新工作树」，且不打断、不限制 AI。

---

## 2. 目标与非目标

### 2.1 目标

1. **可靠发现新建工作树**
  同仓库（`gitCommonDir`）下，相对本 panel 会话基线，worktree 清单出现新路径——**不依赖 cwd 是否变化**。
2. **判断「会话目标是否已指向新树」**
  主路径 **不是** `cd`。在 AI 不改目录的前提下，用「本会话相关的新建 + 新树上的工作证据」判断目标是否已迁；`cd` 只作增强信号。
3. **UI**
  在**该智能体/终端 panel** 上可见、可行动；默认不自动切整个窗口、不阻断 PTY。

### 2.2 非目标

- 禁止或包装 AI 的 `git worktree` / 任意 git 命令。
- 强制 AI 必须 `cd` 或必须走 Pier 创建向导。
- 无用户动作时自动把窗口项目根改成新树。
- 解析 transcript / prompt 自然语言猜意图（v1）。
- 工作树删除、PR、GC、官方创建流本身。

### 2.3 成功标准（按真实行为）


| #   | 场景                                   | 必须                                        |
| --- | ------------------------------------ | ----------------------------------------- |
| 1   | AI 在主仓 tab `worktree add`，**cwd 不变** | ≤ 数秒内检出新建；该 panel 提示「新建了工作树 {name}」；可一键打开 |
| 2   | 新建后 AI 在新树路径下产生文件/git 变更，cwd 仍在主仓    | 升级为「会话目标已指向新工作树」（或同等文案）；打开动作仍可用           |
| 3   | 仅 add、新树一直干净、cwd 不变                  | 保持「已新建、目标未证实迁入」；**不**误报「已迁入」              |
| 4   | AI 后来又 `cd` 进新树                      | 与「已指向新树」一致或加强；不重复噪声                       |
| 5   | 官方 Create Worktree + openTerminal    | 新 panel 原点即新树 → **无**「AI 偷偷建树」类提示         |
| 6   | 其它 panel 仍停在主仓                       | 其 Git/路径展示仍是主仓，不被带偏                       |


---

## 3. 检测模型

拆成 **两层信号**，禁止用单一 `cwd !== root` 代替。

### 3.1 信号 A — 新建工作树（主信号，不依赖 cwd）


| 项           | 约定                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 数据          | `git worktree list`（现有 `worktrees.list`）                                                                                                 |
| 范围键         | `gitCommonDir`（否则 mainPath）                                                                                                              |
| 基线          | **每个终端 panel** 首次纳入追踪时拍一帧路径集合                                                                                                            |
| `appeared`  | 当前清单 − 基线；去掉 bare/prunable；路径 canonical                                                                                                  |
| 刷新触发（v1 必做） | ① 定时/空闲 reconcile（活跃 agent panel 更勤，如 2–5s 档，有缓存与 in-flight 合并）；② 窗口 focus；③ 现有 git watch 在 worktree 相关签名变化时；④ **任意** cwd 变化时顺带刷（增强，非唯一） |
| 明确不做        | 解析 shell 里是否出现了 `git worktree add` 字符串                                                                                                   |


**「本会话相关的新建」**  
v1 采用保守定义：`appeared` 中在本 panel 存活期间出现的路径，均视为**对该 panel 可见的新建**。  
若多条，UI 主推 **最近进入 `appeared` 的一条**，并标明「另有 N 个」。

> 为何不靠 cwd：主场景 cwd 根本不动；若只在 `cwd.changed` 时 list，会 **永久漏检**。

### 3.2 信号 B — 会话工作目标是否已指向新树（不依赖「必须 cd」）

会话仍有一个 **原点** `originWorktreeRoot`：panel/agent 启动时的 `worktreeRoot ?? gitRoot`，**冻结**。

「目标已指向新树」需要 **新建（A）** + **至少一条目标证据（B）**。

#### B0. 目录进入（增强，非主路径）

- 稳定 cwd 的 toplevel ∈ `appeared` 且 ≠ origin → 记为 **directory_entered**。  
- 有则足以认定目标已指向该树。  
- **无则不影响**用下面证据认定。

#### B1. 新树上的工作证据（主路径，cwd 可仍在原点）

对 `appeared` 中候选路径（优先最近一条）做轻量探测（debounce，失败降级为「仅新建」）：


| 证据        | 含义                                                                                              | 备注            |
| --------- | ----------------------------------------------------------------------------------------------- | ------------- |
| 工作区非干净    | 在该 path 上 `git status`（或复用 git-watch 对应该 root 的脏状态）显示有变更                                        | AI 常直接改新树文件   |
| 新路径上的近期写入 | 该 worktree 目录下 mtime/文件监听在会话开始后有用户级写入（实现选成本低的一种：对 worktree root 做有限深度的变更探测，或挂现有 git watch root） | 与「主仓 dirty」区分 |


v1 门槛（钉死，避免空泛）：

- **目标已指向新树** 当且仅当：  
`candidate ∈ appeared` **且**（ **B0** 或 **B1 工作区非干净** ）。  
- **仅 mtime、尚未能读到 git dirty** 时：P0 可只强化「新建」提示（例如副文案「新位置可能有写入」），**不**升到「目标已指向」；P1 再把可靠写入证据纳入 B1。  
- P0 **最低可交付**：A + B0 + **B1=该 worktree path 的 git dirty**；定时 list 保证 A 在无 cd 时也能响。

#### 不采用（v1）

- 解析 agent transcript / 工具 JSON 里的 path（各 agent 格式不一，且宿主不做统一 transcript 能力）。
- 「appeared 非空 ⇒ 目标一定已迁」——会把「只搭了个空 worktree」误判成已迁入。

### 3.3 关系态（每 panel 一份）

```text
origin     = 启动时 worktreeRoot
appeared   = 本 panel 基线后新出现的 worktree 路径
candidate  = 主推的 appeared 项（默认最近一条；若 B0 命中则用 cwd 那棵）
cwdRoot    = 稳定 cwd 的 toplevel（可为空/仍等于 origin）

work_evidence =
  (cwdRoot == candidate && candidate != origin)     // B0
  || git_dirty(candidate)                           // B1 P0

relation:
  idle                 appeared 为空
  created              appeared 非空 且 !work_evidence
  target_on_created    appeared 非空 且 work_evidence
```

可选细分（实现可用内部 flag，UI 可合并文案）：

- `target_on_created` + B0 → 目录已进入；
- `target_on_created` + 仅 B1 → **目录未变，目标已在新树写活**（主场景升级态）。

曾规划的 `visiting_other`（cwd 去已有树）：**降为 P1**。P0 只服务「新建 + 是否已指向新建」。

路径比较：与现网 worktree 命令相同的 canonical 规则。

### 3.4 和 PanelContext 的关系

- **不**把 relation 塞进 `PanelContext`。
- cwd 仍在原点时，该 panel 的 Git 状态栏继续正确显示 **原点** 分支——这是事实。
- 关系提示是 **额外一层**：「仓库/会话维度多了一棵树 / 活可能在那」，不是改写原点 Git 状态。
- 用户点「打开新工作树」后，**新 panel** 的 context 才是新树；原 agent tab 的 cwd 仍可由 AI 自己决定是否 `cd`。

---

## 4. 架构

```text
git worktree list（定时 / focus / git-watch / cwd）
        │
        ▼
SessionWorktreeTracker（每 panel）
  origin, baseline, appeared, candidate
  work_evidence ← git status/dirty on candidate（+ 可选 B0 cwd）
  relation: idle | created | target_on_created
        │
        ▼
本窗投影 → 该终端 tab 副标 + 状态条 + 可选 worktrees.open
```


| 组件      | 职责                                               |
| ------- | ------------------------------------------------ |
| 清单缓存    | 按 `gitCommonDir`，TTL + in-flight 合并              |
| Tracker | 注册/销毁 panel；算 appeared 与 relation；**无 cd 也要跑 A** |
| 证据探测    | 对 candidate 拉脏状态；与 git-watch 复用优先于重复造轮子          |
| UI      | 只读投影；打开走现有 `worktrees.open`                      |


---

## 5. UI

### 5.1 原则

- 提示挂在 **创建发生时所在的智能体/终端 panel**（当事人），不是整窗报警。
- **不限制 AI、不阻断、不强制 cd、默认不自动 open。**
- 文案产品词：工作树、主仓、会话；禁止 cwd/bind/漂移等实现词进前台。
- 打开工作区是为了 **人** 看文件与对齐布局；不搬迁 agent 进程。

### 5.2 两种主状态（P0 只做这两个 + idle）

#### `created` — 已新建，目标未证实迁入（**最常见首态**）

- **Tab**：轻量标记（如工作树图标 / 「+树」），勿用 error 色。
- **状态条（该终端）**  
  - 文案：`智能体新建了工作树 {name}`  
  - 说明（次行或 tooltip）：`当前目录仍在 {originName}；若改动在新树，请打开后查看`  
  - 动作：  
    - **打开工作树** → `worktrees.open({ path: candidate })`  
    - **稍后** → dismiss 本条（tab 标记可保留至 panel 关闭或 appeared 清空）

#### `target_on_created` — 目标已指向新树（cwd 可仍在主仓）

- **Tab**：副标显示 `{name}`（basename），信息/中性强调。
- **状态条**  
  - 若仅有 B1（未 cd）：`会话改动在工作树 {name}（当前目录仍在 {originName}）`  
  - 若有 B0（已 cd）：`会话在工作树 {name}`  
  - 动作：**打开工作树** / **保持此标签**（dismiss 条）

#### `idle`

- 无关系条、无迁移类副标。

### 5.3 明确不做


| 不做                  | 原因                     |
| ------------------- | ---------------------- |
| 默认 toast 刷「新建了工作树」  | tab + 本终端条足够；避免和终端输出重复 |
| 改其它仍停在主仓的 tab 的分支显示 | 那些 tab 仍在主仓            |
| 自动切窗口根 / 强制 confirm | 与多 tab、不限制 AI 冲突       |
| 把「未 cd」显示成错误        | 合法工作方式                 |


### 5.4 「打开工作树」

1. `worktrees.open` → 同窗打开/聚焦以该 path 为 context 的 panel（与现网一致）。
2. 不移动原 agent PTY。
3. 失败：`showAppAlert` / 插件 alert，带错误正文。

### 5.5 Dismiss

- 键：`panelId + relation + candidatePath`。  
- 仅 panel 生命周期内有效。  
- candidate 换成另一新建路径 → 可再提示。

---

## 6. 边界


| 点                  | 处理                                                                 |
| ------------------ | ------------------------------------------------------------------ |
| 无 cd 必须能检出 A       | 活跃 session **主动 reconcile list**，禁止只挂在 cwd 事件上                     |
| 空 worktree 误报「已迁入」 | 无 B0/B1 只停留 `created`                                              |
| 主仓也 dirty          | B1 看的是 **candidate path** 上的 status，不是原点                           |
| 官方创建的新 tab         | origin = 新树，appeared 相对该 origin 基线为空或含自身但 current==origin → `idle` |
| 多 appeared         | 主推最近一条；打开动作针对 candidate                                            |
| 性能                 | list 缓存；dirty 探测仅对 candidate debounce；禁止狂扫全盘                       |
| 与创建向导              | 向导减少人肉摩擦；本文覆盖 **AI 自建且不改目录**                                       |


---

## 7. 测试

### 7.1 单元

- appeared diff；relation：`idle` / `created` / `target_on_created`；
- 仅 appeared、dirty=false、cwd=origin → `created`；
- appeared + candidate dirty、cwd=origin → `target_on_created`；
- appeared + cwd=candidate → `target_on_created`；
- 官方 origin=新路径 → `idle`。

### 7.2 集成

- **不发 cwd 事件**，只推进 list 快照 → 进入 `created`；
- 再注入 candidate dirty → `target_on_created`；
- panel 销毁清理。

### 7.3 手工

- 主仓 agent：`git worktree add ...` 且不 cd → 条出现 → 打开后文件树在新树；
- 在新树改文件（另一工具或 agent 绝对路径）→ 升为「改动在工作树」；
- 官方创建开工 → 无噪声。

---

## 8. 分期


| 阶段     | 内容                                                                                                                               |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **P0** | Tracker + 无 cd 的 list reconcile；态 `idle/created/target_on_created`；B1=candidate git dirty；B0=cwd 增强；当事人 tab + 状态条 + open/dismiss |
| **P1** | 写入证据增强、visiting 已有树、list 与 git-watch 更紧耦合、多 appeared 详情                                                                          |
| **P2** | 可选：tab 不可见时与 Attention 轻量联动（仍不并入 FA 状态机）                                                                                         |


---

## 9. 一句话

**AI 建工作树时往往不改当前目录；宿主必须在 cwd 不变时仍能发现新树，再用「新树是否已有工作证据」判断会话目标是否已指向那里，并在该会话面板上提示、可选打开——而不是假装 cwd 会跟着迁。**

---

## 附录 · 判定伪代码

```text
onReconcile(panel):
  paths = listWorktrees(panel.gitCommonDir)
  appeared = paths - panel.baseline
  candidate = pickCandidate(appeared, panel.cwdRoot)  // cwd 命中优先，否则最近新增

  if appeared empty:
    relation = idle
    return

  entered = stableCwdRoot(panel) == candidate and candidate != panel.origin
  dirty = isGitDirty(candidate)   // P0

  if entered or dirty:
    relation = target_on_created
  else:
    relation = created
```

