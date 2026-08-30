/**
 * Toolbar Reload plumbing for the canvas preview shell: chrome-store activity
 * registration, reload request → compile nonce bump, and busy clearing once
 * the user-triggered generation settles on a terminal state.
 */
import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import {
  clearCanvasBusy,
  markCanvasActive,
  requestCanvasReload,
  unmarkCanvasActive,
  useCanvasChrome,
} from "./canvas-chrome-store.ts";
import type { CanvasPreviewState } from "./canvas-compile-state.ts";

export function useCanvasChromeReload(input: {
  relPath: string | null;
  setNonce: Dispatch<SetStateAction<number>>;
  state: CanvasPreviewState;
}): { reload: () => void } {
  const { relPath, setNonce, state } = input;

  useEffect(() => {
    if (!relPath) {
      return;
    }
    markCanvasActive(relPath);
    return () => {
      unmarkCanvasActive(relPath);
    };
  }, [relPath]);

  const chrome = useCanvasChrome(relPath ?? "");
  const lastReloadRef = useRef<number | null>(null);
  /** True while a user-triggered Reload is in flight (toolbar busy → spin). */
  const userReloadPendingRef = useRef(false);
  useEffect(() => {
    if (lastReloadRef.current === null) {
      lastReloadRef.current = chrome.reloadRequest;
      return;
    }
    if (chrome.reloadRequest > lastReloadRef.current) {
      lastReloadRef.current = chrome.reloadRequest;
      userReloadPendingRef.current = true;
      setNonce((value) => value + 1);
    }
  }, [chrome.reloadRequest, setNonce]);

  // Clear the toolbar busy state once the reload-triggered generation settles
  // on a terminal state. Auto (stale) recompiles never set busy.
  useEffect(() => {
    if (!(relPath && userReloadPendingRef.current)) {
      return;
    }
    if (state.kind !== "ready" && state.kind !== "error") {
      return;
    }
    userReloadPendingRef.current = false;
    clearCanvasBusy(relPath);
  }, [relPath, state]);

  return {
    reload: () => {
      if (relPath) {
        requestCanvasReload(relPath);
      }
    },
  };
}
