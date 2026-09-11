# 消息中心（统一系统消息）— 金标准

日期：2026-09-09
状态：已确认。本文是统一系统消息的唯一权威细则；AGENTS.md「消息中心（统一系统消息）」只保留不变量与指针。正文 2026-09-09 自 AGENTS.md 迁入，规则文字不变。

统一消息中心是全部系统/后台消息的收件箱：main 侧 `src/main/services/notification-center/`（NCS）是唯一写入方，契约在 `src/shared/contracts/notification-center.ts`，广播通道 `pier://notification-center:changed`；renderer 镜像 store 是 `stores/notification-center.store.ts`。

硬规则：

1. **toast 双形态**：确认型（用户动作即时反馈，不进消息中心）维持 **触发窗** sonner 反色胶囊（默认 Toaster `position="top-center"`）；消息型（系统/后台事件，进消息中心）仅经 main 单投 → `NotificationMessageToastBridge` → `lib/notifications/show-notification-toast.tsx` 标准 shadcn sonner 卡片（同 Toaster，per-call `position: "top-right"`）——**标题 + 详情（必备，必须由调用方提供友好内容：下一步/上下文/摘要；类型行回退仅为防御兜底，不得作为常态）+ ≤1 outline 操作 + 关闭 X（右上），无前置状态图标**。消息中心卡片唯一实现是 `components/common/notification-card.tsx` 的 `NotificationCard`（无前置图标；标题/详情/时间 + 未读红点 + 操作），**仅 Popover 列表使用**（无 dockview panel），禁止另写一套卡片样式。action 统一走 `lib/notifications/actions.ts` 分发（同一 id 各载体行为一致；toast 副本按 dedupeKey 标已读）。
2. **状态图标的归属**：StatusIcon 只出现在确认型 toast（结果确认着色）与 Alert 等即时反馈中；**消息型 toast 与消息中心条目一律无前置状态图标**。severity 只驱动行为：徽标只计 warning/error 未读（`attentionUnreadCount`）、toast 时长 error 10s / warning 6s / success·info 4s、DND 仅 error 弹出。不要给 inbox 条目重新引入 severity 图标。
3. **路由单一实现**：投递判定只走 `src/shared/notification-delivery.ts` 的 `resolveDeliveryPlan`（inbox / toast / OS 互斥；mutedKinds → DND（error 除外）→ suppressToast → 聚焦路由 → agent 细粒度静音）；业务代码不得手写 DND / 聚焦 / OS 判定。兼容薄封装 `routeDelivery` / `resolveToastTarget` 假定有 key 窗。
4. **聚焦路由（打断互斥）**：有 Pier key-window → 仅形态 B toast（多窗只投 key 窗；`task-run.finished` 可 origin）；无 key-window → 仅 OS 且 kind ∈ `OS_ELIGIBLE_KINDS`（v1：`agent.attention` / `agent.turn-finished`）。**禁止**同一事件 toast+OS 双发。panel/owner 静音只关打断，**仍落 inbox**。
5. **去重下沉**：同 `dedupeKey` 窗口（24h，`NOTIFICATION_DEDUPE_WINDOW_MS`，契约单一来源）内由 NCS 合并（`repeatCount`），调用方不维护版本/runId 级记录去重；OS 冷却（`cooldownMs`）仅约束系统通知横幅。dedupe 判定依赖镜像水合（`hydrated`），启动期未水合时门面延后判定。
6. **agent 通知同构**：agent「需要你处理」/ 回合结束 / 出错经 agent-attention **只分类 + ingest**；**OS 发送权唯一在 NCS `deliverOs`**（`system-notification.ts` 为适配层）；深链 `focus-panel` 聚焦 agent 面板并标记已读。**提示音跟随打断**（toast 投递成功或 OS `shown`；与 inbox 落档解耦；同一决策互斥不双响）。
7. **入口**：标题栏铃铛（mac `title-bar.tsx` 与非 mac `agent-index-chrome-bar.tsx` 必须同位同步）+ Popover 全量列表（滚动触底加载更多；**无**独立 dockview panel、**无**筛选/搜索）。命令面板 / 默认快捷键 `⌘⇧N`（`pier.notifications.open`，toggle）打开同一 Popover（`useNotificationCenterPopoverStore`）。Header「全部已读」仅在有未读时显示；全部已读 / 勿扰成功后 **保持** Popover 打开（列表即时反映已读/勿扰状态）；卡片导航 action（查看输出 / 聚焦面板 / 重启等）点击后关 Popover；失败走 `showAppAlert`（禁止 silent catch + 假关闭）。
8. **popover 在终端上的四条例**：① 打开期间挂 `registerTerminalFullscreenWebOverlay`（否则点终端不收起）；② `requestTerminalWebFocus` 钉键盘但不 `pushBlockingScope`（否则吞全局快捷键）；③ 订阅 Dialog 打开信号自动收起；④ **终端向 outside 关闭后**才 `markWebOverlayOutsideDismissIfNeeded`（仅 `.terminal-anchor` / `body` / `html`；**排除** trigger 与其它 web 控件）→ cleanup 里 `restoreTerminalFocusAfterWebOverlayDismiss`。Dialog 让路 / Esc / 点铃铛自关不要补聚焦。新增 `+` 创建器等同款。分支状态栏 **Dropdown** 不走全屏路径（modal + blur），勿混用。
9. **设置三卡**：通知设置页按消息生命周期排序——消息中心（记录）→ 提醒内容（类别）→ 提醒方式（通道）；权限/hooks 警示在「提醒方式」卡内顶部 StatusStack。DND **只挡应用内 toast**（error 除外），不挡系统通知。

检查点在 `tests/unit/renderer/notifications/notification-center-governance.test.ts`。
