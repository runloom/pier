# 面板 Tab 活跃任务圆点

**日期：** 2026-07-27  
**状态：** 已实现  
**拍板：**

1. 信号语义：该面板运行控制条作用域内是否仍有活跃任务（presence），不是单个选中 run 的结果态
2. 数据路径：`PanelTabHeader` 直接订阅 `TaskRunsStore`（方案 A），不扩展 `PanelTabChrome`
3. 视觉：tab 最左侧绝对定位小圆点、垂直居中；不占 flex 流；与现有行内 status 图标并存

## 1. 背景

任务运行控制条（RC）可以挂在宿主 panel 上，且同一 panel 可能同时关联多个任务：

- 占用该 panel 的前台任务（`node.panelId === panelId`）
- 从该 panel 发起的后台任务（`originPanelId === panelId`，输出可能在别处）

用户需要在对应宿主 panel 的 dockview tab 上看到「这里还有任务在跑」的轻量提示。圆点绝对定位在 tab 最左侧并垂直居中，不占 flex 空间，避免贴在标题右上角与关闭按钮抢视觉。

### 1.1 现有相关能力

| 能力 | 位置 | 与本需求关系 |
|------|------|----------------|
| 自定义 tab 头 | `PanelTabHeader`（`defaultTabComponent`） | 唯一渲染落点；根节点已有 `relative` |
| RC 作用域查询 | `taskRunsForPanel` | 与控制条同一集合，本需求复用 |
| 占用 panel 查询 | `taskRunsOwnedByPanel` | 仅 owned，不含 origin 后台；**不够** |
| 活跃状态 | `isActiveTaskRunNodeStatus` | `pending \| running \| stopping` |
| 行内 status 图标 | `tab?.state?.status` → `tabStatusIndicator` | 单 run 结果态（转圈/勾/叉）；**保留，不改语义** |
| 文件未保存点 | `params.dirty` 行内 `size-1.5` | 另一通道；不复用 DOM |

当前 task tab chrome（`taskRunTabChromeOverlay`）反映的是 **owned / 选中 run** 的结果态，不能表达「RC 里是否还有任一活跃任务」。因此 presence 圆点不能塞进现有 status 图标通道。

## 2. 目标与非目标

### 2.1 目标

- 当 `taskRunsForPanel(snapshot, panelId)` 中存在任一活跃 run 时，该 panel 的 tab 显示小圆点
- 圆点绝对定位在 tab 最左侧并垂直居中，不增加 flex 宽度，不改变关闭按钮命中区域
- 多任务时不显示数字：有一个或多个活跃任务都是同一个点
- 与文件 dirty 点、行内 status 图标独立共存

### 2.2 非目标

- 不扩展 `PanelTabChrome` / `PanelDescriptor` 契约
- 不表示成功 / 失败 / 取消等终态（仍由现有 status 图标负责）
- 不做多任务数量角标、呼吸动效、颜色分前台/后台
- 不替换 running 时的行内 `Loader2`（本版明确并存）
- 不改变 RC 展示、选中 run、停止/重跑逻辑

## 3. 判定规则

### 3.1 纯函数

新增：

```ts
panelHasActiveTaskRun(snapshot: TaskRunsSnapshot, panelId: string): boolean
```

实现约定：

```ts
taskRunsForPanel(snapshot, panelId).some((run) =>
  isActiveTaskRunNodeStatus(run.status)
)
```

- 作用域：与 RC 相同（`originPanelId` 或任一 `node.panelId`）
- 活跃：shared 的 `isActiveTaskRunNodeStatus`（`pending` / `running` / `stopping`）
- **不**读取 `selectedTaskRunId`
- **不**使用 `taskRunsOwnedByPanel` 作为唯一来源

建议放置：`src/renderer/stores/task-runs.store.ts`（与 `taskRunsForPanel` 同文件，便于单测与 header 共用）。实现用与 `taskRunsForPanel` 相同作用域谓词的 O(n) 短路扫描，不分配/排序列表。

### 3.2 真值表

| 场景 | 圆点 |
|------|------|
| 前台任务在本 tab 跑（pending/running/stopping） | 亮 |
| 从本 panel 后台拉起、输出在别处，run 仍活跃 | 亮 |
| RC 多任务，至少一个活跃 | 亮 |
| 选中 run 已终态，另一 run 仍活跃 | 亮 |
| 全部为 succeeded / failed / cancelled / blocked | 灭 |
| 无关联任务 / 非任务 panel | 灭 |
| run 被 dismiss 出 RC UI，但 snapshot 仍为活跃 | 亮（以 TaskRuns 为准，不跟 dismiss store） |

说明：dismiss 只影响控制条是否继续展示终态卡片；活跃 run 的 presence 以 `TaskRunsSnapshot` 为唯一真源，避免 tab 与进程真实状态脱节。

## 4. 渲染

### 4.1 订阅

在 `PanelTabHeader`：

```ts
const showActiveTaskDot = useTaskRunsStore((state) =>
  panelHasActiveTaskRun(state.snapshot, props.api.id)
);
```

selector 必须返回 **boolean**，避免因 runs 对象引用变化导致无关 tab 重渲。若后续实测仍过脏，可再收紧为按 `panelId` 预计算的派生 map；首版 boolean selector 足够。

### 4.2 DOM / 样式

- tab 根节点保持 `relative`（已有）
- 圆点作为根下绝对定位子节点，视觉在**最左侧**、垂直居中；不进入 flex 流：

```tsx
<div
  className="dv-default-tab relative"
  data-pier-tab-has-active-task={showActiveTaskDot ? "true" : undefined}
>
  {showActiveTaskDot ? (
    <span
      aria-label={t("workspace.tab.activeTask")}
      className="pointer-events-none absolute top-1/2 left-1.5 z-10 size-1.5 -translate-y-1/2 rounded-full bg-status-info-fg"
      data-pier-tab-active-task="true"
      role="status"
    />
  ) : null}
  {leadingVisual}
  <span className="dv-default-tab-content">{displayTitle}</span>
</div>
```

根节点带 `data-pier-tab-has-active-task` 时，CSS 将 `padding-left` 提到 `18px`（6px 圆点槽 + 6px 间距，叠在默认左内边距语义上），避免与 `⌘` 序号 / 图标 / 标题重叠。

约定：

| 项 | 选择 |
|----|------|
| 尺寸 | `size-1.5`（6px），与 dirty 点同级 |
| 颜色 | info 语义实心 token（`bg-status-info-fg`；禁止硬编码色） |
| 定位 | tab 最左侧（`left-1.5`）+ `top-1/2 -translate-y-1/2` 垂直居中 |
| 布局 | `absolute` 不进 flex；亮点时根节点加左 gutter（`padding-left: 18px`）让内容右移 |
| 交互 | `pointer-events-none`，不抢点击 |
| 动效 | 无 |
| 测试钩子 | `data-pier-tab-active-task="true"`；根 `data-pier-tab-has-active-task` |

### 4.3 与其它 tab 装饰的关系

| 装饰 | 关系 |
|------|------|
| 行内 `tabStatusIndicator` | 保留；running 时允许「转圈 + 圆点」同时存在 |
| 文件 dirty 行内点 | 独立通道；行内在标题后；task 圆点不复用其 DOM |
| 关闭按钮 | 不进入其 box，不改变可见性与命中 |
| preview 斜体 | 无关 |

### 4.4 文案

- key：`workspace.tab.activeTask`
- zh-CN：`有任务正在运行`
- en：`Task running`
- 用于 `aria-label`（及可选 `title`）；不进消息中心

## 5. 测试

### 5.1 单元

覆盖 `panelHasActiveTaskRun`：

1. owned 前台 running → true  
2. 仅 `originPanelId` 后台 running → true  
3. 多 run：一个 failed + 一个 running → true  
4. 全终态 → false  
5. 空 snapshot / 无关 panelId → false  
6. `stopping` / `pending` → true  

### 5.2 组件

`PanelTabHeader`（既有 component 测试风格）：

1. mock `useTaskRunsStore` / snapshot 含本 panel 活跃 run → 存在 `[data-pier-tab-active-task="true"]`  
2. 无活跃 run → 不存在该节点  
3. 圆点为 tab 根下 `absolute` 节点（`left-*` + 垂直居中），带 info 语义 class  

不强制 e2e；若后续 tab 布局回归再补。

## 6. 反模式

- 用 `tab.state.status === "running"` 驱动圆点（选中/owned 单 run，漏后台与多任务）
- 把 presence 写进 `updateParameters` / dirty 通道
- 圆点绝对定位到标题右上（与关闭区抢视觉；已否决）
- 圆点作为 flex 行内子项挤开标题（本版用最左 absolute）
- 订阅整份 `runs` 列表并在 header 里做重逻辑而不返回 boolean
- 跟 `useTaskRunControlDismissStore` 绑定亮灭
- 硬编码 hex / 固定色阶

## 7. 实现落点（清单）

1. `src/renderer/stores/task-runs.store.ts` — `panelHasActiveTaskRun`  
2. `src/renderer/components/workspace/panel-tab-header.tsx` — 订阅 + 圆点  
3. `src/renderer/i18n/locales/zh-CN/workspace.ts` / `en/workspace.ts` — `tab.activeTask`  
4. `tests/unit/...` — helper 真值表  
5. `tests/component/panel-tab-header.test.tsx` — DOM 有无  

## 8. 验收

- [x] 前台 task running → 对应 tab 亮点（unit：owned running）  
- [x] 从 shell tab 后台拉起 → 该 shell tab 亮点（unit：origin-only background）  
- [x] RC 多任务仅部分活跃 → 仍亮（unit：failed + running）  
- [x] 全部结束后灭（unit：全终态；component：无活跃不渲染）  
- [x] 圆点在 tab 最左、垂直居中（absolute）；关闭按钮可点区域不变（component DOM）  
- [ ] 标题 ellipsis 时圆点仍贴 tab 左缘，不与关闭叉重叠（手动）  
- [ ] 与 dirty / status 图标同时存在时布局正常（手动）  
- [x] 相关 unit + component 测试通过  
- [x] drag/ghost 态保留 active-task 左 gutter（`padding-left: 20px !important`）  
