import { resolve } from "node:path";
import { codexHomeDir } from "../codex.ts";
import {
  createTranscriptTailReconciler,
  type TranscriptTailReconciler,
  type TranscriptTerminalRecord,
} from "./tail-reconciler.ts";

export type CodexTranscriptReconciler = TranscriptTailReconciler;

export const CODEX_TRANSCRIPT_TERMINAL_EVIDENCE = [
  { nativeEvent: "codex.transcript.task_complete", pierEvent: "TurnCompleted" },
  {
    nativeEvent: "codex.transcript.turn_aborted",
    pierEvent: "TurnInterrupted",
  },
] as const;

export const CODEX_TRANSCRIPT_INTERACTION_EVIDENCE = [
  {
    nativeEvent: "codex.transcript.request_user_input",
    pierEvent: "InteractionRequested",
  },
  {
    nativeEvent: "codex.transcript.request_user_input.output",
    pierEvent: "InteractionResolved",
  },
  {
    nativeEvent: "codex.transcript.request_permissions",
    pierEvent: "InteractionRequested",
  },
  {
    nativeEvent: "codex.transcript.request_permissions.output",
    pierEvent: "InteractionResolved",
  },
] as const;

interface CodexTranscriptReconcilerOpts {
  onTerminalEvent: Parameters<
    typeof createTranscriptTailReconciler
  >[0]["onTerminalEvent"];
  transcriptRoot?: string;
}

/**
 * Codex TUI 兼容性终态对账器。
 *
 * hooks 当前没有独立的 interrupt 事件；Esc 中断会写入 transcript 的
 * `event_msg/turn_aborted`。这里仅消费 task_complete / turn_aborted 两种终态，
 * 不把 transcript 当工具或过程状态的权威源。现行 rollout 把问卷写成
 * `response_item.function_call`（`name=request_user_input`）；只认旧
 * `event_msg` 会漏掉 InteractionRequested，PreToolUse 把问卷标成 tool。
 * 旧 event_msg 形状仍认。格式再变则静默失效，hook 与 PTY 退出兜底仍然有效。
 *
 * Ev5：`turn_aborted`（含 reason=`interrupted`）只映 `TurnInterrupted`→ready，
 * **不得**映 FA `error`——用户中断不是回合失败。无独立失败终态可映射。
 */
export function createCodexTranscriptReconciler(
  opts: CodexTranscriptReconcilerOpts
): CodexTranscriptReconciler {
  return createTranscriptTailReconciler({
    agent: "codex",
    createLineClassifier: createCodexTranscriptLineClassifier,
    onTerminalEvent: opts.onTerminalEvent,
    transcriptRoot: opts.transcriptRoot ?? resolve(codexHomeDir(), "sessions"),
  });
}

interface PendingCodexInteraction {
  interactionKind: "permission" | "question";
  nativeName: "request_permissions" | "request_user_input";
  turnId: string;
}

const MAX_PENDING_CODEX_INTERACTIONS = 128;

function containsMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.some(containsMeaningfulValue);
  if (typeof value === "object") {
    return Object.values(value).some(containsMeaningfulValue);
  }
  return false;
}

function interactionOutcome(
  interaction: PendingCodexInteraction,
  output: unknown
): "accepted" | "rejected" | "cancelled" | "completed" | "failed" {
  const text =
    typeof output === "string" ? output : JSON.stringify(output ?? "");
  if (text.includes("cancelled before receiving a response")) {
    return "cancelled";
  }
  let parsedOutput: unknown = output;
  if (typeof output === "string") {
    try {
      parsedOutput = JSON.parse(output);
    } catch {
      return "failed";
    }
  }
  if (
    interaction.interactionKind === "permission" &&
    parsedOutput &&
    typeof parsedOutput === "object" &&
    "permissions" in parsedOutput
  ) {
    return containsMeaningfulValue(
      (parsedOutput as { permissions?: unknown }).permissions
    )
      ? "accepted"
      : "rejected";
  }
  return "completed";
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function turnIdFromPayload(payload: {
  internal_chat_message_metadata_passthrough?: { turn_id?: unknown };
  turn_id?: unknown;
}): string {
  const nested = payload.internal_chat_message_metadata_passthrough?.turn_id;
  return stringField(payload.turn_id) || stringField(nested);
}

function rememberInteraction(
  pending: Map<string, PendingCodexInteraction>,
  nativeName: PendingCodexInteraction["nativeName"],
  callId: string,
  turnId: string
): TranscriptTerminalRecord | null {
  if (!callId) return null;
  const interaction: PendingCodexInteraction = {
    interactionKind:
      nativeName === "request_user_input" ? "question" : "permission",
    nativeName,
    turnId,
  };
  pending.delete(callId);
  pending.set(callId, interaction);
  if (pending.size > MAX_PENDING_CODEX_INTERACTIONS) {
    pending.delete(pending.keys().next().value ?? "");
  }
  return {
    interactionId: callId,
    interactionKind: interaction.interactionKind,
    nativeEvent: `codex.transcript.${nativeName}`,
    pierEvent: "InteractionRequested",
    turnId,
  };
}

function createCodexTranscriptLineClassifier(): (
  line: string
) => TranscriptTerminalRecord | null {
  const pending = new Map<string, PendingCodexInteraction>();
  return (line) => {
    const parsed = JSON.parse(line) as {
      payload?: {
        call_id?: unknown;
        internal_chat_message_metadata_passthrough?: { turn_id?: unknown };
        name?: unknown;
        output?: unknown;
        reason?: unknown;
        turn_id?: unknown;
        type?: unknown;
      };
      type?: unknown;
    };
    const payload = parsed.payload;
    if (
      parsed.type === "response_item" &&
      payload?.type === "function_call" &&
      (payload.name === "request_user_input" ||
        payload.name === "request_permissions")
    ) {
      return rememberInteraction(
        pending,
        payload.name,
        stringField(payload.call_id),
        turnIdFromPayload(payload)
      );
    }
    if (parsed.type === "event_msg") {
      if (!payload) return null;
      const nativeType = payload.type;
      if (
        nativeType === "request_user_input" ||
        nativeType === "request_permissions"
      ) {
        return rememberInteraction(
          pending,
          nativeType,
          stringField(payload.call_id),
          turnIdFromPayload(payload)
        );
      }
      const terminalType = payload?.type;
      const isCompleted =
        terminalType === "turn_complete" || terminalType === "task_complete";
      if (!(isCompleted || terminalType === "turn_aborted")) {
        return null;
      }
      if (
        terminalType === "turn_aborted" &&
        payload?.reason !== undefined &&
        payload.reason !== "interrupted"
      ) {
        return null;
      }
      const turnId =
        typeof payload?.turn_id === "string" ? payload.turn_id : "";
      for (const [callId, interaction] of pending) {
        if (!turnId || interaction.turnId === turnId) pending.delete(callId);
      }
      let evidence: {
        nativeEvent: string;
        pierEvent: "TurnCompleted" | "TurnInterrupted";
      } = CODEX_TRANSCRIPT_TERMINAL_EVIDENCE[0];
      if (terminalType === "turn_aborted") {
        evidence = CODEX_TRANSCRIPT_TERMINAL_EVIDENCE[1];
      } else if (terminalType === "turn_complete") {
        evidence = {
          nativeEvent: "codex.transcript.turn_complete",
          pierEvent: "TurnCompleted",
        };
      }
      return { ...evidence, turnId };
    }
    if (
      parsed.type !== "response_item" ||
      payload?.type !== "function_call_output" ||
      typeof payload.call_id !== "string"
    ) {
      return null;
    }
    const interaction = pending.get(payload.call_id);
    if (!interaction) return null;
    pending.delete(payload.call_id);
    return {
      interactionId: payload.call_id,
      interactionKind: interaction.interactionKind,
      interactionOutcome: interactionOutcome(interaction, payload.output),
      nativeEvent: `codex.transcript.${interaction.nativeName}.output`,
      pierEvent: "InteractionResolved",
      turnId: interaction.turnId,
    };
  };
}

/** 单行分类（治理测试 / 格式契约）；交互对账仍需 stateful classifier。 */
export function classifyCodexTranscriptLine(
  line: string
): TranscriptTerminalRecord | null {
  return createCodexTranscriptLineClassifier()(line);
}
