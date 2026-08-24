import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewIndexEntry,
  GitReviewMutationOk,
  GitReviewScope,
} from "@shared/contracts/git/review.ts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { preloadReviewCodeView } from "../review/code-view.tsx";
import {
  GitReviewIndexLoader,
  type GitReviewIndexLoaderSnapshot,
} from "../review/index-loader.ts";
import type { GitReviewMutationAuthority } from "../review/mutation-authority.ts";
import {
  patchReviewSession,
  readReviewSession,
} from "../review/session-cache.ts";

const EMPTY_REVIEW_ENTRIES: readonly GitReviewIndexEntry[] = [];

interface BoundIndexState {
  readonly snapshot: GitReviewIndexLoaderSnapshot;
  readonly sourceKey: string | null;
}

/** 来源绑定的 index loader、会话保留快照和 mutation 等待队列；面板主体只负责状态呈现。 */
export function useGitChangesPanelIndexState({
  authority,
  context,
  source,
  sourceKey,
}: {
  readonly authority: GitReviewMutationAuthority;
  readonly context: RendererPluginContext;
  readonly source: GitReviewScope | null;
  readonly sourceKey: string | null;
}) {
  const indexLoaderRef = useRef<GitReviewIndexLoader | null>(null);
  const activeSourceKeyRef = useRef(sourceKey);
  activeSourceKeyRef.current = sourceKey;
  const subscribeMutationAuthority = useCallback(
    (listener: () => void) => authority.subscribe(source, listener),
    [authority, source]
  );
  const readMutationAuthority = useCallback(
    () => authority.blocked(source),
    [authority, source]
  );
  const mutationAuthorityBlocked = useSyncExternalStore(
    subscribeMutationAuthority,
    readMutationAuthority,
    () => false
  );
  const acquireMutationAuthority = useCallback((): boolean => {
    if (!(source && activeSourceKeyRef.current === sourceKey)) {
      return false;
    }
    return authority.acquire(source);
  }, [authority, source, sourceKey]);
  const waitForAuthoritativeIndex = useCallback(
    async (_result: GitReviewMutationOk | null) => {
      // mutation ack 只确认写入。显式无防抖读取是提交屏障；watch 仅负责
      // 合并外部 git 变化，不能决定用户操作何时结束。
      if (!(source && activeSourceKeyRef.current === sourceKey)) {
        return;
      }
      await authority.refreshAndRelease(source);
    },
    [authority, source, sourceKey]
  );
  const [boundState, setBoundState] = useState<BoundIndexState>(() => {
    if (!sourceKey) {
      return { snapshot: { kind: "loading" }, sourceKey };
    }
    const session = readReviewSession(sourceKey);
    return {
      snapshot: session?.index ?? { kind: "loading" },
      sourceKey,
    };
  });
  const state = ((): GitReviewIndexLoaderSnapshot => {
    if (boundState.sourceKey === sourceKey) {
      if (boundState.snapshot.kind !== "loading") {
        return boundState.snapshot;
      }
      if (sourceKey) {
        return readReviewSession(sourceKey)?.index ?? boundState.snapshot;
      }
      return boundState.snapshot;
    }
    if (!sourceKey) {
      return { kind: "loading" };
    }
    return readReviewSession(sourceKey)?.index ?? { kind: "loading" };
  })();
  const entries =
    state.kind === "loaded" ? state.result.entries : EMPTY_REVIEW_ENTRIES;
  // index loader 只随 source 重建。
  useEffect(() => {
    if (!source) {
      return;
    }
    preloadReviewCodeView();
    const loader = new GitReviewIndexLoader({
      cancel: (operationId) => context.git.cancelReviewRequest({ operationId }),
      load: (operationId) =>
        context.git.getReviewIndex({ operationId, source }),
      watch: (listener, onStartFailure, onReady) =>
        context.git.watch(
          source.gitRootPath,
          listener,
          onStartFailure,
          onReady
        ),
    });
    indexLoaderRef.current = loader;
    const unregisterRefresher = authority.registerRefresher(source, () =>
      loader.refreshNow()
    );
    const sync = () => {
      const snapshot = loader.getSnapshot();
      if (snapshot.kind === "loaded" && sourceKey) {
        patchReviewSession(sourceKey, { index: snapshot });
      }
      setBoundState((previous) => {
        if (snapshot.kind === "loading") {
          let retained: GitReviewIndexLoaderSnapshot | null = null;
          if (
            previous.sourceKey === sourceKey &&
            previous.snapshot.kind === "loaded"
          ) {
            retained = previous.snapshot;
          } else if (sourceKey) {
            retained = readReviewSession(sourceKey)?.index ?? null;
          }
          if (retained) {
            return { snapshot: retained, sourceKey };
          }
        }
        return { snapshot, sourceKey };
      });
    };
    const unsubscribe = loader.subscribe(sync);
    sync();
    return () => {
      const finalSnapshot = loader.getSnapshot();
      if (finalSnapshot.kind === "loaded" && sourceKey) {
        patchReviewSession(sourceKey, { index: finalSnapshot });
      }
      unsubscribe();
      unregisterRefresher();
      loader.dispose();
      if (indexLoaderRef.current === loader) {
        indexLoaderRef.current = null;
      }
    };
  }, [authority, context, source, sourceKey]);

  const retryIndex = useCallback(() => {
    indexLoaderRef.current?.retry();
  }, []);

  return {
    entries,
    acquireMutationAuthority,
    mutationAuthorityBlocked,
    retryIndex,
    state,
    waitForAuthoritativeIndex,
  };
}
