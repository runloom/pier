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

export interface ManagedPluginDevRuntimeWatchOptions {
  readonly debounceMs?: number;
  readonly logger?: {
    error(message: string, meta?: unknown): void;
    info(message: string, meta?: unknown): void;
  };
  readonly packageDir: string;
  readonly refreshRuntimeSources: () => Promise<void>;
}

export function startManagedPluginDevRuntimeWatch(
  options: ManagedPluginDevRuntimeWatchOptions
): ManagedPluginDevRuntimeWatch {
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

export interface ManagedPluginDevRuntimeWatchRegistry {
  dispose(): void;
  ensure(pluginId: string, options: ManagedPluginDevRuntimeWatchOptions): void;
}

export function createManagedPluginDevRuntimeWatchRegistry(
  start: (
    options: ManagedPluginDevRuntimeWatchOptions
  ) => ManagedPluginDevRuntimeWatch = startManagedPluginDevRuntimeWatch
): ManagedPluginDevRuntimeWatchRegistry {
  const watchesByPluginId = new Map<string, ManagedPluginDevRuntimeWatch>();
  let disposed = false;

  return {
    dispose(): void {
      disposed = true;
      const errors: unknown[] = [];
      try {
        for (const watch of watchesByPluginId.values()) {
          try {
            watch.dispose();
          } catch (error) {
            errors.push(error);
          }
        }
      } finally {
        watchesByPluginId.clear();
      }

      if (errors.length === 1) {
        throw errors[0];
      }
      if (errors.length > 1) {
        throw new AggregateError(
          errors,
          "Failed to dispose managed plugin dev runtime watchers"
        );
      }
    },
    ensure(
      pluginId: string,
      options: ManagedPluginDevRuntimeWatchOptions
    ): void {
      if (disposed || watchesByPluginId.has(pluginId)) {
        return;
      }
      watchesByPluginId.set(pluginId, start(options));
    },
  };
}
