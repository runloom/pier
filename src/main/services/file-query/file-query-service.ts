/**
 * In-process file path query service.
 *
 * Owns walk lifecycle, per-owner cancellation, and result streaming to a
 * caller-supplied `emit` callback. IPC glue lives elsewhere (task 3).
 *
 * Session key: `${senderId}\0${owner}` — starting a new query under the same
 * key aborts the previous one and its terminal `done` event is emitted with
 * `reason: "cancelled"`. No `batch` is ever emitted after `done`.
 *
 * Design: docs/superpowers/specs/2026-07-17-files-path-query-and-quick-open-design.md §4.2
 */

import type {
  FilePathQueryStart,
  FileQueryEvent,
} from "@shared/contracts/file-query.ts";
import { FILES_TREE_DEFAULT_EXCLUDE_PATTERNS } from "@shared/contracts/files-tree-exclude.ts";
import { selectTopFilePaths } from "./path-score.ts";
import {
  AbortedWalkError,
  FILE_WALK_MAX_SCANNED,
  walkFiles,
} from "./path-walk.ts";

export type FileQueryEmit = (event: FileQueryEvent) => void;

/** Async lister for git-ignored paths — matches `GitService.listIgnored`. */
export type ListIgnored = (
  cwd: string,
  signal: AbortSignal
) => Promise<readonly string[]>;

export interface FileQueryServiceOptions {
  /** Override the default exclude glob source (merged, not replaced). */
  readonly defaultExcludePatterns?: string | undefined;
  /** Optional git-ignore lister; when omitted, `applyGitIgnore` is a no-op. */
  readonly listIgnored?: ListIgnored | undefined;
  /** Override walk cap (tests). */
  readonly maxScanned?: number | undefined;
}

export interface FileQueryService {
  cancel(senderId: number, queryId: string): void;
  cancelAll(senderId: number): void;
  start(
    senderId: number,
    request: FilePathQueryStart,
    emit: FileQueryEmit
  ): void;
}

interface ActiveSession {
  readonly controller: AbortController;
  emit: FileQueryEmit | null;
  readonly owner: string;
  readonly queryId: string;
}

function sessionKey(senderId: number, owner: string): string {
  return `${senderId}\u0000${owner}`;
}

export function createFileQueryService(
  options: FileQueryServiceOptions
): FileQueryService {
  const defaultExcludes =
    options.defaultExcludePatterns ?? FILES_TREE_DEFAULT_EXCLUDE_PATTERNS;
  const maxScanned = options.maxScanned ?? FILE_WALK_MAX_SCANNED;
  const listIgnored = options.listIgnored;

  const sessions = new Map<string, ActiveSession>();
  const byQueryId = new Map<string, string>();

  const abortSession = (key: string, session: ActiveSession): void => {
    // Detach emit BEFORE aborting so the losing walk can never publish another
    // batch — the terminal `done { cancelled }` is emitted here, once.
    const emit = session.emit;
    session.emit = null;
    sessions.delete(key);
    byQueryId.delete(session.queryId);
    session.controller.abort();
    if (emit) {
      emit({
        kind: "done",
        queryId: session.queryId,
        reason: "cancelled",
        truncated: false,
        scanned: 0,
        elapsedMs: 0,
      });
    }
  };

  const start = (
    senderId: number,
    request: FilePathQueryStart,
    emit: FileQueryEmit
  ): void => {
    const key = sessionKey(senderId, request.owner);
    const previous = sessions.get(key);
    if (previous) abortSession(key, previous);

    const controller = new AbortController();
    const session: ActiveSession = {
      queryId: request.queryId,
      owner: request.owner,
      controller,
      emit,
    };
    sessions.set(key, session);
    byQueryId.set(request.queryId, key);

    emit({ kind: "started", queryId: request.queryId });

    const excludePatternSource = resolveExcludePatterns(
      defaultExcludes,
      request.options
    );
    const applyGitIgnore = request.options?.applyGitIgnore ?? true;

    runQuery({
      request,
      session,
      excludePatternSource,
      applyGitIgnore,
      listIgnored,
      maxScanned,
      onFinished: () => {
        // Only clear if this session is still current — a subsequent start
        // under the same key has already replaced it.
        if (sessions.get(key) === session) {
          sessions.delete(key);
          byQueryId.delete(session.queryId);
        }
      },
    }).catch(() => undefined); // runQuery owns its own errors; never rejects
  };

  const cancel = (senderId: number, queryId: string): void => {
    const key = byQueryId.get(queryId);
    if (!key) return;
    const session = sessions.get(key);
    if (!session || session.queryId !== queryId) return;
    // Must belong to the same sender.
    if (!key.startsWith(`${senderId}\u0000`)) return;
    abortSession(key, session);
  };

  const cancelAll = (senderId: number): void => {
    const prefix = `${senderId}\u0000`;
    for (const [key, session] of sessions) {
      if (key.startsWith(prefix)) abortSession(key, session);
    }
  };

  return { start, cancel, cancelAll };
}

function resolveExcludePatterns(
  defaults: string,
  options: FilePathQueryStart["options"]
): string {
  const applyExcludes = options?.applyExcludePatterns ?? true;
  if (!applyExcludes) return "";
  // When the client supplies excludePatterns (tree setting), treat it as the
  // full source so a user who deleted a default does not get it re-merged.
  if (options?.excludePatterns !== undefined) {
    return options.excludePatterns;
  }
  return defaults;
}

interface RunQueryArgs {
  readonly applyGitIgnore: boolean;
  readonly excludePatternSource: string;
  readonly listIgnored: ListIgnored | undefined;
  readonly maxScanned: number;
  readonly onFinished: () => void;
  readonly request: FilePathQueryStart;
  readonly session: ActiveSession;
}

async function runQuery(args: RunQueryArgs): Promise<void> {
  const { request, session, listIgnored, applyGitIgnore, maxScanned } = args;
  const started = performance.now();
  const signal = session.controller.signal;

  try {
    let ignoredPaths: ReadonlySet<string> | undefined;
    if (applyGitIgnore && listIgnored) {
      try {
        const list = await listIgnored(request.root, signal);
        if (signal.aborted) return; // done already emitted by abortSession
        ignoredPaths = new Set(list);
      } catch {
        // git unavailable → proceed without ignore, per brief §4.2
      }
    }

    const walk = await walkFiles({
      root: request.root,
      excludePatternSource: args.excludePatternSource,
      ignoredPaths,
      maxScanned,
      signal,
    });

    if (session.emit === null || signal.aborted) return;

    const ranked = selectTopFilePaths(
      walk.paths,
      request.query,
      request.mruPaths ?? [],
      request.limit
    );

    session.emit({
      kind: "batch",
      queryId: request.queryId,
      items: ranked.map(({ path, score }) => ({ path, score })),
    });
    session.emit({
      kind: "done",
      queryId: request.queryId,
      reason: "completed",
      truncated: walk.truncated,
      scanned: walk.scanned,
      elapsedMs: Math.max(0, performance.now() - started),
    });
    // Prevent any later stray emit (defensive; runQuery only reaches here once).
    session.emit = null;
  } catch (error) {
    if (error instanceof AbortedWalkError) return; // done already emitted
    const emit = session.emit;
    session.emit = null;
    if (emit) {
      emit({
        kind: "error",
        queryId: request.queryId,
        code: "walk-failed",
        message: error instanceof Error ? error.message : String(error),
      });
      emit({
        kind: "done",
        queryId: request.queryId,
        reason: "completed",
        truncated: false,
        scanned: 0,
        elapsedMs: Math.max(0, performance.now() - started),
      });
    }
  } finally {
    args.onFinished();
  }
}
