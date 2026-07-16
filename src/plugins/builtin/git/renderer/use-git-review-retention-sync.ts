import { type RefObject, useCallback, useRef } from "react";
import type { GitReviewDocumentGeneration } from "./git-review-document-generation.ts";
import type { GitReviewDocumentLoader } from "./git-review-document-loader.ts";

interface PendingRetentionSync {
  readonly controller: GitReviewDocumentGeneration;
  readonly generation: number;
  readonly loader: GitReviewDocumentLoader;
}

/** 合并同一微任务内的正文结算，避免 previous 占用变化递归触发 loader。 */
export function useGitReviewRetentionSync({
  controllerRef,
  documentGenerationRef,
  loaderRef,
}: {
  readonly controllerRef: RefObject<GitReviewDocumentGeneration | null>;
  readonly documentGenerationRef: RefObject<number>;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
}): {
  readonly cancelRetentionSync: (
    controller: GitReviewDocumentGeneration
  ) => void;
  readonly syncRetentionLimits: () => void;
} {
  const pendingRef = useRef<PendingRetentionSync | null>(null);
  const scheduledRef = useRef(false);

  const syncRetentionLimits = useCallback(() => {
    const controller = controllerRef.current;
    const loader = loaderRef.current;
    if (!(controller && loader)) {
      return;
    }
    pendingRef.current = {
      controller,
      generation: documentGenerationRef.current,
      loader,
    };
    if (scheduledRef.current) {
      return;
    }
    scheduledRef.current = true;
    queueMicrotask(() => {
      scheduledRef.current = false;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (
        !pending ||
        pending.controller !== controllerRef.current ||
        pending.loader !== loaderRef.current ||
        pending.generation !== documentGenerationRef.current
      ) {
        return;
      }
      pending.loader.setRetentionLimits(pending.controller.retentionLimits());
    });
  }, [controllerRef, documentGenerationRef, loaderRef]);

  const cancelRetentionSync = useCallback(
    (controller: GitReviewDocumentGeneration) => {
      if (pendingRef.current?.controller === controller) {
        pendingRef.current = null;
      }
    },
    []
  );

  return { cancelRetentionSync, syncRetentionLimits };
}
