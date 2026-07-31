import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { resolveGrokSessionsRoot } from "../../grok-paths.ts";
import {
  createTranscriptTailReconciler,
  type TranscriptTailReconciler,
  type TranscriptTerminalRecord,
} from "./tail-reconciler.ts";

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
 * 只补终态，不投影 tool / waiting / 内容。
 */
export function createGrokTranscriptReconciler(
  opts: GrokTranscriptReconcilerOpts
): GrokTranscriptReconciler {
  const sessionsRoot = resolve(opts.sessionsRoot ?? defaultGrokSessionsRoot());
  const pathCache = new Map<string, string>();
  const inner = createTranscriptTailReconciler({
    agent: "grok",
    classifyLine: classifyGrokUpdatesLine,
    onTerminalEvent: opts.onTerminalEvent,
    transcriptRoot: sessionsRoot,
  });

  return {
    dispose: () => {
      pathCache.clear();
      inner.dispose();
    },
    observe: async (event) => {
      if (event.agent !== "grok") {
        return;
      }
      if (event.event === "SessionEnd") {
        await inner.observe(event);
        return;
      }
      const resolved = await resolveGrokUpdatesPath(
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

export function defaultGrokSessionsRoot(
  env: NodeJS.ProcessEnv = process.env
): string {
  return resolveGrokSessionsRoot(env);
}

/**
 * 分类 `updates.jsonl` 一行。导出供单测直接覆盖格式契约。
 * turnId 留空：hook 侧常缺 turn 身份，走单 owner + 增量区间回退（对齐 Claude）。
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
  const reason = update.stop_reason;
  if (reason === "cancelled") {
    return {
      ...GROK_TRANSCRIPT_TERMINAL_EVIDENCE[0],
      turnId: "",
    };
  }
  if (reason === "end_turn") {
    return {
      ...GROK_TRANSCRIPT_TERMINAL_EVIDENCE[1],
      turnId: "",
    };
  }
  return null;
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
