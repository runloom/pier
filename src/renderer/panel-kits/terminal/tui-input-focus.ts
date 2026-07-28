import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import type { TerminalCursorVisibility } from "@shared/contracts/terminal.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { recordCursorVisibility } from "./tui-cursor-semantics.ts";

/**
 * TUI 输入聚焦：cursor-visible 探针 +（可选）catalog 恢复键。
 *
 * **两级适用面**（缺一不提示、不恢复）：
 * 1. 先验：catalog 声明 `inputFocusProbe: "cursor"`（人工核实过「硬件光标可见
 *    ⇔ 输入框聚焦」，当前 grok / crush）。部分现代 TUI 自绘光标、首帧后恒
 *    `?25l`（实测 claude / gemini / opencode / droid / cursor-agent 聚焦时同样
 *    隐藏硬件光标），对它们探针恒 hidden。
 * 2. 会话观察：当前 agent 活动会话观察到过 `visible`（见
 *    `tui-cursor-semantics.ts`）。上游改版翻转语义时最坏退化成「只提示或放行」，
 *    不会据此禁用发送。
 *
 * 判定不变量（两处消费者必须一致）：
 * - `visible` → 可发送，并 arm 该面板。
 * - `hidden` + 已 arm → 标记「可能未聚焦」；运行中也观察，但不禁用发送按钮。
 * - `hidden` + 未 arm → 放行（语义证据不足，不能据此限制功能）。
 * - `unknown`（surface 未建 / addon 未加载）→ **放行**，不得当作失焦。
 * - 恢复键：另需 `inputFocusKey`（crush=Tab）才在 ensure 路径注入，且只在已 arm
 *   时注入（避免对语义未知的会话盲发 toggle 键）。
 */

/** 恢复键确认轮询：TUI 处理按键 → 发 ?25h → 模式位更新是异步回路。 */
const CONFIRM_POLL_INTERVAL_MS = 40;
const CONFIRM_TIMEOUT_MS = 400;

const inflight = new Map<string, Promise<boolean>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 该 agent 的硬件光标是否可作聚焦信号（catalog 逐一核实后声明的先验）。 */
export function agentUsesCursorProbe(agentId: AgentKind | undefined): boolean {
  if (agentId === undefined) {
    return false;
  }
  return getAgentCatalogEntry(agentId)?.inputFocusProbe === "cursor";
}

/** 读一次探针并登记会话观察；返回读数与该面板是否已 arm。 */
export async function probeCursor(
  panelId: string,
  agentId: AgentKind,
  activitySpawnedAt: number
): Promise<{
  armed: boolean;
  currentSession: boolean;
  visibility: TerminalCursorVisibility;
}> {
  const visibility = await window.pier.terminal.cursorVisible(panelId);
  const currentSession = isCurrentAgentSession({
    activitySpawnedAt,
    agentId,
    panelId,
  });
  if (!currentSession) {
    // 异步探针返回时面板已经重启或换了智能体：旧结果不得污染新会话。
    return { armed: false, currentSession, visibility };
  }
  const armed = recordCursorVisibility({
    activitySpawnedAt,
    agentId,
    panelId,
    visibility,
  });
  return { armed, currentSession, visibility };
}

async function tryRecoveryKey(input: {
  activitySpawnedAt: number;
  agentId: AgentKind;
  panelId: string;
}): Promise<boolean> {
  const { activitySpawnedAt, agentId, panelId } = input;
  if (!canInjectRecoveryKey(input)) {
    return false;
  }
  const focusKey = getAgentCatalogEntry(agentId)?.inputFocusKey;
  if (!focusKey) {
    return false;
  }
  const sendResult = await window.pier.terminal.sendKeyPress({
    keycode: focusKey.keycode,
    panelId,
    ...(focusKey.mods === undefined ? {} : { mods: focusKey.mods }),
    ...(focusKey.text === undefined ? {} : { text: focusKey.text }),
  });
  if (!sendResult.ok) {
    return false;
  }

  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(CONFIRM_POLL_INTERVAL_MS);
    if (!canInjectRecoveryKey(input)) {
      return false;
    }
    const confirmed = await probeCursor(panelId, agentId, activitySpawnedAt);
    if (confirmed.visibility === "visible") {
      return true;
    }
    // 读不到：与门禁同一不变量，不当作失焦 → 放行（键已发，不再重试）。
    if (confirmed.visibility === "unknown") {
      return true;
    }
  }
  return false;
}

function canInjectRecoveryKey(input: {
  activitySpawnedAt: number;
  agentId: AgentKind;
  panelId: string;
}): boolean {
  const activity =
    useForegroundActivityStore.getState().activities[input.panelId];
  return (
    activity?.kind === "agent" &&
    activity.agentId === input.agentId &&
    activity.spawnedAt === input.activitySpawnedAt &&
    activity.status !== "waiting"
  );
}

function isCurrentAgentSession(input: {
  activitySpawnedAt: number;
  agentId: AgentKind;
  panelId: string;
}): boolean {
  const activity =
    useForegroundActivityStore.getState().activities[input.panelId];
  return (
    activity?.kind === "agent" &&
    activity.agentId === input.agentId &&
    activity.spawnedAt === input.activitySpawnedAt
  );
}

async function doEnsureTuiInputFocus(
  panelId: string,
  activity: AgentActivity
): Promise<boolean> {
  const { agentId, spawnedAt } = activity;
  // 未核实等价关系的 agent：探针无意义，直接放行（行为等同无探针）。
  if (!agentUsesCursorProbe(agentId)) {
    return true;
  }

  const { armed, currentSession, visibility } = await probeCursor(
    panelId,
    agentId,
    spawnedAt
  );
  if (!currentSession) {
    return false;
  }
  if (visibility === "visible") {
    return true;
  }
  // 读不到 / 会话内证据不足：不限制发送（与风险提示共用同一不变量）。
  if (visibility === "unknown" || !armed) {
    return true;
  }

  return await tryRecoveryKey({
    activitySpawnedAt: spawnedAt,
    agentId,
    panelId,
  });
}

export function ensureTuiInputFocus(panelId: string): Promise<boolean> {
  const activity = useForegroundActivityStore.getState().activities[panelId];
  if (activity?.kind !== "agent") {
    return Promise.resolve(false);
  }
  // 互斥绑定活动会话而非面板：同一面板快速重启时，不能复用上一进程的恢复结果。
  const sessionKey = `${panelId}\u0000${activity.agentId}\u0000${activity.spawnedAt}`;
  const existing = inflight.get(sessionKey);
  if (existing) {
    return existing;
  }
  const pending = doEnsureTuiInputFocus(panelId, activity).finally(() => {
    if (inflight.get(sessionKey) === pending) {
      inflight.delete(sessionKey);
    }
  });
  inflight.set(sessionKey, pending);
  return pending;
}

/** 测试专用：清空 in-flight 状态。 */
export function resetTuiInputFocusForTests(): void {
  inflight.clear();
}
