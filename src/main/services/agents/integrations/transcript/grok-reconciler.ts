import { open, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { resolveGrokSessionsRoot } from "../../grok-paths.ts";
import {
  applyGrokQuestionLine,
  scanGrokQuestionState,
} from "./grok-question.ts";
import { emitTranscriptEvent } from "./tail-event.ts";
import {
  createTranscriptTailReconciler,
  type TranscriptTailReconciler,
  type TranscriptTerminalRecord,
} from "./tail-reconciler.ts";

export { GROK_TRANSCRIPT_INTERACTION_EVIDENCE } from "./grok-question.ts";

export type GrokTranscriptReconciler = TranscriptTailReconciler;

export const GROK_TRANSCRIPT_TERMINAL_EVIDENCE = [
  {
    nativeEvent: "grok.updates.turn_completed.cancelled",
    pierEvent: "TurnInterrupted",
  },
  {
    nativeEvent: "grok.updates.turn_completed.end_turn",
    pierEvent: "TurnCompleted",
  },
] as const;

interface GrokTranscriptReconcilerOpts {
  onTerminalEvent: Parameters<
    typeof createTranscriptTailReconciler
  >[0]["onTerminalEvent"];
  /** 默认 `$GROK_HOME/sessions` 或 `~/.grok/sessions`。 */
  sessionsRoot?: string;
}

/**
 * Grok Build CLI 终态对账器。
 *
 * 当前运行证据来自 v0.2.114 签名二进制及随附 hooks 文档/变更日志：
 * Esc/Ctrl+C、refused、max-turns 与 Stop 门禁满 8 次强制结束
 * **不触发 Stop hook**。公开 v0.2.112 源码快照只用于核验
 * `updates.jsonl` 字段和写入调用点。可信终态写在会话
 * `updates.jsonl` 的 `sessionUpdate: turn_completed`：
 * - `stop_reason: cancelled` → TurnInterrupted（用户中断）
 * - `stop_reason: end_turn` → TurnCompleted（正常完成；与 advisory Stop 双轨，
 *   覆盖强制结束/漏报 Stop）
 * - `error` / `rate_limit` 不在此映射（优先 StopFailure→error；避免谎报 ready）
 *
 * 路径：`<GROK_HOME>/sessions/<encoded-cwd>/<sessionId>/updates.jsonl`
 * （未设置时 `GROK_HOME` 为 `~/.grok`）。
 * hook 当前通常不带 transcriptPath，observe 时按 sessionId 在 sessions 根下解析。
 * 终态只认 turn_completed。问卷只认 tool_call / completed，不走 hook
 * Interaction（Post 可能在 UI 画出时就响）。
 */
function grokScopeKey(event: AgentHookEventPayload): string {
  return `${event.windowId}\0${event.panelId}`;
}

function grokQuestionRecord(
  id: string,
  pierEvent: "InteractionRequested" | "InteractionResolved",
  outcome?: "completed" | "cancelled"
): TranscriptTerminalRecord {
  return {
    interactionId: id,
    interactionKind: "question",
    nativeEvent:
      pierEvent === "InteractionRequested"
        ? "grok.updates.ask_user_question"
        : "grok.updates.ask_user_question.answered",
    pierEvent,
    turnId: "",
    ...(outcome ? { interactionOutcome: outcome } : {}),
  };
}

export function createGrokTranscriptReconciler(
  opts: GrokTranscriptReconcilerOpts
): GrokTranscriptReconciler {
  const sessionsRoot = resolve(opts.sessionsRoot ?? defaultGrokSessionsRoot());
  const pathCache = new Map<string, string>();
  const questionByPath = new Map<string, { pendingIds: string[] }>();
  const questionByScope = new Map<
    string,
    { emittedIds: Set<string>; path?: string }
  >();

  const pathQuestionState = (path: string): { pendingIds: string[] } => {
    let state = questionByPath.get(path);
    if (!state) {
      state = { pendingIds: [] };
      questionByPath.set(path, state);
    }
    return state;
  };

  const scopeQuestion = (
    key: string
  ): { emittedIds: Set<string>; path?: string } => {
    let scope = questionByScope.get(key);
    if (!scope) {
      scope = { emittedIds: new Set() };
      questionByScope.set(key, scope);
    }
    return scope;
  };

  const dropScopes = (
    match: (windowId: string, panelId: string) => boolean
  ): void => {
    for (const key of [...questionByScope.keys()]) {
      const [windowId, panelId] = key.split("\0");
      if (windowId && panelId && match(windowId, panelId)) {
        questionByScope.delete(key);
      }
    }
  };

  const emit = (event: AgentHookEventPayload): void => {
    const scope = scopeQuestion(grokScopeKey(event));
    if (
      event.event === "InteractionResolved" &&
      "interactionId" in event &&
      event.interactionId
    ) {
      scope.emittedIds.delete(event.interactionId);
      if (scope.path) {
        const state = questionByPath.get(scope.path);
        if (state) {
          state.pendingIds = state.pendingIds.filter(
            (id) => id !== event.interactionId
          );
        }
      }
    }
    if (
      event.event === "InteractionRequested" &&
      "interactionId" in event &&
      event.interactionId
    ) {
      scope.emittedIds.add(event.interactionId);
    }
    opts.onTerminalEvent(event);
  };

  const emitQuestion = (
    context: AgentHookEventPayload,
    record: TranscriptTerminalRecord
  ): void => {
    emitTranscriptEvent(
      {
        contextsByTurnId: new Map(),
        pendingRecords: [],
        seenTerminalEvents: new Set(),
        seenTranscriptEvents: new Set(),
      },
      { ...context, toolName: "ask_user_question" },
      record,
      emit
    );
  };

  const cancelScopeQuestions = (event: AgentHookEventPayload): void => {
    const scope = questionByScope.get(grokScopeKey(event));
    if (!scope || scope.emittedIds.size === 0) {
      return;
    }
    const ids = [...scope.emittedIds];
    scope.emittedIds.clear();
    if (scope.path) {
      const state = questionByPath.get(scope.path);
      if (state) {
        state.pendingIds = state.pendingIds.filter((id) => !ids.includes(id));
      }
    }
    for (const id of ids) {
      emitQuestion(
        event,
        grokQuestionRecord(id, "InteractionResolved", "cancelled")
      );
    }
  };

  const inner = createTranscriptTailReconciler({
    agent: "grok",
    createLineClassifier: (path) => {
      if (!path) {
        return (line) => classifyGrokUpdatesLine(line);
      }
      const state = pathQuestionState(path);
      return (line) => {
        try {
          const question = applyGrokQuestionLine(state, line);
          if (question) {
            return question;
          }
        } catch {
          // 问卷行坏掉时仍尝试终态分类。
        }
        return classifyGrokUpdatesLine(line);
      };
    },
    onTerminalEvent: emit,
    transcriptRoot: sessionsRoot,
  });

  return {
    dispose: () => {
      pathCache.clear();
      questionByPath.clear();
      questionByScope.clear();
      inner.dispose();
    },
    observe: async (event) => {
      if (event.agent !== "grok") {
        return;
      }
      const resolved =
        event.event === "SessionEnd"
          ? event.transcriptPath?.trim() ||
            (await resolveGrokUpdatesPath(event, sessionsRoot, pathCache))
          : await resolveGrokUpdatesPath(event, sessionsRoot, pathCache);
      if (resolved) {
        const scope = scopeQuestion(grokScopeKey(event));
        scope.path = resolved;
        const text = await readUpdatesTail(resolved);
        if (text) {
          const state = pathQuestionState(resolved);
          state.pendingIds = scanGrokQuestionState(text).pendingIds;
          for (const id of state.pendingIds) {
            if (scope.emittedIds.has(id)) {
              continue;
            }
            emitQuestion(
              { ...event, transcriptPath: resolved },
              grokQuestionRecord(id, "InteractionRequested")
            );
          }
        }
        await inner.observe({ ...event, transcriptPath: resolved });
      } else if (event.event === "SessionEnd") {
        await inner.observe(event);
      }
      if (event.event === "SessionEnd" || event.event === "TurnInterrupted") {
        cancelScopeQuestions(event);
      }
    },
    releasePanel: (panelId, windowId) => {
      dropScopes(
        (scopeWindowId, scopePanelId) =>
          scopePanelId === panelId &&
          (windowId === undefined || scopeWindowId === windowId)
      );
      inner.releasePanel(panelId, windowId);
    },
    releasePanelsWhere: (predicate) => {
      dropScopes((windowId, panelId) => predicate(panelId, windowId));
      inner.releasePanelsWhere(predicate);
    },
    releaseWindow: (windowId) => {
      dropScopes((scopeWindowId) => scopeWindowId === windowId);
      inner.releaseWindow(windowId);
    },
    transferPanelOwnership: (input) => {
      const { panelId, sourceWindowId, targetWindowId } = input;
      if (
        panelId.trim().length === 0 ||
        sourceWindowId.trim().length === 0 ||
        targetWindowId.trim().length === 0 ||
        sourceWindowId === targetWindowId
      ) {
        inner.transferPanelOwnership(input);
        return;
      }
      const sourceKey = `${sourceWindowId}\0${panelId}`;
      const targetKey = `${targetWindowId}\0${panelId}`;
      const scope = questionByScope.get(sourceKey);
      if (scope) {
        questionByScope.delete(sourceKey);
        questionByScope.set(targetKey, scope);
      }
      inner.transferPanelOwnership(input);
    },
  };
}

export function defaultGrokSessionsRoot(
  env: NodeJS.ProcessEnv = process.env
): string {
  return resolveGrokSessionsRoot(env);
}

/**
 * 分类 `updates.jsonl` 一行。导出供单测直接覆盖格式契约。
 * `prompt_id` 是原生回合身份（与 hook 侧 `promptId` 同体系）；必须提取为
 * turnId，缺席则丢弃该终态行。空 id 会走 owner 回退，把上一回合终态错锚到新 PromptSubmit。
 */
export function classifyGrokUpdatesLine(
  line: string
): TranscriptTerminalRecord | null {
  // 廉价预筛：updates.jsonl 高频，避免逐行全量 JSON.parse。
  if (!line.includes("turn_completed")) {
    return null;
  }
  const parsed = JSON.parse(line) as {
    method?: unknown;
    params?: {
      update?: {
        prompt_id?: unknown;
        sessionUpdate?: unknown;
        stop_reason?: unknown;
      };
    };
  };
  const method = parsed.method;
  if (method !== "session/update" && method !== "_x.ai/session/update") {
    return null;
  }
  const update = parsed.params?.update;
  if (update?.sessionUpdate !== "turn_completed") {
    return null;
  }
  const turnId =
    typeof update.prompt_id === "string" ? update.prompt_id.trim() : "";
  if (!turnId) {
    return null;
  }
  const reason = update.stop_reason;
  if (reason === "cancelled") {
    return {
      ...GROK_TRANSCRIPT_TERMINAL_EVIDENCE[0],
      turnId,
    };
  }
  if (reason === "end_turn") {
    return {
      ...GROK_TRANSCRIPT_TERMINAL_EVIDENCE[1],
      turnId,
    };
  }
  return null;
}

async function readUpdatesTail(path: string): Promise<string | null> {
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat?.isFile()) {
    return null;
  }
  const start = Math.max(0, fileStat.size - 1024 * 1024);
  const fd = await open(path, "r");
  try {
    const length = fileStat.size - start;
    const buffer = Buffer.alloc(length);
    const result = await fd.read(buffer, 0, length, start);
    return buffer.subarray(0, result.bytesRead).toString("utf8");
  } finally {
    await fd.close();
  }
}

async function resolveGrokUpdatesPath(
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
    const cachedStat = await stat(cached).catch(() => null);
    if (cachedStat?.isFile()) {
      return cached;
    }
    cache.delete(sessionId);
  }
  const resolved = await findUpdatesJsonlForSession(sessionsRoot, sessionId);
  // SessionStart 先于 updates.jsonl 创建是正常竞态；只缓存成功路径，
  // 让后续 observe 能重新扫描。已缓存路径也会在上方失效后重找。
  if (resolved) {
    cache.set(sessionId, resolved);
    if (cache.size > 256) {
      const first = cache.keys().next().value;
      if (first !== undefined) {
        cache.delete(first);
      }
    }
  }
  return resolved;
}

/** `sessions/<cwd-enc>/<sessionId>/updates.jsonl` 一层 cwd 编码扫描。 */
export async function findUpdatesJsonlForSession(
  sessionsRoot: string,
  sessionId: string
): Promise<string | null> {
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(
    () => null
  );
  if (!entries) {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = join(
      sessionsRoot,
      entry.name,
      sessionId,
      "updates.jsonl"
    );
    try {
      const st = await stat(candidate);
      if (st.isFile()) {
        return candidate;
      }
    } catch {
      // 继续扫其它 cwd 编码目录
    }
  }
  return null;
}
