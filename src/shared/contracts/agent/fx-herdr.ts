import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";

/**
 * fx Herdr 生命周期上报 → Pier 规范事件。
 *
 * 上游事实（vercel-labs/fx@e45d780933bfb42ae376aee54a49bd3ebe81f04d）：
 * - `src/builtins/hooks/herdr.zig`：短连接 Unix socket，每 report 一次 connect；
 *   JSON-RPC 单行帧 `{"id":"<n>","method":"pane.report_agent","params":{
 *   "pane_id","source":"custom:fx","agent":"fx","state","custom_status?"}}`；
 *   state ∈ idle|working|blocked；custom_status ≤32B（permission/question/
 *   recovery 三种，见 `src/builtins/hooks.zig` attentionStatus）。
 * - `src/builtins/hooks.zig`：interactive scope 才上报；startup 先 reportSession
 *   再 idle+announce；prompt 入队/恢复/compact 入队 → working；PostTurnEnd →
 *   idle；AttentionRequired → blocked+reason；exit 经 deinit release。
 * - ask 模式（`src/core/cli/cli_ask.zig`）无 Herdr 引用：Pier 走 `fx ask`
 *   one-shot，不在此通道产生状态。
 *
 * Pier 映射纪律：
 * - working → processing（显式 prompt 等价物；turnStartAuthority=none，
 *   与 PromptSubmit 的 explicit-prompt 区分：Herdr working 只证明执行中，
 *   不携带用户提问内容）。
 * - idle → ActivityIdle（native idle 事实：只在无活跃工作时恢复 ready，
 *   不封回合；见 activity-idle.ts）。
 * - blocked 全种（permission/question/recovery）→ processing：上游只有请求帧、
 *   无配对解除帧，按等待治理不得进 waiting；原因保留在 nativeEvent
 *  （herdr.blocked.permission 等）供诊断。
 * - turnId 恒为空：Herdr 帧无回合身份，走 PromptSubmit 文件水位纪律
 *   （transcriptTurnIdentity: "absent"）；禁止伪造 turn 身份。
 */

export const FX_HERDR_SOURCE = "custom:fx";
export const FX_HERDR_AGENT = "fx";

export type FxHerdrState = "idle" | "working" | "blocked";
export type FxHerdrBlockedReason = "permission" | "question" | "recovery";

export interface FxHerdrReport {
  customStatus?: string | undefined;
  paneId: string;
  sessionId?: string | undefined;
  state: FxHerdrState;
}

const PANE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const SESSION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

/** 单帧 JSON-RPC → Herdr 上报；非 report_agent 方法/非法帧返回 null。 */
export function parseFxHerdrFrame(line: string): FxHerdrReport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return null;
  }
  if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.method !== "pane.report_agent") {
    return null;
  }
  const params = record.params;
  if (!(params && typeof params === "object" && !Array.isArray(params))) {
    return null;
  }
  const p = params as Record<string, unknown>;
  if (p.source !== FX_HERDR_SOURCE || p.agent !== FX_HERDR_AGENT) {
    return null;
  }
  const paneId = p.pane_id;
  const state = p.state;
  if (typeof paneId !== "string" || !PANE_ID_RE.test(paneId)) {
    return null;
  }
  if (state !== "idle" && state !== "working" && state !== "blocked") {
    return null;
  }
  const out: FxHerdrReport = { paneId, state };
  const customStatus = p.custom_status;
  // 三元 reason 外的 custom_status 只作 Herdr UI 标签，不进入状态机。
  if (
    customStatus === "permission" ||
    customStatus === "question" ||
    customStatus === "recovery"
  ) {
    out.customStatus = customStatus;
  }
  const sessionId = p.agent_session_id;
  if (typeof sessionId === "string" && SESSION_ID_RE.test(sessionId)) {
    out.sessionId = sessionId;
  }
  return out;
}

export type FxHerdrPierEvent =
  | { event: "ActivityIdle" }
  | { event: "processing" };

/** Herdr 上报 → Pier 规范事件（无回合身份、无 tool 上下文）。 */
export function fxHerdrReportToPierEvent(
  report: FxHerdrReport
): FxHerdrPierEvent {
  if (report.state === "idle") {
    return { event: "ActivityIdle" };
  }
  if (report.state === "working") {
    return { event: "processing" };
  }
  // blocked 全种（含 permission/question/recovery）：上游只有请求帧、无配对
  // 解除帧，按等待治理（请求+解除成对）不得进 waiting；保持 processing，
  // 以 nativeEvent 区分原因（herdr.blocked.permission 等）。
  return { event: "processing" };
}

/** Herdr pane_id（`terminal-<id>`）→ Pier panelId；非本窗格式返回 null。 */
export function fxHerdrPanelId(paneId: string): string | null {
  return paneId.startsWith("terminal-") && paneId.length > "terminal-".length
    ? paneId
    : null;
}

export interface FxHerdrAgentEventFields {
  event: FxHerdrPierEvent["event"];
  nativeEvent: string;
  sessionId?: string | undefined;
}

/** 审计用：report → 事件字段（含 nativeEvent 命名），与 ingest 组装分离。 */
export function fxHerdrEventFields(
  report: FxHerdrReport
): FxHerdrAgentEventFields {
  const pier = fxHerdrReportToPierEvent(report);
  const nativeEvent =
    report.state === "blocked"
      ? `herdr.blocked.${report.customStatus ?? "unknown"}`
      : `herdr.${report.state}`;
  return {
    event: pier.event,
    nativeEvent,
    ...(report.sessionId ? { sessionId: report.sessionId } : {}),
  };
}

/** report → 严格 v3 agentEvent（panelId/windowId 由调用方路由后填入）。 */
export function fxHerdrToAgentEvent(
  report: FxHerdrReport,
  route: { panelId: string; windowId: string }
): AgentHookEventPayload {
  const fields = fxHerdrEventFields(report);
  return {
    agent: "fx",
    event: fields.event,
    kind: "agentEvent",
    nativeEvent: fields.nativeEvent,
    panelId: route.panelId,
    ...(fields.sessionId ? { sessionId: fields.sessionId } : {}),
    v: 3,
    windowId: route.windowId,
  } as AgentHookEventPayload;
}
