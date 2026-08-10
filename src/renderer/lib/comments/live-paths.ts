import type { GitChangeEvent, GitStatus } from "@shared/contracts/git.ts";
import { useEffect, useState } from "react";

/**
 * 未提交变更面上「仍有 diff 的路径」集合。
 * 含 path + origPath（重命名两侧），供评论可处理过滤。
 */
export function livePathsFromGitStatus(status: GitStatus): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const file of status.files) {
    paths.add(file.path);
    if (file.origPath !== null && file.origPath.length > 0) {
      paths.add(file.origPath);
    }
  }
  return paths;
}

type PathsListener = (paths: ReadonlySet<string> | null) => void;

/**
 * 同 gitRoot 多消费者（状态栏 + 评论弹窗）共享一份 watch，
 * 对齐 status-state：优先 event.status，缺省再 getStatus。
 */
interface LivePathsSession {
  generation: number;
  gitRoot: string;
  listeners: Set<PathsListener>;
  paths: ReadonlySet<string> | null;
  unsubscribeWatch: () => void;
}

const sessions = new Map<string, LivePathsSession>();

function notify(session: LivePathsSession): void {
  for (const listener of session.listeners) {
    listener(session.paths);
  }
}

function applyPaths(
  session: LivePathsSession,
  paths: ReadonlySet<string> | null
): void {
  session.paths = paths;
  notify(session);
}

function refetchStatus(session: LivePathsSession): void {
  const gen = ++session.generation;
  window.pier.git
    .getStatus(session.gitRoot)
    .then((status) => {
      if (gen !== session.generation) {
        return;
      }
      applyPaths(session, livePathsFromGitStatus(status));
    })
    .catch(() => {
      if (gen !== session.generation) {
        return;
      }
      // 失败时作废已知集合：避免 commit 后 getStatus 失败仍保留脏路径集合。
      applyPaths(session, null);
    });
}

function onWatchEvent(session: LivePathsSession, event: GitChangeEvent): void {
  if (event.status !== undefined) {
    // 广播带 status：作废 in-flight getStatus，直接应用快照（与 status-state 同构）。
    session.generation += 1;
    applyPaths(session, livePathsFromGitStatus(event.status));
    return;
  }
  refetchStatus(session);
}

function acquireSession(gitRoot: string): LivePathsSession {
  const existing = sessions.get(gitRoot);
  if (existing !== undefined) {
    return existing;
  }
  const session: LivePathsSession = {
    generation: 0,
    gitRoot,
    listeners: new Set(),
    paths: null,
    unsubscribeWatch: () => undefined,
  };
  sessions.set(gitRoot, session);
  session.unsubscribeWatch = window.pier.git.watch(gitRoot, (event) => {
    onWatchEvent(session, event);
  });
  refetchStatus(session);
  return session;
}

function releaseSession(
  session: LivePathsSession,
  listener: PathsListener
): void {
  session.listeners.delete(listener);
  if (session.listeners.size > 0) {
    return;
  }
  session.unsubscribeWatch();
  session.generation += 1;
  sessions.delete(session.gitRoot);
}

/**
 * 订阅 gitRoot 工作区状态，得到当前未提交变更路径。
 * - `null`：尚未拿到首包，或刷新失败——调用方应暂缓展示可处理评论 / 不 prune。
 * - 空 Set：工作区干净，无变更路径。
 */
export function useUncommittedLivePaths(
  gitRoot: string | null | undefined
): ReadonlySet<string> | null {
  const [paths, setPaths] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (gitRoot === null || gitRoot === undefined || gitRoot.length === 0) {
      setPaths(null);
      return;
    }
    const session = acquireSession(gitRoot);
    setPaths(session.paths);
    const listener: PathsListener = (next) => {
      setPaths(next);
    };
    session.listeners.add(listener);
    return () => {
      releaseSession(session, listener);
    };
  }, [gitRoot]);

  return paths;
}

/** 测试用：清空共享 session 表。 */
export function resetLivePathsSessionsForTests(): void {
  for (const session of sessions.values()) {
    session.unsubscribeWatch();
    session.generation += 1;
  }
  sessions.clear();
}
