# 命令面板 MRU 排序设计

> 日期: 2026-06-23
> 状态: 待批准

## 概述

给命令面板加上"最近使用优先级"排序。分组顺序和组内顺序都按 frecency（频次 × 近期度）排，最常用的命令出现在最上面、所在分组也提到最前。完全没用过的分组和命令回退到现有的 `CATEGORY_META.order` 与 `metadata.sortOrder`，保证新用户首次打开看到的就是当前设计意图的顺序。

目的不是当下命中率，而是为后续命令池扩张（Git / AI / Terminal 等新 surface 接入）做承重，避免"分类多、每类条目多"之后用户每次都得手动滚屏找。

## 方案选型

评估了三种方案，最终采用方案 C：

| 方案 | 核心思路 | 放弃原因 |
| --- | --- | --- |
| A. 顶部 Recently 分组 | 现有分类不动，最上加 Recently 分组（VS Code 模式） | 同一命令出现两次，视觉冗余；垂直高度多占 1/3 |
| B. 仅组内 MRU | 分组顺序不变，组内按 MRU 排（Sublime 模式） | 默认高亮项命中率有限（用户得先按方向键到对应分组） |
| **C. 分组 + 组内双层 MRU（采用）** | 分组之间、组内都按 frecency 排，未用过的回退原 sortOrder | — |

方案 C 的代价是分类位置漂移，缓解手段是分组 heading 一直可见，用户靠 heading 文字识别而不是位置。完全未用过的项回退原 sortOrder，新用户首次体验等同当前设计。

## 数据契约

### shared/contracts/command-palette-mru.ts

```ts
import { z } from "zod";

export const mruEntrySchema = z.object({
  actionId: z.string().min(1),
  useCount: z.number().int().nonnegative(),
  lastUsedAt: z.number().int(), // epoch ms
});

export const mruStateSchema = z.object({
  version: z.literal(1),
  entries: z.array(mruEntrySchema).max(200),
});

export type MruEntry = z.infer<typeof mruEntrySchema>;
export type MruState = z.infer<typeof mruStateSchema>;
```

`version` 字段为后续 schema 升级预留。`entries.max(200)` 是兜底上限，触顶时按 frecency 升序逐出最弱的 entry。

### IPC 契约

```ts
interface CommandPaletteMruAPI {
  read(): Promise<MruState>;
  recordUse(actionId: string): void;
  clear(): Promise<void>;
  /** 订阅 `pier:command-palette-mru:changed` 广播, 返回解绑函数 */
  onChange(handler: (state: MruState) => void): () => void;
}
```

挂在 `window.pier.commandPaletteMru` 命名空间。`recordUse` 用 send（fire-and-forget），`read` 和 `clear` 用 invoke。`onChange` 由 preload 包装：`ipcRenderer.on("pier:command-palette-mru:changed", listener)` + 返回 `ipcRenderer.off` 的解绑闭包。main 在每次 record / clear 落盘后通过 `BrowserWindow.getAllWindows().forEach(w => w.webContents.send(...))` 广播给所有窗口。

### 通道设计

| 通道 | 传输 | 频率 |
| --- | --- | --- |
| `pier:command-palette-mru:read` | invoke/handle | 启动一次/窗口 |
| `pier:command-palette-mru:record` | send/on | 中（每次 action 执行）|
| `pier:command-palette-mru:clear` | invoke/handle | 极低 |
| `pier:command-palette-mru:changed` | webContents.send → renderer | 中（每次写入后广播）|

## 持久化分层

独立文件 `userData/command-palette-mru.json`，**不**复用 preferences.json。理由：写入频率高（每次 action 执行）、schema 独立演化、损坏不牵连主偏好。

复用 [main/state/preferences.ts](../../../src/main/state/preferences.ts) 的写入 pattern：`proper-lockfile` 锁 + `write-file-atomic`。

```
src/
  shared/contracts/command-palette-mru.ts   schema + 类型
  main/
    state/command-palette-mru.ts            读 / 写 / record / clear
    ipc/command-palette-mru.ts              IPC handlers + 多窗口广播
  preload/index.ts                          挂 window.pier.commandPaletteMru
  renderer/
    stores/command-palette-mru.store.ts     zustand store, 订阅 onChange
```

main 进程持有当前 state 的内存副本，`recordUse` 同步更新内存并异步落盘 + 广播。renderer 启动时拉一次 read，之后只依赖 onChange 推送。

## 算法

### frecency 公式

```ts
const HALF_LIFE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

function frecency(entry: MruEntry, now: number): number {
  const ageDays = (now - entry.lastUsedAt) / MS_PER_DAY;
  const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  return entry.useCount * decay;
}
```

半衰期 14 天：两周不用，权重折半。参数硬编码，先观察体感再决定是否暴露成可调。

### 排序规则

```ts
function actionRank(action: Action, frecencyMap: ReadonlyMap<string, number>):
  | { tier: "frecency"; score: number }
  | { tier: "fallback"; sortOrder: number } {
  const score = frecencyMap.get(action.id);
  return score != null
    ? { tier: "frecency", score }
    : { tier: "fallback", sortOrder: action.metadata?.sortOrder ?? 0 };
}

function groupRank(actions: readonly Action[], frecencyMap: ReadonlyMap<string, number>):
  | { tier: "frecency"; maxScore: number }
  | { tier: "fallback"; order: number } {
  let maxScore = -Infinity;
  for (const a of actions) {
    const s = frecencyMap.get(a.id);
    if (s != null && s > maxScore) maxScore = s;
  }
  if (maxScore > -Infinity) return { tier: "frecency", maxScore };
  const category = actions[0]?.category ?? "";
  return { tier: "fallback", order: CATEGORY_META[category]?.order ?? UNKNOWN_ORDER };
}
```

排序时 frecency tier 一律排在 fallback tier 前面；同 tier 内按 score 降序 / order 升序。

### 与 cmdk 搜索的关系

**有搜索时不叠 frecency，把排序完全交给 cmdk 的 fuzzy score。**理由：cmdk score 已经按 query 匹配度从高到低排，叠 frecency 会让"我刚搜了一个新词、它却被推到第二位"，体感诡异。VS Code 同样处理。

实现上 `groupActions` 在 query 非空时不重排，只在 query 为空时按上述 rank 排序。判断 query 是否为空：本地 `query` state 不为空字符串。

## UI 改造

### 修改 [groupActions](../../../src/renderer/components/common/command-palette.tsx)

```ts
function groupActions(
  actions: readonly Action[],
  frecencyMap: ReadonlyMap<string, number>,
  query: string,
): ActionGroup[] {
  const groups = collectByCategory(actions);
  if (query.length > 0) {
    // 让 cmdk 接管, 维持当前 CATEGORY_META.order 顺序即可
    return groups.sort(byCategoryMetaOrder);
  }
  // 组内按 actionRank 排
  for (const g of groups) g.actions.sort(byActionRank(frecencyMap));
  // 组间按 groupRank 排
  return groups.sort(byGroupRank(frecencyMap));
}
```

### 新增 store

`stores/command-palette-mru.store.ts`：

```ts
interface CommandPaletteMruStore {
  frecencyMap: ReadonlyMap<string, number>;
  /** 触发一次本地更新 + IPC fire-and-forget */
  recordUse(actionId: string): void;
  /** 清空 */
  clear(): Promise<void>;
}
```

启动时 bootstrap 调一次 `window.pier.commandPaletteMru.read()`，订阅 `onChange` 持续同步。`frecencyMap` 在 store 内**仅在 entries 引用变化时**重算（`useCount × decay`），renderer 端不写 useCount/lastUsedAt 原值；不在每次 render 时按"现在时间"实时重算，避免无谓的渲染抖动——decay 是相对值，命令面板打开瞬间算一次就够。

### 触发记录的时机

仅在 [handleExecuteAction](../../../src/renderer/components/common/command-palette.tsx) handler **成功完成**后调 `recordUse`：

```ts
const handleExecuteAction = async (action: Action) => {
  if (action.enabled?.() === false) return;
  const before = useCommandPaletteController.getState().requestId;
  try {
    await action.handler();
    if (!action.metadata?.excludeFromMru) {
      useCommandPaletteMru.getState().recordUse(action.id);
    }
    // ... 现有关闭逻辑
  } catch (err) {
    // 不记录失败的 action
    console.error(...);
  }
};
```

- handler throw → 不记
- `enabled?.() === false` → 不记（不进入 handler 调用）
- `metadata.excludeFromMru === true` → 不记（专供 clear action 自身豁免，详见下文）
- quick-pick 内层 `onAccept` → 不记（只记顶层进入命令面板的 action，内层选项有自己的 domain 语义）

### Action 类型扩展

`ActionMetadata` 新增可选字段：

```ts
interface ActionMetadata {
  // 既有字段
  iconComponent?: LucideIcon;
  keywords?: readonly string[];
  sortOrder?: number;
  // 新增
  /** true = 执行后不计入命令面板 MRU。仅给 clearRecent 这类元命令用 */
  excludeFromMru?: boolean;
}
```

### 新增 clear action

注册一个 `pier.commandPalette.clearRecent` 命令，category 归 `Settings`，i18n：

- `zh-CN`: "清空命令面板使用记录"
- `en`: "Clear command palette history"

handler 调 `window.pier.commandPaletteMru.clear()` 并 toast 提示。surface 设 `["command-palette"]`，让它本身也出现在命令面板里。`metadata.excludeFromMru = true` 让它清空后不会把自己写回 MRU（否则下一次打开命令面板就会看到 clearRecent 排在顶端，违反"清空"语义）。

## 错误处理

| 场景 | 行为 |
| --- | --- |
| `userData/command-palette-mru.json` 不存在 | read 返回 `{ version: 1, entries: [] }` |
| JSON 损坏 / schema 校验失败 | 起空状态，记 warning 日志，**不**自动备份（用户主动清空即可重置）|
| IPC 调用失败（main 进程异常）| `recordUse` 仍然先本地更新 store entries（保证本会话内排序有反馈），再 fire IPC；若 IPC 静默失败，落盘缺失这一次的记录，下次窗口启动 read 时会和真实落盘对齐——会丢一次 record 但不会卡 UI |
| 并发写入（多窗口同时 recordUse）| main 进程单实例持有内存副本 + lockfile，串行化合并 |
| entries 触顶 200 | 写入前按 frecency 升序排，逐出尾部最弱的 entry，再插入新 entry |

## 测试

### 单元测试

- `frecency()`: 0 天 → useCount；14 天 → useCount/2；28 天 → useCount/4
- `actionRank()`: frecency tier 在 fallback tier 前；同 tier 按 score / sortOrder 排
- `groupRank()`: 组取 max(score)；空组（无 frecency）落 fallback
- `groupActions()`:
  - query 空 → 双层 MRU 排
  - query 非空 → 维持 CATEGORY_META.order, 不重排组内
  - 全是新用户（empty frecencyMap）→ 等同当前实现

### 集成测试（Vitest + IPC mock）

- recordUse → read 应包含新 entry，useCount = 1
- 重复 recordUse 同一 id → useCount 递增，lastUsedAt 更新
- entries 已满 200 → 触发逐出最弱 entry
- onChange 广播 → 多个 renderer 实例都收到

### E2E（Playwright）

- 打开命令面板 → 执行 "Switch Theme" → 关闭 → 重开 → "Switch Theme" 在最上面
- clear → 重开 → 顺序回归到当前 CATEGORY_META.order

## 不做

- **搜索时的 frecency 加权**：交给 cmdk fuzzy score。
- **frecency 参数 UI 化**：半衰期 14 天和 cap 200 都是死值，后续观察体感再决定。
- **跨设备同步**：命令面板 MRU 状态仅本地，与 preferences.json 的处理一致。
- **批量配置 excludeFromMru**：目前只有 clearRecent 一个 action 需要豁免，不做配置系统、不做 UI；后续若再有第二个 case 也只是手填 metadata。
- **quick-pick 内层选项的独立 MRU**：内层是 domain 概念（主题、字体等），不属于命令面板自身排序，由各自 quick-pick provider 决定要不要记。

## 风险

| 风险 | 缓解 |
| --- | --- |
| 老用户启用后顺序大变，造成困惑 | clear 入口在命令面板里就能执行，发布说明里提一句 |
| frecency 公式参数不合适，体感诡异 | 半衰期写在常量，后续灰度调；现阶段先观察 |
| store 重算 frecencyMap 频繁，渲染抖动 | 仅在 entries 引用变更时重算（store 持有 entries 引用做浅比较）|
| 多窗口同时写 | main 单实例 + lockfile + onChange 广播兜底一致性 |
