import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitStatus } from "@shared/contracts/git.ts";
import { useEffect, useState } from "react";

const RETRY_DELAYS_MS = [250, 1000, 4000] as const;

export type GitStatusLoadState =
  | { kind: "error"; retry: () => void }
  | { kind: "loaded"; status: GitStatus }
  | { kind: "loading" };

const LOADING_STATE: GitStatusLoadState = { kind: "loading" };

type SessionListener = () => void;
type GitApi = RendererPluginContext["git"];

interface GitStatusSession {
  /** 可变：同 gitRoot 后续 acquirer 可刷新，避免钉死首次 context。 */
  git: GitApi;
  listeners: Set<SessionListener>;
  refCount: number;
  sequence: number;
  state: GitStatusLoadState;
  statusRetryIndex: number;
  statusRetryTimer: null | ReturnType<typeof setTimeout>;
  unsubscribeWatch: () => void;
  watchAttempt: number;
  watchReady: boolean;
  watchRetryIndex: number;
  watchRetryTimer: null | ReturnType<typeof setTimeout>;
}

/** 同一 gitRoot 多状态栏项共享一份 watch，避免拆项后重复订阅。 */
const sessions = new Map<string, GitStatusSession>();

function clearTimer(timer: null | ReturnType<typeof setTimeout>): null {
  if (timer !== null) {
    clearTimeout(timer);
  }
  return null;
}

function notify(session: GitStatusSession): void {
  for (const listener of session.listeners) {
    listener();
  }
}

function setSessionState(
  session: GitStatusSession,
  state: GitStatusLoadState
): void {
  session.state = state;
  notify(session);
}

function createSession(git: GitApi, root: string): GitStatusSession {
  const session: GitStatusSession = {
    git,
    listeners: new Set(),
    refCount: 0,
    sequence: 0,
    state: LOADING_STATE,
    statusRetryIndex: 0,
    statusRetryTimer: null,
    unsubscribeWatch: () => undefined,
    watchAttempt: 0,
    watchReady: false,
    watchRetryIndex: 0,
    watchRetryTimer: null,
  };

  function retry(): void {
    session.statusRetryIndex = 0;
    session.statusRetryTimer = clearTimer(session.statusRetryTimer);
    session.watchRetryIndex = 0;
    session.watchRetryTimer = clearTimer(session.watchRetryTimer);
    setSessionState(session, LOADING_STATE);
    startWatch();
  }

  function apply(next: GitStatus): void {
    session.statusRetryIndex = 0;
    session.statusRetryTimer = clearTimer(session.statusRetryTimer);
    setSessionState(
      session,
      session.watchReady
        ? { kind: "loaded", status: next }
        : { kind: "error", retry }
    );
  }

  function scheduleStatusRetry(): void {
    const delay = RETRY_DELAYS_MS[session.statusRetryIndex];
    if (delay === undefined || session.statusRetryTimer !== null) {
      return;
    }
    session.statusRetryIndex += 1;
    session.statusRetryTimer = setTimeout(() => {
      session.statusRetryTimer = null;
      refetch();
    }, delay);
  }

  function refetch(): void {
    const request = ++session.sequence;
    session.git.getStatus(root).then(
      (next) => {
        if (request === session.sequence) {
          apply(next);
        }
      },
      () => {
        if (request === session.sequence) {
          setSessionState(session, { kind: "error", retry });
          scheduleStatusRetry();
        }
      }
    );
  }

  function scheduleWatchRetry(): void {
    const delay = RETRY_DELAYS_MS[session.watchRetryIndex];
    if (delay === undefined || session.watchRetryTimer !== null) {
      return;
    }
    session.watchRetryIndex += 1;
    session.watchRetryTimer = setTimeout(() => {
      session.watchRetryTimer = null;
      startWatch();
    }, delay);
  }

  function startWatch(): void {
    session.unsubscribeWatch();
    session.unsubscribeWatch = () => undefined;
    const attempt = ++session.watchAttempt;
    session.watchReady = true;
    let failedSynchronously = false;
    try {
      const unsubscribe = session.git.watch(
        root,
        (event) => {
          if (attempt !== session.watchAttempt) {
            return;
          }
          session.watchReady = true;
          session.watchRetryIndex = 0;
          session.watchRetryTimer = clearTimer(session.watchRetryTimer);
          if (event.status) {
            session.sequence += 1;
            apply(event.status);
          } else {
            refetch();
          }
        },
        () => {
          if (attempt !== session.watchAttempt) {
            return;
          }
          failedSynchronously = true;
          session.watchReady = false;
          session.unsubscribeWatch();
          session.unsubscribeWatch = () => undefined;
          setSessionState(session, { kind: "error", retry });
          scheduleWatchRetry();
        }
      );
      if (failedSynchronously) {
        unsubscribe();
        return;
      }
      session.unsubscribeWatch = unsubscribe;
    } catch {
      session.watchReady = false;
      setSessionState(session, { kind: "error", retry });
      scheduleWatchRetry();
      return;
    }
    refetch();
  }

  setSessionState(session, LOADING_STATE);
  startWatch();
  return session;
}

function acquireSession(
  context: RendererPluginContext,
  root: string
): GitStatusSession {
  let session = sessions.get(root);
  if (session) {
    // 同 root 复用 session 时刷新 git API，避免钉死首次 context 闭包。
    session.git = context.git;
  } else {
    session = createSession(context.git, root);
    sessions.set(root, session);
  }
  session.refCount += 1;
  return session;
}

function releaseSession(root: string, session: GitStatusSession): void {
  session.refCount -= 1;
  if (session.refCount > 0) {
    return;
  }
  session.sequence += 1;
  session.statusRetryTimer = clearTimer(session.statusRetryTimer);
  session.watchRetryTimer = clearTimer(session.watchRetryTimer);
  session.unsubscribeWatch();
  sessions.delete(root);
}

/**
 * 分支 / 更改 / 同步状态栏项共用。同一 gitRoot 只建一条 watch。
 */
export function useGitStatus(
  context: RendererPluginContext,
  gitRoot: null | string | undefined
): GitStatusLoadState {
  const [state, setState] = useState<GitStatusLoadState>(LOADING_STATE);

  useEffect(() => {
    if (!gitRoot) {
      setState(LOADING_STATE);
      return;
    }
    const root = gitRoot;
    const session = acquireSession(context, root);
    const onChange = (): void => {
      setState(session.state);
    };
    onChange();
    session.listeners.add(onChange);
    return () => {
      session.listeners.delete(onChange);
      releaseSession(root, session);
    };
  }, [context, gitRoot]);

  return state;
}

/** 单测用：清空会话表。 */
export function resetGitStatusSessionsForTests(): void {
  for (const [root, session] of sessions) {
    session.sequence += 1;
    session.statusRetryTimer = clearTimer(session.statusRetryTimer);
    session.watchRetryTimer = clearTimer(session.watchRetryTimer);
    session.unsubscribeWatch();
    sessions.delete(root);
  }
}
