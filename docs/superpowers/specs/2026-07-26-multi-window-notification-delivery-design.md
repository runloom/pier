# 多窗口通知投递 · 金标准终态

**日期：** 2026-07-26  
**状态：** 实现中（Strict main-owned）  
**拍板：**

1. 形态 B 即时性：**Strict main-owned**（不 optimistic）
2. 归属窗：**Origin-aware**（`task-run.finished` 等有 origin 时投归属窗）
3. 无 key 窗时消息 toast：**none**（不 fallback 随机窗）

## 1. 原则

| # | 原则 |
|---|------|
| P1 | 通道分权：toast / inbox / OS / sound / dialog |
| P2 | 状态全窗复制；打断（消息 toast / 声音 / OS）进程级唯一 |
| P3 | main 唯一写入 + 唯一投递调度 |
| P4 | renderer 无形态 B 投递主权 |
| P5 | 焦点源 = OS key-window（main focus/blur） |
| P6 | 确认型（形态 A）仅触发窗本地 sonner |
| P7 | toast ≠ 已读 |

## 2. 流水线

```
ingest(report, { originWindowId? })
  → normalize / dedupe / persist
  → broadcast snapshot（全窗 inbox）
  → resolveToastTarget → sendMessageToastToOneWindow（0|1 窗）
```

- `NOTIFICATION_CENTER_CHANGED`：全窗
- `NOTIFICATION_CENTER_MESSAGE_TOAST`：单窗
- OS / 声音：既有进程级唯一路径不变

## 3. Toast 目标

| kind | 目标 |
|------|------|
| `task-run.finished` + 有 originWindowId | origin-window（窗毁则 fallback key） |
| 其余且 `routeDelivery.toast` | key-window（无 key → 不弹） |
| `routeDelivery.toast === false` | none |

`originWindowId` 来自 IPC `event.sender` 的 electron window id（字符串），不由业务伪造。

## 4. 反模式

- 各 renderer 订阅 store 后各自弹形态 B
- `document.hasFocus()` 作投递门闩
- 无 key 时对消息 toast fallback 任意窗
- 形态 A 进 NCS / 形态 B 裸 sonner

## 5. 与 2026-07-24 消息中心设计关系

本文件补齐多窗扇出；不改变 inbox / 已读 / DND / agent OS 发送权归属。
