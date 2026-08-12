import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import {
  createTranscriptTailReconciler,
  type TranscriptTailReconciler,
  type TranscriptTerminalRecord,
} from "./tail-reconciler.ts";

export type KimiTranscriptReconciler = TranscriptTailReconciler;

/**
 * Kimi wire.jsonl：`message.type === "TurnEnd"` 表示回合结束。
 * 语料中 payload 为空，无法区分完成与取消——一律 `TurnCompleted`（UI → ready），
 * 足以消除 advisory Stop 漏报导致的「思考中」悬挂。
 * 无独立 interrupt 标记，故 interrupted 维仍 unsupported。
 */
export const KIMI_TRANSCRIPT_TERMINAL_EVIDENCE = [
  {
    nativeEvent: "kimi.wire.TurnEnd",
    pierEvent: "TurnCompleted" as const,
  },
] as const;

interface KimiTranscriptReconcilerOpts {
  onTerminalEvent: Parameters<
    typeof createTranscriptTailReconciler
  >[0]["onTerminalEvent"];
  /** 默认 `~/.kimi/sessions`。 */
  sessionsRoot?: string;
}

/**
 * Kimi Code CLI 终态对账器。
 *
 * 路径：`~/.kimi/sessions/<projectHash>/<sessionId>/wire.jsonl`
 * （subagents 下 wire 不用于主面板）。
 */
export function createKimiTranscriptReconciler(
  opts: KimiTranscriptReconcilerOpts
): KimiTranscriptReconciler {
  const sessionsRoot = resolve(
    opts.sessionsRoot ?? join(homedir(), ".kimi", "sessions")
  );
  const pathCache = new Map<string, string>();
  const inner = createTranscriptTailReconciler({
    agent: "kimi",
    classifyLine: classifyKimiWireLine,
    onTerminalEvent: opts.onTerminalEvent,
    transcriptRoot: sessionsRoot,
  });

  return {
    dispose: () => {
      pathCache.clear();
      inner.dispose();
    },
    observe: async (event) => {
      if (event.agent !== "kimi") {
        return;
      }
      if (event.event === "SessionEnd") {
        await inner.observe(event);
        return;
      }
      const resolved = await resolveKimiWirePath(
        event,
        sessionsRoot,
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

export function classifyKimiWireLine(
  line: string
): TranscriptTerminalRecord | null {
  if (!line.includes("TurnEnd")) {
    return null;
  }
  let parsed: {
    message?: { type?: unknown };
  };
  try {
    parsed = JSON.parse(line) as typeof parsed;
  } catch {
    return null;
  }
  if (parsed.message?.type !== "TurnEnd") {
    return null;
  }
  return {
    ...KIMI_TRANSCRIPT_TERMINAL_EVIDENCE[0],
    turnId: "",
  };
}

async function resolveKimiWirePath(
  event: AgentHookEventPayload,
  sessionsRoot: string,
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
  const found = await findKimiWireForSession(sessionsRoot, sessionId);
  if (found) {
    cache.set(sessionId, found);
    if (cache.size > 256) {
      const first = cache.keys().next().value;
      if (first !== undefined) {
        cache.delete(first);
      }
    }
  }
  return found;
}

/** `sessions/<projectHash>/<sessionId>/wire.jsonl` 两层扫描。 */
export async function findKimiWireForSession(
  sessionsRoot: string,
  sessionId: string
): Promise<string | null> {
  const projects = await readdir(sessionsRoot, { withFileTypes: true }).catch(
    () => null
  );
  if (!projects) {
    return null;
  }
  for (const project of projects) {
    if (!project.isDirectory()) {
      continue;
    }
    const candidate = join(sessionsRoot, project.name, sessionId, "wire.jsonl");
    try {
      if ((await stat(candidate)).isFile()) {
        return candidate;
      }
    } catch {
      // continue
    }
  }
  return null;
}
