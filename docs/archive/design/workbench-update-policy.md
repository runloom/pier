# 工作台更新策略（Update Policy）

跨物料数据刷新的单一说明。实现以宿主调度 + 物料自管为准；本文是契约矩阵，不是 UI 规范。

## 分层

| 层 | 职责 |
| --- | --- |
| 宿主 `WorkbenchPanel` | 传递 `visible` / `refreshToken`；右键「全部刷新」走 `refreshAllWorkbenchWidgets` |
| 物料声明 | `refreshable` 与/或注册 `actions` 中 `id: "refresh"` |
| 数据域 | 自管轮询间隔、缓存、推送（账号 lease、资源 refcount、usage-data 广播等） |

## 手动刷新优先级

对每个实例：

1. **action 模式**：`registration.actions` 含 `id === "refresh"` → 调用 `invoke({ bulkRefresh })`
2. **token 模式**：`refreshable === true` 且状态为 core / plugin-active → bump `refreshToken`
3. **none**：跳过（unknown、无刷新入口）

「全部刷新」对 action 模式设 `bulkRefresh: true`：物料跳过各自成功 toast，失败 rethrow，由宿主汇总。

## 物料矩阵

| 物料 | 自动更新 | 手动（卡头） | 全部刷新 | 可见性 |
| --- | --- | --- | --- | --- |
| Codex / Grok / Claude 账号配额 | main lease + 15min 轮询；min-refetch 5min | action → `refreshAccountUsage`（force） | 同 action，bulk | lease 仅 visible |
| 成本概览 | usage-data 源推送 / 聚合 | action → `usageData.refreshAll` | 同 action，bulk | 数据源侧 |
| 工作台资源 | 2s refcount 轮询 | host:refresh → token | token | `visible=false` 停表 |
| 活动总览 | foreground-activity 广播 | 无 | 跳过 | 事件驱动 |
| 自定义卡片 | metric 侧 | 视 metric | 通常跳过 | `visible` 下传 |

## 反馈

| 场景 | 反馈 |
| --- | --- |
| 全部刷新全部成功 | `toast.success(workbench.refreshAllSuccess)` |
| 至少一个 action 失败 | `showAppAlert` 列出标题 + 错误（禁止 toast description） |
| 无可刷新实例 | 静默 |
| 单卡刷新成功 | 物料自己的 success toast / 无 toast（token 模式靠 UI 更新） |

## 相关代码

- 调度：`src/renderer/panel-kits/workbench/workbench-widget-refresh.ts`
- 账号手动刷新：`@pier/plugin-api/account-usage`（`refreshAccountUsage` / `createAccountsWidgetRefreshAction`）
- 轮询租约：`createUsagePollingRegistry` + `useUsagePollingLease`
