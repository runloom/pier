# 消息投递金标准：聚焦路由 · NCS 收敛 OS

**日期：** 2026-08-02  
**状态：** 已实施  
**前置：**  
- [2026-07-24 统一消息中心](../../archive/superpowers/specs/2026-07-24-unified-notification-center-design.md)  
- [2026-07-26 多窗口通知投递](../../archive/superpowers/specs/2026-07-26-multi-window-notification-delivery-design.md)

## 1. 一句话

一条系统事件只 ingest 一次；inbox 始终可回看；打断互斥——有 Pier key-window 则只在该窗形态 B toast，无 key-window 且 kind 在 OS 白名单才发系统通知；agent-attention 只分类与上报。

## 2. 修正的偏差

| 旧实现 | 终态 |
|--------|------|
| `routeDelivery.osNotify` 恒 false | `resolveDeliveryPlan` 按聚焦 + 白名单计算 |
| OS 私发在 agent-attention | OS 仅 NCS `deliverOs` |
| 可 toast+OS 双发 | 互斥 |
| focus suppress 整段 skip（丢 inbox） | 仍 ingest；plan 关打断 |
| 失焦仍弹形态 B | 失焦无 toast |

## 3. DeliveryPlan

实现：`src/shared/notification-delivery.ts` → `resolveDeliveryPlan`。

- **inbox** 恒 true  
- **toast ↔ OS** 互斥  
- **OS 白名单 v1：** `agent.attention`、`agent.turn-finished`  
- **DND：** 只挡 toast（error 除外），不挡 OS  
- **panel/owner 静音：** 挡 toast+OS，不挡 inbox  
- **toast 目标：** key-window；`task-run.finished`+origin → origin-window  
- **OS 冷却：** 仅横幅，键 `makeOsCooldownKey`

## 4. 模块

```
agent-attention.observe → ingestHostNotification
systemNotify → IPC report
                ↓
         NotificationCenterService
           · dedupe / history / broadcast
           · resolveDeliveryPlan(focus, prefs)
           · deliverToast | deliverOs
```

- `agent-attention`：**禁止** import / 调用 `system-notification`  
- 测试通知 forceProbe 仍旁路（设置页自检）

## 5. 检查点

- `tests/unit/shared/notification/delivery.test.ts`  
- `tests/unit/main/notification/center-service.test.ts`  
- `tests/unit/main/notification/center-governance.test.ts`  
- `tests/unit/renderer/notifications/notification-center-governance.test.ts`  
- `AGENTS.md` 消息中心节  

## 6. 非目标

全量 inbox 升 OS；形态 A 进 NCS；DND 默认挡 OS；Dock badge。
