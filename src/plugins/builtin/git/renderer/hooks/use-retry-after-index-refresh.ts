import { type RefObject, useEffect, useRef } from "react";
import type { GitReviewDocumentLoader } from "../review/document/loader.ts";

/**
 * Toolbar refresh only reloads the index. When the index revision is unchanged,
 * document generation does not remount — retry timed-out bodies ourselves.
 */
export function useRetryDocumentsAfterIndexRefresh({
  indexRefreshing,
  loaderRef,
}: {
  readonly indexRefreshing: boolean;
  readonly loaderRef: RefObject<Pick<
    GitReviewDocumentLoader,
    "retryRetryableFailures"
  > | null>;
}): void {
  const wasRefreshingRef = useRef(false);
  useEffect(() => {
    const wasRefreshing = wasRefreshingRef.current;
    wasRefreshingRef.current = indexRefreshing;
    if (wasRefreshing && !indexRefreshing) {
      loaderRef.current?.retryRetryableFailures();
    }
  }, [indexRefreshing, loaderRef]);
}
