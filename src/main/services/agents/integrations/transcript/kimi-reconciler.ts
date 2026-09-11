import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { hookEventTimeMs } from "../../../foreground-activity/turn-unseal.ts";
import { kimiCodeHomeDir } from "../kimi.ts";
import { kimiNativeTurnId, readKimiMainTurnId } from "./kimi-turn-identity.ts";
import { matchesEndedSession } from "./observation-scope.ts";
import { resolveTranscriptPath } from "./tail-path.ts";
import {
  createTranscriptTailReconciler,
  type TranscriptTailReconciler,
  type TranscriptTerminalRecord,
} from "./tail-reconciler.ts";

export type KimiTranscriptReconciler = TranscriptTailReconciler;

/**
 * v2 main turn.ended preserves native turnId and distinguishes cancellation.
 * Legacy message.TurnEnd has no identity or outcome and only indicates ready.
 */
export const KIMI_TRANSCRIPT_TERMINAL_EVIDENCE = [
  {
    nativeEvent: "kimi.wire.TurnEnd",
    pierEvent: "TurnCompleted" as const,
  },
  {
    nativeEvent: "kimi.wire.turn.ended.completed",
    pierEvent: "TurnCompleted" as const,
  },
  {
    nativeEvent: "kimi.wire.turn.ended.cancelled",
    pierEvent: "TurnInterrupted" as const,
  },
  {
    nativeEvent: "kimi.wire.turn.ended.failed",
    pierEvent: "error" as const,
  },
] as const;

/** Kimi Code v2 会话布局的主 agent 目录名（binary：MAIN_AGENT_ID="main"）。 */
export const KIMI_MAIN_AGENT_DIR = "main";

interface KimiObservationScope {
  boundaryAt: number;
  event: AgentHookEventPayload;
  pending: boolean;
  prompt: AgentHookEventPayload | undefined;
  queued: AgentHookEventPayload | undefined;
  retiredTurnIds: Set<string>;
  token: object;
  transcriptPath: string | undefined;
  turnId: string | undefined;
}

const scopeKey = (event: AgentHookEventPayload): string =>
  `${event.windowId}\0${event.panelId}`;

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
  const scopes = new Map<string, KimiObservationScope>();
  let disposed = false;
  const emit = (event: AgentHookEventPayload): void => {
    const scope = scopes.get(scopeKey(event));
    if (!(scope && matchesEndedSession(scope.event, event))) return;
    if (scope.pending) {
      scope.queued = event;
    } else if (!event.turnId || event.turnId === scope.turnId) {
      opts.onTerminalEvent(event);
    }
  };
  const inners = sessionsRoots.map((root) =>
    createTranscriptTailReconciler({
      agent: "kimi",
      createLineClassifier: (path) => (line) => {
        const record = classifyKimiWireLine(line);
        if (record?.nativeEvent === "kimi.wire.turn.ended.cancelled") {
          // Native Interrupt can reach Pier before the durable end is flushed.
          // Reuse the existing tail watcher to retry identity reconciliation;
          // the record itself still needs a verified main-turn owner.
          queueMicrotask(() => {
            for (const scope of scopes.values()) {
              if (
                scope.transcriptPath === path &&
                scope.event.v !== 1 &&
                scope.event.nativeEvent === "Interrupt" &&
                scope.turnId !== record.turnId &&
                !scope.retiredTurnIds.has(record.turnId ?? "")
              ) {
                reconciler.observe(scope.event).catch(() => {
                  // Private compatibility input; native hook delivery continues.
                });
              }
            }
          });
        }
        return record;
      },
      onTerminalEvent: emit,
      transcriptRoot: root,
    })
  );
  const innerFor = (path: string) => {
    const index = sessionsRoots.findIndex((root) =>
      path.startsWith(`${root}/`)
    );
    const inner = inners[index];
    const root = sessionsRoots[index];
    return inner && root ? { inner, root } : undefined;
  };
  const dropScopes = (
    predicate: (panelId: string, windowId: string) => boolean
  ): void => {
    for (const [key, scope] of scopes) {
      if (predicate(scope.event.panelId, scope.event.windowId))
        scopes.delete(key);
    }
  };

  const reconciler: KimiTranscriptReconciler = {
    dispose: () => {
      disposed = true;
      scopes.clear();
      pathCache.clear();
      for (const inner of inners) {
        inner.dispose();
      }
    },
    observe: async (event) => {
      if (disposed || event.agent !== "kimi") {
        return;
      }
      if (event.event === "SessionEnd") {
        const current = scopes.get(scopeKey(event));
        if (current && matchesEndedSession(current.event, event))
          scopes.delete(scopeKey(event));
        await Promise.all(inners.map((inner) => inner.observe(event)));
        return;
      }
      let scope = scopes.get(scopeKey(event));
      if (
        !scope ||
        event.event === "PromptSubmit" ||
        event.event === "SessionStart" ||
        !matchesEndedSession(scope.event, event)
      ) {
        const previousScope =
          scope &&
          matchesEndedSession(scope.event, event) &&
          event.event !== "SessionStart"
            ? scope
            : undefined;
        const retiredTurnIds =
          previousScope?.retiredTurnIds ?? new Set<string>();
        if (previousScope?.turnId !== undefined)
          retiredTurnIds.add(previousScope.turnId);
        for (const inner of inners)
          inner.releasePanel(event.panelId, event.windowId);
        scope = {
          event,
          pending: false,
          prompt: event.event === "PromptSubmit" ? event : undefined,
          boundaryAt: hookEventTimeMs(event, Date.now()),
          queued: undefined,
          retiredTurnIds,
          token: {},
          transcriptPath: undefined,
          turnId: undefined,
        };
        scopes.set(scopeKey(event), scope);
      }
      scope.event = event;
      const token = {};
      scope.token = token;
      scope.pending = true;
      try {
        const resolved = await resolveKimiWirePath(
          event,
          sessionsRoots,
          pathCache
        );
        if (!resolved) {
          return;
        }
        const target = innerFor(resolved);
        if (!target) {
          return;
        }
        const [nativeTurnId, resolution] = await Promise.all([
          readKimiMainTurnId(resolved, target.root, event, scope.boundaryAt),
          resolveTranscriptPath(resolved, target.root, true),
        ]);
        if (
          disposed ||
          scopes.get(scopeKey(scope.event)) !== scope ||
          scope.token !== token
        )
          return;
        scope.transcriptPath = resolution?.path;
        const turnId =
          nativeTurnId !== undefined &&
          !scope.retiredTurnIds.has(nativeTurnId) &&
          hookEventTimeMs(event, Date.now()) >= scope.boundaryAt
            ? nativeTurnId
            : undefined;
        // A newer tool observation may supersede the asynchronous path lookup,
        // but must still establish the pending legacy PromptSubmit watermark.
        if (scope.prompt) {
          const prompt = scope.prompt;
          await target.inner.observe({
            ...prompt,
            windowId: scope.event.windowId,
            transcriptPath: resolved,
          });
          if (
            scopes.get(scopeKey(scope.event)) !== scope ||
            scope.token !== token
          )
            return;
          scope.prompt = undefined;
        }
        if (turnId !== undefined && turnId !== scope.turnId) {
          if (scope.turnId !== undefined)
            scope.retiredTurnIds.add(scope.turnId);
          if (scope.retiredTurnIds.size > 64)
            scope.retiredTurnIds.delete(
              scope.retiredTurnIds.values().next().value ?? ""
            );
          for (const inner of inners)
            inner.releasePanel(scope.event.panelId, scope.event.windowId);
          scope.turnId = turnId;
        }
        if (event.event !== "PromptSubmit") {
          // Hook IDs can belong to children sharing the main session_id.
          // Only a main-wire association may enter transcript owner contexts.
          const { turnId: _unverifiedTurnId, ...context } = scope.event;
          await target.inner.observe({
            ...context,
            transcriptPath: resolved,
            ...(scope.turnId === undefined ? {} : { turnId: scope.turnId }),
          });
        }
      } finally {
        if (
          scopes.get(scopeKey(scope.event)) === scope &&
          scope.token === token
        ) {
          scope.pending = false;
          const queued = scope.queued;
          scope.queued = undefined;
          if (queued) emit(queued);
        }
      }
    },
    releasePanel: (panelId, windowId) => {
      dropScopes(
        (panel, window) =>
          panel === panelId && (windowId === undefined || window === windowId)
      );
      for (const inner of inners) {
        inner.releasePanel(panelId, windowId);
      }
    },
    releasePanelsWhere: (predicate) => {
      dropScopes(predicate);
      for (const inner of inners) {
        inner.releasePanelsWhere(predicate);
      }
    },
    releaseWindow: (windowId) => {
      dropScopes((_panel, window) => window === windowId);
      for (const inner of inners) {
        inner.releaseWindow(windowId);
      }
    },
    transferPanelOwnership: (input) => {
      const { panelId, sourceWindowId, targetWindowId } = input;
      if (
        panelId.trim() &&
        sourceWindowId.trim() &&
        targetWindowId.trim() &&
        sourceWindowId !== targetWindowId
      ) {
        const key = `${sourceWindowId}\0${panelId}`;
        const scope = scopes.get(key);
        if (scope) {
          scopes.delete(key);
          scope.event = { ...scope.event, windowId: targetWindowId };
          if (scope.queued)
            scope.queued = { ...scope.queued, windowId: targetWindowId };
          scopes.set(`${targetWindowId}\0${panelId}`, scope);
        }
      }
      for (const inner of inners) {
        inner.transferPanelOwnership(input);
      }
    },
  };
  return reconciler;
}

export function classifyKimiWireLine(
  line: string
): TranscriptTerminalRecord | null {
  if (!(line.includes("TurnEnd") || line.includes("turn.ended"))) {
    return null;
  }
  let parsed: {
    agentId?: unknown;
    message?: { type?: unknown };
    reason?: unknown;
    turnId?: unknown;
    type?: unknown;
  };
  try {
    parsed = JSON.parse(line) as typeof parsed;
  } catch {
    return null;
  }
  if (parsed?.type === "turn.ended") {
    const turnId = kimiNativeTurnId(parsed.turnId);
    if (parsed.agentId !== KIMI_MAIN_AGENT_DIR || turnId === undefined)
      return null;
    if (parsed.reason === "completed")
      return { ...KIMI_TRANSCRIPT_TERMINAL_EVIDENCE[1], turnId };
    if (parsed.reason === "cancelled")
      return { ...KIMI_TRANSCRIPT_TERMINAL_EVIDENCE[2], turnId };
    if (parsed.reason === "failed")
      return { ...KIMI_TRANSCRIPT_TERMINAL_EVIDENCE[3], turnId };
    return null;
  }
  if (parsed?.message?.type !== "TurnEnd") {
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
