import type {
  CommentProjectSnapshot,
  CommentReadState,
  CommentThread,
} from "@shared/contracts/comments/index.ts";
import { create } from "zustand";

interface CommentsProjectState {
  readState: CommentReadState;
  /** main 侧 per-worktree seq；单调守卫拒收乱序广播。 */
  seq: number;
  threads: CommentThread[];
}

interface CommentsState {
  /** 应用 main 广播快照（seq 单调守卫）。空 threads + seq 递增 = 项目清空。 */
  apply: (snapshot: CommentProjectSnapshot) => void;
  /** 主动清除项目（删 worktree 后调用方触发）。 */
  clearProject: (worktreeKey: string) => void;
  /** 标记项目已水合（首拉失败时兜底空快照，避免重复拉）。 */
  markHydrated: (worktreeKey: string) => void;
  /** per-worktree 项目镜像。worktreeKey → state。 */
  projects: Record<string, CommentsProjectState>;
}

/**
 * 评论镜像 store — main CommentsService 快照的 renderer 副本。
 *
 * - 写入方：CommentsBridge（initComments 订阅广播 + ensureCommentsLoaded 首拉）。
 * - 读取方：终端状态栏评论项（未解决数 + 未读高亮）、git 插件 diff 评论 UI。
 * - per-worktree seq 单调守卫（对齐 notification-center.store 的 seq 守卫）。
 * - 水合标记用空快照 seq=0 落地（首拉失败也标记，防重试风暴）。
 */
export const useCommentsStore = create<CommentsState>((set, get) => ({
  projects: {},
  apply: (snapshot) => {
    const existing = get().projects[snapshot.worktreeKey];
    if (existing && snapshot.seq < existing.seq) {
      return;
    }
    set((state) => ({
      projects: {
        ...state.projects,
        [snapshot.worktreeKey]: {
          readState: snapshot.readState,
          seq: snapshot.seq,
          threads: snapshot.threads,
        },
      },
    }));
  },
  clearProject: (worktreeKey) => {
    set((state) => {
      if (!(worktreeKey in state.projects)) {
        return state;
      }
      const next = { ...state.projects };
      delete next[worktreeKey];
      return { projects: next };
    });
  },
  markHydrated: (worktreeKey) => {
    set((state) => {
      const existing = state.projects[worktreeKey];
      if (existing) {
        return state;
      }
      return {
        projects: {
          ...state.projects,
          [worktreeKey]: { readState: { lastReadAt: 0 }, seq: 0, threads: [] },
        },
      };
    });
  },
}));

/** 首拉中 promise 缓存（防并发首拉同一 worktree）。 */
const loadingPromises = new Map<string, Promise<void>>();

/**
 * 订阅 main 广播 + 返回 detach（bridge unmount 时调用）。
 * 首拉由 ensureCommentsLoaded 按需触发（首次打开该 worktree 的评论 UI 时）。
 */
export function initComments(): () => void {
  const api = window.pier.comments;
  return api.onChanged((snapshot) => {
    useCommentsStore.getState().apply(snapshot);
  });
}

/**
 * 首拉项目快照（按需水合）。已水合或正在拉则 no-op/复用。
 * 失败时兜底空快照（markHydrated），避免后续每次访问都重试。
 */
export async function ensureCommentsLoaded(worktreeKey: string): Promise<void> {
  if (worktreeKey in useCommentsStore.getState().projects) {
    return;
  }
  const existing = loadingPromises.get(worktreeKey);
  if (existing) {
    return existing;
  }
  const promise = window.pier.comments
    .ensureLoaded(worktreeKey)
    .then((snapshot) => {
      useCommentsStore.getState().apply(snapshot);
    })
    .catch(() => {
      useCommentsStore.getState().markHydrated(worktreeKey);
    })
    .finally(() => {
      loadingPromises.delete(worktreeKey);
    });
  loadingPromises.set(worktreeKey, promise);
  return promise;
}

/** 评论线程数（v1 瘦身：无 resolved 过滤，全部计入）。 */
export function threadCount(project: CommentsProjectState | undefined): number {
  if (!project) {
    return 0;
  }
  return project.threads.length;
}

/** 未读高亮：有线程 updatedAt 晚于 lastReadAt。 */
export function hasUnreadComments(
  project: CommentsProjectState | undefined
): boolean {
  if (!project) {
    return false;
  }
  return project.threads.some(
    (thread) => thread.updatedAt > project.readState.lastReadAt
  );
}
