# DiffView + Review 数据管线终态（渲染 × 内存）

## 状态

**P0 渲染生命周期已落地。P1「成员 cap 裁 id」作废。**  

**显示 id / 正文上限 / 点树可滚：** 以  
`docs/superpowers/specs/2026-07-27-git-review-stable-ledger-design.md` **为准**。  
`GIT_REVIEW_MAX_CODEVIEW_MEMBERS` 不得再解释为 CodeView entry 上限 → 改为  
`GIT_REVIEW_MAX_FULL_BODY_ENTRIES`（满正文个数，超额退 estimate）。  

**导航 demand 调度 / 滚动单写者：** 以  
`docs/superpowers/specs/2026-07-27-diffshub-full-alignment-design.md` **为准**（显示集部分已再 supersede 至 stable-ledger）。  
「nav pending 时 demand 仅为选中项」作显示集合——**作废**。  
正确：demand 只调度读；账本 id = 全 sectionKey。

> **§B 及下文「成员 cap / 投影只发 members / 验收成员数≤cap」：历史，禁止实现。**  
> 现行：`stable-ledger` 全槽 id + `MAX_FULL_BODY_ENTRIES` 只限满正文。

## A. CodeView 生命周期（P0）

| 事件 | 行为 |
|---|---|
| 打开 Review | 挂一次 uncontrolled CodeView，`initialItems` 首批 |
| 后续 materialize | **`addItems`**（前缀 id 不变） |
| 同 id 正文 / 折叠 | **`updateItem` + version** |
| 重排 / 删 / stage 换 sectionKey | **`instance.setItems` → reconcile** |
| 换字号 / split·unified / worker↔inline | 才换 `codeViewKey` remount |

**禁止**：item id 集合进入 remount key。

实现：`diff-view-item-sync.ts`、`use-diff-view-item-apply.ts`、`pierDiffCodeViewKey`。

## B. 数据 / 内存（P1，性能硬约束）

### 分层

```
Index / 树（全量，轻） → demand 有界 → materialize 缓存（字节/行 LRU）
                              ↓
                    CodeView 成员 cap（entry 数）
                              ↓
                    虚拟滚动只画可见行
```

### 常量（单一来源：`git-review-document-demand.ts` + `git-review-document-limits.ts`）

| 常量 | 默认 | 作用 |
|---|---|---|
| `GIT_REVIEW_SEED_BATCH_MIN/MAX` | 25–96 | 首屏 seed |
| `GIT_REVIEW_LOOKAHEAD` | 4 | 视口两侧各预取条数 |
| `GIT_REVIEW_SELECTION_RADIUS` | 2 | 选中邻域预取 |
| `GIT_REVIEW_MAX_FULL_BODY_ENTRIES`（旧名 MAX_CODEVIEW_MEMBERS 删除） | 128 | **满正文**个数上限；超额退 estimate，**不删 id** |
| `GIT_REVIEW_MAX_RETAINED_BYTES` | 32 MiB | 正文缓存字节 |
| `GIT_REVIEW_MAX_RETAINED_LINES` | 200_000 | 正文缓存行 |
| `DEFAULT_MAX_CONCURRENT_DOCUMENTS` | 2 | 并发读 |

### Demand 组合

1. **无 window**：seed 首批  
2. **有 window**：seed **退出** demand（防前 N 永久钉死）  
3. window ∪ **双向** lookahead ∪ **选中邻域**  
4. **nav pending（调度）**：`boostPriority(selected)` 且**保留** window∪lookahead——**禁止** replace 为「仅 selected」。  

### CodeView 身份集 / 正文（现行）

以 **`2026-07-27-git-review-stable-ledger-design.md`** 为准：

- 身份集 = 全 `renderSlots`（estimate|loaded|error|ready-notice）  
- **禁止** cap 裁 id；`MAX_FULL_BODY_ENTRIES` 只限满正文  
- 正文缓存 retention LRU 按字节/行；超额同 id → estimate  

### 并发

Loader `#maxConcurrent`（默认 2）；waiting 顺序：selected → visible → buffered。

## 验收

1. 同会话 stage 不因 id 列表 remount CodeView  
2. window 出现后 demand 不再含 seed 前缀  
3. 远滚后 **loaded 正文个数** ≤ `MAX_FULL_BODY_ENTRIES`（id 仍全量）  
4. 导航 pending 时 demand **保留 window** 且 boost selected（**不是**「demand 仅为选中项」）  
5. 长时间滚动不无界增长 retained 字节（LRU）  
6. 导航/滚动单写者：见 full-alignment 文档 DoD §7.1

## 仍可选（非阻塞）

- `updateItemId` stage 槽位 1:1 rename  
- scroll 方向加权 lookahead（现为双向对称）  
