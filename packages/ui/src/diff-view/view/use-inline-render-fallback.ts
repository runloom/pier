import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PierDiffViewItem } from "../items.ts";
import { allowInlineDiffFallback } from "./inline-fallback.ts";

const INLINE_RENDER_TIMEOUT_MS = 10_000;
/** Large reviews keep the worker longer; they must not fall back inline. */
const LARGE_REVIEW_RENDER_TIMEOUT_MS = 30_000;

export type InlineRenderMode = "inline" | "worker";

export interface InlineRenderFallbackState {
  disableWorkerPool: (reason: string) => void;
  inlineFallbackSafe: boolean;
  inlineRenderFailed: boolean;
  renderMode: InlineRenderMode;
  setInlineRenderFailed: (value: boolean) => void;
}

/**
 * Owns the worker → inline decision. The inline fallback is only safe for a
 * small view; large reviews keep the worker and surface a retry error.
 */
export function useInlineRenderFallbackState(input: {
  inputs: readonly PierDiffViewItem[];
  onError: (error: Error) => void;
}): InlineRenderFallbackState {
  const { inputs, onError } = input;
  const [inlineRenderFailed, setInlineRenderFailed] = useState(false);
  const [workerUnavailable, setWorkerUnavailable] = useState(false);
  const inlineFallbackSafe = useMemo(
    () => allowInlineDiffFallback(inputs),
    [inputs]
  );
  const disableWorkerPool = useCallback(
    (reason: string) => {
      if (!inlineFallbackSafe) {
        setInlineRenderFailed(true);
        onError(
          new Error(
            `Diff renderer unavailable (${reason}); inline fallback was skipped for this large review. Retry to render with the worker.`
          )
        );
        return;
      }
      setWorkerUnavailable(true);
    },
    [inlineFallbackSafe, onError]
  );
  const renderMode: InlineRenderMode =
    workerUnavailable && inlineFallbackSafe ? "inline" : "worker";
  // Patches hydrate after the first render. If the view grew past the inline
  // budget, never keep it on the main thread; re-arm the worker path.
  useEffect(() => {
    if (workerUnavailable && !inlineFallbackSafe) {
      setWorkerUnavailable(false);
    }
  }, [inlineFallbackSafe, workerUnavailable]);
  // A large review that errored into the failed empty state must render again
  // when the view changes to a different item set. Tracked via a ref compare
  // so a watchdog failure does not reset itself within the same view.
  const lastInputsRef = useRef(inputs);
  useEffect(() => {
    if (lastInputsRef.current !== inputs) {
      lastInputsRef.current = inputs;
      setInlineRenderFailed(false);
    }
  }, [inputs]);
  return {
    disableWorkerPool,
    inlineFallbackSafe,
    inlineRenderFailed,
    renderMode,
    setInlineRenderFailed,
  };
}

/** Worker render watchdog: long reviews get a longer grace period. */
export function useInlineRenderFallbackTimeout(input: {
  disableWorkerPool: (reason: string) => void;
  inlineFallbackSafe: boolean;
  onError: (error: Error) => void;
  pendingRenderKey: string | null;
  renderItemCount: number;
  renderMode: InlineRenderMode;
  setInlineRenderFailed: (value: boolean) => void;
}): void {
  const {
    disableWorkerPool,
    inlineFallbackSafe,
    onError,
    pendingRenderKey,
    renderItemCount,
    renderMode,
    setInlineRenderFailed,
  } = input;
  const renderTimeoutMs = inlineFallbackSafe
    ? INLINE_RENDER_TIMEOUT_MS
    : LARGE_REVIEW_RENDER_TIMEOUT_MS;
  useEffect(() => {
    if (renderItemCount === 0 || pendingRenderKey === null) {
      return;
    }
    const timeout = setTimeout(() => {
      if (renderMode === "worker") {
        disableWorkerPool("render-timeout");
        return;
      }
      setInlineRenderFailed(true);
      onError(
        new Error("Pierre did not render the diff after the worker fallback.")
      );
    }, renderTimeoutMs);
    return () => clearTimeout(timeout);
  }, [
    disableWorkerPool,
    onError,
    pendingRenderKey,
    renderItemCount,
    renderMode,
    renderTimeoutMs,
    setInlineRenderFailed,
  ]);
}
