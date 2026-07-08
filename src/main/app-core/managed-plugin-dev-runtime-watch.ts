import { type FSWatcher, watch } from "node:fs";
import { sep } from "node:path";

const DEV_RUNTIME_TRIGGER_FILES = new Set([
  "plugin.json",
  "dist/main.js",
  "dist/renderer.js",
]);

export function isManagedPluginDevRuntimeFile(
  filename: string | Buffer | null
): boolean {
  if (!filename) {
    return false;
  }
  const normalized = String(filename).split(sep).join("/");
  return DEV_RUNTIME_TRIGGER_FILES.has(normalized);
}

export interface ManagedPluginDevRuntimeWatch {
  dispose(): void;
}

export function startManagedPluginDevRuntimeWatch(options: {
  readonly debounceMs?: number;
  readonly logger?: {
    error(message: string, meta?: unknown): void;
    info(message: string, meta?: unknown): void;
  };
  readonly packageDir: string;
  readonly refreshRuntimeSources: () => Promise<void>;
}): ManagedPluginDevRuntimeWatch {
  let disposed = false;
  let timer: NodeJS.Timeout | null = null;
  const debounceMs = options.debounceMs ?? 100;

  function scheduleRefresh(): void {
    if (disposed) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      options.refreshRuntimeSources().catch((err: unknown) => {
        options.logger?.error("[managed-plugins] dev runtime refresh failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, debounceMs);
    timer.unref?.();
  }

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(options.packageDir, { recursive: true }, (_event, file) => {
      if (isManagedPluginDevRuntimeFile(file)) {
        scheduleRefresh();
      }
    });
    watcher.on("error", (err) => {
      options.logger?.error("[managed-plugins] dev runtime watcher failed", {
        error: err instanceof Error ? err.message : String(err),
        packageDir: options.packageDir,
      });
    });
    options.logger?.info("[managed-plugins] dev runtime watcher started", {
      packageDir: options.packageDir,
    });
  } catch (err) {
    options.logger?.error("[managed-plugins] dev runtime watcher unavailable", {
      error: err instanceof Error ? err.message : String(err),
      packageDir: options.packageDir,
    });
  }

  return {
    dispose(): void {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      watcher?.close();
      watcher = null;
    },
  };
}
