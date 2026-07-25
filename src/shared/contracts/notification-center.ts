/**
 * 统一消息中心契约（设计文档 2026-07-24-unified-notification-center-design.md §5）。
 *
 * - main 侧 NotificationCenterService 是唯一写入方：normalize → dedupe → ring buffer → 广播。
 * - renderer 镜像 store 只读快照；toast / popover 共用同一条 AppNotification。
 * - 用户动作的即时 toast 不经过本契约（纯瞬态反馈不留痕）。
 */
import { z } from "zod";

export const NOTIFICATION_SEVERITIES = [
  "info",
  "success",
  "warning",
  "error",
] as const;
export const notificationSeveritySchema = z.enum(NOTIFICATION_SEVERITIES);
export type NotificationSeverity = z.infer<typeof notificationSeveritySchema>;

export const NOTIFICATION_TRIGGERS = ["user-action", "system-event"] as const;
export const notificationTriggerSchema = z.enum(NOTIFICATION_TRIGGERS);
export type NotificationTrigger = z.infer<typeof notificationTriggerSchema>;

/** 消息类别：路由、按类静音（mutedKinds）的维度。 */
export const NOTIFICATION_KINDS = [
  "agent.attention",
  "agent.turn-finished",
  "agent.runtime",
  "task-run.finished",
  "app.update",
  "channel.health",
  "plugin.event",
  "operation.result",
] as const;
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/** 卡片 action；id 由 renderer 侧 action 渲染器分发（focus-panel / open-output / relaunch / retry / open-settings）。 */
export const notificationActionSchema = z.object({
  id: z.string().min(1).max(64),
  /** 宿主 locale key；卡片渲染时按当前语言 resolve。 */
  labelKey: z.string().min(1).max(160),
});
export type NotificationAction = z.infer<typeof notificationActionSchema>;

export const appNotificationSchema = z.object({
  id: z.string().min(1).max(64),
  kind: notificationKindSchema,
  /** "host" | 插件 id | "agent-attention" …，按源静音/归因用。 */
  source: z.string().min(1).max(128),
  severity: notificationSeveritySchema,
  trigger: notificationTriggerSchema,
  /** 上报时已 resolve 的展示标题（插件消息、含动态内容的兜底）。 */
  title: z.string().min(1).max(300),
  /** 宿主消息另存 key + 参数，卡片按当前语言重 resolve（locale 切换不错位）。 */
  titleKey: z.string().min(1).max(160).optional(),
  titleParams: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .optional(),
  /** 技术详情（err.message 等），仅 inbox 内展示。 */
  body: z.string().max(4000).optional(),
  ts: z.number().int().nonnegative(),
  read: z.boolean(),
  /** 去重键（"app-update:<version>" / "task-run:<runId>" …），窗口内合并。 */
  dedupeKey: z.string().max(240).optional(),
  /** dedupe 合并次数（≥2 时 UI 可展示「×N」）。 */
  repeatCount: z.number().int().positive().optional(),
  panelRef: z.object({ panelId: z.string().min(1).max(128) }).optional(),
  agentRef: z.string().max(240).optional(),
  /** action 分发所需的上下文（如 { runId }），renderer action 渲染器消费。 */
  actionParams: z.record(z.string(), z.string()).optional(),
  actions: z.array(notificationActionSchema).max(2).optional(),
});
export type AppNotification = z.infer<typeof appNotificationSchema>;

/** renderer → main 上报载荷（id/ts/read/repeatCount 由 NCS 分配，strict 拒绝夹带）。 */
export const notificationReportSchema = appNotificationSchema
  .omit({
    id: true,
    ts: true,
    read: true,
    repeatCount: true,
  })
  .strict();
export type NotificationReport = z.infer<typeof notificationReportSchema>;

export const NOTIFICATION_CENTER_HISTORY_LIMIT = 200;

/** dedupe 合并窗口（main NCS 与 renderer 门面共用，单一来源）。 */
export const NOTIFICATION_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const notificationCenterSnapshotSchema = z.object({
  /** 按 ts 倒序（新→旧），上限 NOTIFICATION_CENTER_HISTORY_LIMIT。 */
  items: z.array(appNotificationSchema).max(NOTIFICATION_CENTER_HISTORY_LIMIT),
  unreadCount: z.number().int().nonnegative(),
  dndEnabled: z.boolean(),
  /** 单调递增序号，镜像 store 乱序守卫（对齐 FA 广播 ts）。 */
  seq: z.number().int().nonnegative(),
});
export type NotificationCenterSnapshot = z.infer<
  typeof notificationCenterSnapshotSchema
>;

/* ── 偏好（preferences.notificationCenter） ───────────────────── */

export const NOTIFICATION_RETENTION_DAYS = [7, 30] as const;
export type NotificationRetentionDays =
  (typeof NOTIFICATION_RETENTION_DAYS)[number];

export const notificationCenterPrefsSchema = z
  .object({
    /** 勿扰：toast 静默（error 除外），消息仍进 inbox。 */
    dndEnabled: z.boolean().default(false),
    retentionDays: z.union([z.literal(7), z.literal(30)]).default(7),
    /** 标题栏铃铛未读徽标。 */
    showUnreadBadge: z.boolean().default(true),
    /** 按类静音：这些 kind 不再弹 toast（仍进 inbox）。 */
    mutedKinds: z.array(notificationKindSchema).default([]),
  })
  .strict();
export type NotificationCenterPrefs = z.infer<
  typeof notificationCenterPrefsSchema
>;

export const DEFAULT_NOTIFICATION_CENTER_PREFS: NotificationCenterPrefs = {
  dndEnabled: false,
  retentionDays: 7,
  showUnreadBadge: true,
  mutedKinds: [],
};
