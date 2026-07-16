import { useWorkerPool, WorkerPoolContextProvider } from "@pierre/diffs/react";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

const DIFF_LANGUAGES = [
  "cpp",
  "css",
  "go",
  "python",
  "rust",
  "sh",
  "swift",
  "tsx",
  "typescript",
  "zig",
] as const;

const WORKER_INITIALIZATION_TIMEOUT_MS = 10_000;

function isMobileBrowser(): boolean {
  const navigator = globalThis.navigator;
  if (!navigator) {
    return false;
  }
  return (
    navigator.maxTouchPoints > 0 &&
    globalThis.matchMedia?.("(max-width: 767px), (pointer: coarse)").matches ===
      true
  );
}

function getWorkerResourceLimits(): {
  readonly poolSize: number;
  readonly totalASTLRUCacheSize: number;
} {
  return isMobileBrowser()
    ? { poolSize: 1, totalASTLRUCacheSize: 10 }
    : { poolSize: 3, totalASTLRUCacheSize: 100 };
}

const WORKER_RESOURCE_LIMITS = getWorkerResourceLimits();
let workerPoolFailed = false;
const workerPoolFailureListeners = new Set<() => void>();

function reportWorkerPoolFailure(): void {
  if (workerPoolFailed) {
    return;
  }
  workerPoolFailed = true;
  for (const listener of workerPoolFailureListeners) {
    listener();
  }
}

function subscribeWorkerPoolFailure(listener: () => void): () => void {
  workerPoolFailureListeners.add(listener);
  return () => {
    workerPoolFailureListeners.delete(listener);
    if (workerPoolFailureListeners.size === 0) {
      workerPoolFailed = false;
    }
  };
}

function getWorkerPoolFailureSnapshot(): boolean {
  return workerPoolFailed;
}

const WORKER_POOL_OPTIONS = {
  poolSize: Math.min(
    Math.max(1, (globalThis.navigator?.hardwareConcurrency ?? 1) - 1),
    WORKER_RESOURCE_LIMITS.poolSize
  ),
  totalASTLRUCacheSize: WORKER_RESOURCE_LIMITS.totalASTLRUCacheSize,
  workerFactory: () => {
    const worker = new Worker(
      new URL("@pierre/diffs/worker/worker.js", import.meta.url),
      { type: "module" }
    );
    worker.addEventListener("error", reportWorkerPoolFailure);
    return worker;
  },
} as const;

function WorkerThemeSync({
  onError,
  onUnavailable,
  theme,
}: {
  readonly onError: (error: Error) => void;
  readonly onUnavailable: () => void;
  readonly theme: string;
}): null {
  const pool = useWorkerPool();
  useEffect(() => {
    if (!pool) {
      return;
    }
    let active = true;
    const timeout = setTimeout(() => {
      if (active) {
        onUnavailable();
      }
    }, WORKER_INITIALIZATION_TIMEOUT_MS);
    pool.setRenderOptions({ theme }).then(
      () => {
        clearTimeout(timeout);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        if (!active) {
          return;
        }
        if (!pool.isWorkingPool()) {
          onUnavailable();
          return;
        }
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    );
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [onError, onUnavailable, pool, theme]);
  return null;
}

function WorkerFailureSync({
  onUnavailable,
}: {
  readonly onUnavailable: () => void;
}): null {
  const failed = useSyncExternalStore(
    subscribeWorkerPoolFailure,
    getWorkerPoolFailureSnapshot,
    getWorkerPoolFailureSnapshot
  );
  useEffect(() => {
    if (failed) {
      onUnavailable();
    }
  }, [failed, onUnavailable]);
  return null;
}

export function PierDiffWorkerProvider({
  children,
  onError,
  onUnavailable,
  theme,
}: {
  readonly children: ReactNode;
  readonly onError: (error: Error) => void;
  readonly onUnavailable: () => void;
  readonly theme: string;
}): React.JSX.Element {
  const highlighterOptions = useMemo(
    () => ({
      langs: [...DIFF_LANGUAGES],
      preferredHighlighter: "shiki-wasm" as const,
      theme,
    }),
    [theme]
  );

  return (
    <WorkerPoolContextProvider
      highlighterOptions={highlighterOptions}
      poolOptions={WORKER_POOL_OPTIONS}
    >
      <WorkerThemeSync
        onError={onError}
        onUnavailable={onUnavailable}
        theme={theme}
      />
      <WorkerFailureSync onUnavailable={onUnavailable} />
      {children}
    </WorkerPoolContextProvider>
  );
}
