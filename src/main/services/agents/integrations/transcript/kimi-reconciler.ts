import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { kimiCodeHomeDir } from "../kimi.ts";
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

/** Kimi Code v2 会话布局的主 agent 目录名（binary：MAIN_AGENT_ID="main"）。 */
export const KIMI_MAIN_AGENT_DIR = "main";

interface KimiTranscriptReconcilerOpts {
  onTerminalEvent: Parameters<
    typeof createTranscriptTailReconciler
  >[0]["onTerminalEvent"];
  /** 默认 `{KIMI_CODE_HOME}/sessions` + 老 `~/.kimi/sessions`。 */
  sessionsRoots?: readonly string[];
}

/** 新老家目录的 sessions 根（Kimi Code 换代迁移；老根仅覆盖历史会话）。 */
export function defaultKimiSessionsRoots(): string[] {
  return [
    join(kimiCodeHomeDir(), "sessions"),
    join(homedir(), ".kimi", "sessions"),
  ];
}

/**
 * Kimi Code CLI 终态对账器。
 *
 * 路径双布局（0.38.0 binary 实证）：
 * - v2：`sessions/<projectHash>/<sessionId>/agents/main/wire.jsonl`
 *   （binary：join(sessionDir, "agents", MAIN_AGENT_ID, "wire.jsonl")；
 *   子智能体在 agents/<其它 id>/ 下，不用于主面板）
 * - v1：`sessions/<projectHash>/<sessionId>/wire.jsonl`
 */
export function createKimiTranscriptReconciler(
  opts: KimiTranscriptReconcilerOpts
): KimiTranscriptReconciler {
  const sessionsRoots = (opts.sessionsRoots ?? defaultKimiSessionsRoots()).map(
    (root) => resolve(root)
  );
  const pathCache = new Map<string, string>();
  const inners = sessionsRoots.map((root) =>
    createTranscriptTailReconciler({
      agent: "kimi",
      classifyLine: classifyKimiWireLine,
      onTerminalEvent: opts.onTerminalEvent,
      transcriptRoot: root,
    })
  );
  const innerFor = (path: string): TranscriptTailReconciler | undefined => {
    const index = sessionsRoots.findIndex((root) =>
      path.startsWith(`${root}/`)
    );
    return index >= 0 ? inners[index] : undefined;
  };

  return {
    dispose: () => {
      pathCache.clear();
      for (const inner of inners) {
        inner.dispose();
      }
    },
    observe: async (event) => {
      if (event.agent !== "kimi") {
        return;
      }
      if (event.event === "SessionEnd") {
        await Promise.all(inners.map((inner) => inner.observe(event)));
        return;
      }
      const resolved = await resolveKimiWirePath(
        event,
        sessionsRoots,
        pathCache
      );
      if (!resolved) {
        return;
      }
      const inner = innerFor(resolved);
      if (!inner) {
        return;
      }
      await inner.observe({ ...event, transcriptPath: resolved });
    },
    releasePanel: (panelId, windowId) => {
      for (const inner of inners) {
        inner.releasePanel(panelId, windowId);
      }
    },
    releasePanelsWhere: (predicate) => {
      for (const inner of inners) {
        inner.releasePanelsWhere(predicate);
      }
    },
    releaseWindow: (windowId) => {
      for (const inner of inners) {
        inner.releaseWindow(windowId);
      }
    },
    transferPanelOwnership: (input) => {
      for (const inner of inners) {
        inner.transferPanelOwnership(input);
      }
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
  sessionsRoots: readonly string[],
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
  let found: string | null = null;
  for (const root of sessionsRoots) {
    found = await findKimiWireForSession(root, sessionId);
    if (found) {
      break;
    }
  }
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

/**
 * `sessions/<projectHash>/<sessionId>/` 两层扫描；叶子按 v2
 * （`agents/main/wire.jsonl`）优先、v1（`wire.jsonl`）回退。
 */
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
    const sessionDir = join(sessionsRoot, project.name, sessionId);
    for (const candidate of [
      join(sessionDir, "agents", KIMI_MAIN_AGENT_DIR, "wire.jsonl"),
      join(sessionDir, "wire.jsonl"),
    ]) {
      try {
        if ((await stat(candidate)).isFile()) {
          return candidate;
        }
      } catch {
        // continue
      }
    }
  }
  return null;
}
