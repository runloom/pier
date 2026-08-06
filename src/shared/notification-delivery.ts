/**
 * 消息投递路由（金标准：2026-08-02 聚焦路由 · NCS 收敛 OS）。
 *
 * - `resolveDeliveryPlan`：唯一打断决策（inbox / toast / OS 互斥 + 窗目标）。
 * - `routeDelivery` / `resolveToastTarget`：兼容薄封装（默认假定有 key 窗，
 *   保持 PR-A 接线前行为；正式调度应直接用 plan + 真实 focus）。
 *
 * 规则摘要：
 * - inbox 恒 true（上报侧已筛掉纯用户动作反馈）。
 * - 有 Pier key-window → 仅形态 B toast（受 muted / suppressToast / DND / agent 细粒度）。
 * - 无 key-window → 仅 OS（且 kind ∈ OS_ELIGIBLE_KINDS）。
 * - toast 与 OS 默认互斥；panel/owner 静音只关打断，不关 inbox。
 * - DND v1 只挡 toast（error 除外），不挡 OS。
 */
import type { TurnNotifyMode } from "@shared/contracts/agent/attention.ts";
import type {
  NotificationKind,
  NotificationSeverity,
} from "@shared/contracts/notification-center.ts";

export interface NotificationDeliveryDecision {
  inbox: boolean;
  osNotify: boolean;
  toast: boolean;
}

/** 形态 B in-app toast 的窗目标（main 单投）。 */
export type ToastTarget =
  | { mode: "none" }
  | { mode: "key-window" }
  | { mode: "origin-window"; originWindowId: string };

/** OS 投递目标（进程级唯一）。 */
export type OsTarget = { mode: "none" } | { mode: "process" };

export interface DeliveryFocus {
  /** 是否存在存活且 focused 的 Pier 窗（key-window）。 */
  hasFocusedPierWindow: boolean;
  /** agent：拥有该 agent 的 BrowserWindow 是否 focused。 */
  isOwnerWindowFocused?: boolean;
  /**
   * agent：目标 panel 是否已在 key 窗为活动**终端** panel
   * （main 读 `activeTerminalPanelId`，切到 web 面板时为 false）。
   */
  isTargetPanelFocused?: boolean;
}

export interface DeliveryInput {
  agentRef?: string;
  kind: NotificationKind;
  originWindowId?: string;
  panelId?: string;
  severity: NotificationSeverity;
  suppressToast?: boolean;
}

export interface DeliveryAgentAttentionPrefs {
  cooldownMs: number;
  enabled: boolean;
  enableErrorAttention: boolean;
  turnNotifyMode: TurnNotifyMode;
}

export interface DeliveryPrefs {
  agentAttention: DeliveryAgentAttentionPrefs;
  dndEnabled: boolean;
  mutedKinds: readonly NotificationKind[];
}

export interface DeliveryPlan {
  decision: NotificationDeliveryDecision;
  /** OS 冷却键；inbox 合并仍走 dedupeKey。 */
  osCooldownKey?: string;
  osTarget: OsTarget;
  toastTarget: ToastTarget;
}

/**
 * 允许走 OS 的 kind（v1 极窄）。
 * 扩容必须：改此表 + 设置文案 + delivery 单测 + 产品确认。
 */
export const OS_ELIGIBLE_KINDS: ReadonlySet<NotificationKind> = new Set([
  "agent.attention",
  "agent.turn-finished",
]);

/** 有明确窗归属、优先投 origin 的 kind。 */
const ORIGIN_AWARE_KINDS: ReadonlySet<NotificationKind> = new Set([
  "task-run.finished",
]);

/** 兼容封装默认 agent 策略（与 DEFAULT_AGENT_ATTENTION_SETTINGS 对齐）。 */
export const DEFAULT_DELIVERY_AGENT_ATTENTION: DeliveryAgentAttentionPrefs = {
  cooldownMs: 180_000,
  enableErrorAttention: false,
  enabled: true,
  turnNotifyMode: "unfocused",
};

/**
 * OS 冷却键。与历史 agent-attention 分 kind 冷却对齐：
 * waiting / error / turn-finished 互不吞没。
 */
export function makeOsCooldownKey(
  kind: NotificationKind,
  severity: NotificationSeverity,
  agentRef: string | undefined
): string | undefined {
  if (!agentRef) {
    return `${kind}:global`;
  }
  if (kind === "agent.attention") {
    const edge = severity === "error" ? "error" : "waiting";
    return `agent.attention:${edge}:${agentRef}`;
  }
  if (kind === "agent.turn-finished") {
    return `agent.turn-finished:${agentRef}`;
  }
  return `${kind}:${agentRef}`;
}

function resolveToastTargetFromInput(input: DeliveryInput): ToastTarget {
  if (
    ORIGIN_AWARE_KINDS.has(input.kind) &&
    input.originWindowId &&
    input.originWindowId.length > 0
  ) {
    return { mode: "origin-window", originWindowId: input.originWindowId };
  }
  return { mode: "key-window" };
}

/**
 * agent 细粒度：是否静音打断（inbox 仍落档）。导出供 attention 事件测试 / 单点语义复用。
 * 返回 true → toast/os 全关。
 *
 * 包含：enabled / enableErrorAttention 二次保险 + 聚焦抑制
 * （attention：目标 panel 聚焦时产品固化静音；turn-finished：turnNotifyMode）。
 */
export function shouldSilenceAgentInterrupt(
  input: Pick<DeliveryInput, "kind" | "severity">,
  prefs: Pick<DeliveryPrefs, "agentAttention">,
  focus: Pick<DeliveryFocus, "isTargetPanelFocused" | "isOwnerWindowFocused">
): boolean {
  if (input.kind === "agent.attention") {
    // 投递侧二次保险：classify 已滤，但防御错误 ingest。
    if (input.severity === "error") {
      if (!prefs.agentAttention.enableErrorAttention) {
        return true;
      }
    } else if (!prefs.agentAttention.enabled) {
      return true;
    }
    // 产品固化：盯着该智能体面板时不弹「需要你处理 / 出错」打断（仍落 inbox）。
    if (focus.isTargetPanelFocused === true) {
      return true;
    }
    return false;
  }

  if (input.kind === "agent.turn-finished") {
    const mode = prefs.agentAttention.turnNotifyMode;
    if (mode === "off") {
      return true;
    }
    // 仅窗口未聚焦：拥有该智能体的窗口在前台则静音打断。
    if (mode === "unfocused" && focus.isOwnerWindowFocused === true) {
      return true;
    }
    // 仅面板未聚焦：目标智能体面板已是活动面板则静音（同窗异面板仍可提醒）。
    if (mode === "panel-unfocused" && focus.isTargetPanelFocused === true) {
      return true;
    }
    return false;
  }

  return false;
}

/**
 * 唯一打断决策。inbox 恒 true；toast 与 OS 互斥。
 */
export function resolveDeliveryPlan(
  input: DeliveryInput,
  prefs: DeliveryPrefs,
  focus: DeliveryFocus
): DeliveryPlan {
  const decision: NotificationDeliveryDecision = {
    inbox: true,
    osNotify: false,
    toast: false,
  };

  if (shouldSilenceAgentInterrupt(input, prefs, focus)) {
    return {
      decision,
      osTarget: { mode: "none" },
      toastTarget: { mode: "none" },
    };
  }

  const contentMuted =
    input.suppressToast === true || prefs.mutedKinds.includes(input.kind);
  if (contentMuted) {
    return {
      decision,
      osTarget: { mode: "none" },
      toastTarget: { mode: "none" },
    };
  }

  const dndBlocksToast = prefs.dndEnabled && input.severity !== "error";
  const osEligible = OS_ELIGIBLE_KINDS.has(input.kind);

  if (focus.hasFocusedPierWindow) {
    decision.toast = !dndBlocksToast;
    decision.osNotify = false;
  } else {
    decision.toast = false;
    // DND v1 不阻断 OS。
    decision.osNotify = osEligible;
  }

  // 互斥硬约束（防御未来改写）。
  if (decision.toast && decision.osNotify) {
    decision.osNotify = false;
  }

  const toastTarget = decision.toast
    ? resolveToastTargetFromInput(input)
    : { mode: "none" as const };
  const osTarget = decision.osNotify
    ? { mode: "process" as const }
    : { mode: "none" as const };

  const plan: DeliveryPlan = {
    decision,
    osTarget,
    toastTarget,
  };

  if (decision.osNotify) {
    const key = makeOsCooldownKey(input.kind, input.severity, input.agentRef);
    if (key) {
      plan.osCooldownKey = key;
    }
  }

  return plan;
}

/**
 * 兼容薄封装用的 agent 切片：关闭一切 agent 细粒度静音，只保留 mute/DND/suppressToast。
 * （历史 routeDelivery 不感知 enabled / panel focus / turnNotifyMode；
 *  focus 入参通常不带 isTargetPanelFocused，attention 面板静音不会误触发。）
 */
const COMPAT_PASSTHROUGH_AGENT_ATTENTION: DeliveryAgentAttentionPrefs = {
  cooldownMs: DEFAULT_DELIVERY_AGENT_ATTENTION.cooldownMs,
  enableErrorAttention: true,
  enabled: true,
  turnNotifyMode: "always",
};

/**
 * 兼容封装：假定 hasFocusedPierWindow=true，且不做 agent 细粒度静音。
 * 正式调度请用 resolveDeliveryPlan + 真实 focus + 真实 agentAttention prefs。
 */
export function routeDelivery(
  input: {
    kind: NotificationKind;
    severity: NotificationSeverity;
    suppressToast?: boolean;
  },
  prefs: { dndEnabled: boolean; mutedKinds: readonly NotificationKind[] }
): NotificationDeliveryDecision {
  return resolveDeliveryPlan(
    input,
    {
      agentAttention: COMPAT_PASSTHROUGH_AGENT_ATTENTION,
      dndEnabled: prefs.dndEnabled,
      mutedKinds: prefs.mutedKinds,
    },
    { hasFocusedPierWindow: true }
  ).decision;
}

/**
 * 在 toast 允许时选出单投目标。
 * 兼容封装：假定有 key 窗；不做 agent 细粒度静音。
 */
export function resolveToastTarget(
  input: {
    kind: NotificationKind;
    severity: NotificationSeverity;
    suppressToast?: boolean;
    originWindowId?: string;
  },
  prefs: { dndEnabled: boolean; mutedKinds: readonly NotificationKind[] }
): ToastTarget {
  return resolveDeliveryPlan(
    input,
    {
      agentAttention: COMPAT_PASSTHROUGH_AGENT_ATTENTION,
      dndEnabled: prefs.dndEnabled,
      mutedKinds: prefs.mutedKinds,
    },
    { hasFocusedPierWindow: true }
  ).toastTarget;
}
