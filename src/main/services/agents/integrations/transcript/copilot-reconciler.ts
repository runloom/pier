import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import {
  createTranscriptTailReconciler,
  type TranscriptTailReconciler,
  type TranscriptTerminalRecord,
} from "./tail-reconciler.ts";

export type CopilotTranscriptReconciler = TranscriptTailReconciler;

/**
 * Copilot session-state events.jsonl 终态：
 * - `abort` + 用户取消 reason 白名单 → TurnInterrupted（Esc；agentStop 常不发）
 * - `assistant.turn_end` → TurnCompleted（正常回合结束；与 advisory agentStop 双轨）
 */
export const COPILOT_TRANSCRIPT_TERMINAL_EVIDENCE = [
  {
    nativeEvent: "copilot.events.abort.user_initiated",
    pierEvent: "TurnInterrupted" as const,
  },
  {
    nativeEvent: "copilot.events.assistant.turn_end",
    pierEvent: "TurnCompleted" as const,
  },
] as const;

/** 归一化后的用户取消 reason；禁止 substring `"user"`（会误伤 user_timeout 等）。 */
const COPILOT_USER_ABORT_REASONS = new Set([
  "user initiated",
  "user cancelled",
  "user canceled",
  "cancelled by user",
  "canceled by user",
]);

interface CopilotTranscriptReconcilerOpts {
  onTerminalEvent: Parameters<
    typeof createTranscriptTailReconciler
  >[0]["onTerminalEvent"];
  /** 默认 `~/.copilot/session-state`。 */
  sessionStateRoot?: string;
}

/**
 * GitHub Copilot CLI 终态对账器。
 *
 * 路径：`~/.copilot/session-state/<sessionId>/events.jsonl`
 * PromptSubmit 的 hook 常有 sessionId、无 transcriptPath；agentStop 有 path。
 */
export function createCopilotTranscriptReconciler(
  opts: CopilotTranscriptReconcilerOpts
): CopilotTranscriptReconciler {
  const sessionStateRoot = resolve(
    opts.sessionStateRoot ?? join(homedir(), ".copilot", "session-state")
  );
  const pathCache = new Map<string, string>();
  const inner = createTranscriptTailReconciler({
    agent: "copilot",
    classifyLine: classifyCopilotEventsLine,
    onTerminalEvent: opts.onTerminalEvent,
    transcriptRoot: sessionStateRoot,
  });

  return {
    dispose: () => {
      pathCache.clear();
      inner.dispose();
    },
    observe: async (event) => {
      if (event.agent !== "copilot") {
        return;
      }
      if (event.event === "SessionEnd") {
        await inner.observe(event);
        return;
      }
      const resolved = await resolveCopilotEventsPath(
        event,
        sessionStateRoot,
        pathCache
      );
      if (!resolved) {
        return;
      }
      await inner.observe({ ...event, transcriptPath: resolved });
    },
    releasePanel: (panelId, windowId) => {
      inner.releasePanel(panelId, windowId);
    },
    releasePanelsWhere: (predicate) => {
      inner.releasePanelsWhere(predicate);
    },
    releaseWindow: (windowId) => {
      inner.releaseWindow(windowId);
    },
    transferPanelOwnership: (input) => {
      inner.transferPanelOwnership(input);
    },
  };
}

/** 导出供单测锁定格式契约。 */
export function classifyCopilotEventsLine(
  line: string
): TranscriptTerminalRecord | null {
  // 廉价预筛
  if (!(line.includes('"abort"') || line.includes("turn_end"))) {
    return null;
  }
  let parsed: {
    data?: { reason?: unknown; turnId?: unknown };
    type?: unknown;
  };
  try {
    parsed = JSON.parse(line) as typeof parsed;
  } catch {
    return null;
  }
  if (parsed.type === "abort") {
    const reason = String(parsed.data?.reason ?? "")
      .toLowerCase()
      .replaceAll("_", " ")
      .trim();
    if (COPILOT_USER_ABORT_REASONS.has(reason)) {
      return {
        ...COPILOT_TRANSCRIPT_TERMINAL_EVIDENCE[0],
        turnId: "",
      };
    }
    return null;
  }
  if (parsed.type === "assistant.turn_end") {
    const turnId =
      typeof parsed.data?.turnId === "string" ? parsed.data.turnId.trim() : "";
    return {
      ...COPILOT_TRANSCRIPT_TERMINAL_EVIDENCE[1],
      turnId,
    };
  }
  return null;
}

async function resolveCopilotEventsPath(
  event: AgentHookEventPayload,
  sessionStateRoot: string,
  cache: Map<string, string>
): Promise<string | null> {
  const explicit = event.transcriptPath?.trim();
  if (explicit) {
    return explicit;
  }
  const sessionId = event.sessionId?.trim();
  if (!sessionId) {
    return null;
  }
  const cached = cache.get(sessionId);
  if (cached) {
    const st = await stat(cached).catch(() => null);
    if (st?.isFile()) {
      return cached;
    }
    cache.delete(sessionId);
  }
  const candidate = join(sessionStateRoot, sessionId, "events.jsonl");
  try {
    const st = await stat(candidate);
    if (st.isFile()) {
      cache.set(sessionId, candidate);
      return candidate;
    }
  } catch {
    // 未落盘
  }
  return null;
}
