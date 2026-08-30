import { type FSWatcher, watch as fsWatch, statSync } from "node:fs";
import { dirname } from "node:path";
import type { LiveModuleEvent } from "@shared/contracts/live-modules.ts";

/** Coalesce editor multi-fire watch events before emitting stale. */
export const LIVE_MODULE_WATCH_DEBOUNCE_MS = 75;

export interface LiveModuleGraphTracker {
  clearModule(rootId: string, moduleId: string): void;
  /** Drop every module graph under a root id (unregister root). */
  clearRoot(rootId: string): void;
  listModuleIds(rootId: string): string[];
  /** Record compiled graph paths (absolute) for a module. */
  setModuleGraph(
    rootId: string,
    moduleId: string,
    absolutePaths: string[]
  ): void;
  /** Start watching absolute paths; invoke onChange with affected module keys. */
  watch(
    onChange: (events: Array<{ moduleId: string; rootId: string }>) => void
  ): () => void;
}

type ModuleKey = `${string}::${string}`;

function moduleKey(rootId: string, moduleId: string): ModuleKey {
  return `${rootId}::${moduleId}`;
}

function normalizePath(file: string): string {
  return file.replaceAll("\\", "/");
}

/**
 * Sibling names that can recover a broken import when they appear in a
 * watched directory. Data files written via `useCanvasFile` (`board.json`,
 * `instance.json`, …) must not match — a miss-wake recompiles the canvas
 * and the preview flashes on every drag persist.
 */
const GRAPH_RECOVERY_FILE_RE = /\.(?:[cm]?[jt]sx?|css|vue|svelte)$/iu;

export function isLiveModuleGraphRecoveryFileName(fileName: string): boolean {
  const leaf = normalizePath(fileName).split("/").at(-1) ?? fileName;
  return GRAPH_RECOVERY_FILE_RE.test(leaf);
}

/** Subset of `fs.watch` used to observe a graph directory. */
export type LiveModuleDirWatch = (
  dir: string,
  listener: (event: string, filename: string | Buffer | null) => void
) => Pick<FSWatcher, "close" | "on">;

function readMtime(file: string): number | null {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Watch parent directories (not individual files) so atomic editor saves
 * (write temp + rename) still fire events and keep hot-reload alive.
 */
export function createLiveModuleGraphTracker(options?: {
  watch?: LiveModuleDirWatch;
}): LiveModuleGraphTracker {
  const watchDir: LiveModuleDirWatch =
    options?.watch ?? ((dir, listener) => fsWatch(dir, listener));
  const moduleToFiles = new Map<ModuleKey, Set<string>>();
  const fileToModules = new Map<string, Set<ModuleKey>>();
  const dirToFiles = new Map<string, Set<string>>();
  const dirWatchers = new Map<string, Pick<FSWatcher, "close" | "on">>();
  const fileMtimes = new Map<string, number>();
  const pendingKeys = new Set<ModuleKey>();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let listener:
    | ((events: Array<{ moduleId: string; rootId: string }>) => void)
    | null = null;

  function flushPending(): void {
    debounceTimer = undefined;
    if (!(listener && pendingKeys.size > 0)) {
      pendingKeys.clear();
      return;
    }
    const events: Array<{ moduleId: string; rootId: string }> = [];
    for (const key of pendingKeys) {
      const sepIdx = key.indexOf("::");
      events.push({
        moduleId: key.slice(sepIdx + 2),
        rootId: key.slice(0, sepIdx),
      });
    }
    pendingKeys.clear();
    listener(events);
  }

  function scheduleKeys(keys: Iterable<ModuleKey>): void {
    for (const key of keys) {
      pendingKeys.add(key);
    }
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(flushPending, LIVE_MODULE_WATCH_DEBOUNCE_MS);
  }

  function notifyFile(file: string): void {
    const modules = fileToModules.get(file);
    if (!(modules && listener)) {
      return;
    }
    scheduleKeys(modules);
  }

  function rememberMtime(file: string): void {
    const mtime = readMtime(file);
    if (mtime === null) {
      fileMtimes.delete(file);
      return;
    }
    fileMtimes.set(file, mtime);
  }

  /** True when a tracked graph file appeared, disappeared, or changed on disk. */
  function graphFileChanged(file: string): boolean {
    const mtime = readMtime(file);
    const previous = fileMtimes.get(file);
    if (mtime === null) {
      fileMtimes.delete(file);
      return previous !== undefined;
    }
    fileMtimes.set(file, mtime);
    return previous === undefined || previous !== mtime;
  }

  function ensureDirWatch(dir: string): void {
    if (dirWatchers.has(dir) || !listener) {
      return;
    }
    try {
      const watcher = watchDir(dir, (_eventType, filename) => {
        if (!listener) {
          return;
        }
        const filesInDir = dirToFiles.get(dir);
        if (!filesInDir || filesInDir.size === 0) {
          return;
        }
        if (filename) {
          const base = filename.toString().replaceAll("\\", "/");
          const leaf = base.includes("/")
            ? (base.split("/").at(-1) ?? base)
            : base;
          let hit = false;
          for (const file of filesInDir) {
            const fileLeaf = file.split("/").at(-1) ?? file;
            if (fileLeaf === leaf) {
              notifyFile(file);
              rememberMtime(file);
              hit = true;
            }
          }
          // New sibling source in a watched dir: fileToModules miss still
          // wakes every module here (broken import recovery). Data siblings
          // (`board.json`) stay silent — they are not in the compile graph.
          if (!hit && isLiveModuleGraphRecoveryFileName(leaf)) {
            const keys = new Set<ModuleKey>();
            for (const file of filesInDir) {
              const modules = fileToModules.get(file);
              if (!modules) {
                continue;
              }
              for (const key of modules) {
                keys.add(key);
              }
            }
            if (keys.size > 0) {
              scheduleKeys(keys);
            }
          }
          return;
        }
        // Some platforms omit the name (overflow / coalesced dir events).
        // Only wake modules whose tracked files actually moved on disk —
        // a sibling `board.json` write must not remount the canvas.
        for (const file of filesInDir) {
          if (graphFileChanged(file)) {
            notifyFile(file);
          }
        }
      });
      watcher.on("error", () => {
        try {
          watcher.close();
        } catch {
          // ignore
        }
        dirWatchers.delete(dir);
      });
      dirWatchers.set(dir, watcher);
    } catch {
      // Missing dir or unsupported watch — ignore; compile still works.
    }
  }

  function unlinkFile(file: string, key: ModuleKey): void {
    const modules = fileToModules.get(file);
    if (!modules) {
      return;
    }
    modules.delete(key);
    if (modules.size === 0) {
      fileToModules.delete(file);
      fileMtimes.delete(file);
      const dir = normalizePath(dirname(file));
      const filesInDir = dirToFiles.get(dir);
      if (filesInDir) {
        filesInDir.delete(file);
        if (filesInDir.size === 0) {
          dirToFiles.delete(dir);
          const watcher = dirWatchers.get(dir);
          watcher?.close();
          dirWatchers.delete(dir);
        }
      }
    }
  }

  function linkFile(file: string, key: ModuleKey): void {
    let modules = fileToModules.get(file);
    if (!modules) {
      modules = new Set();
      fileToModules.set(file, modules);
    }
    modules.add(key);

    const dir = normalizePath(dirname(file));
    let filesInDir = dirToFiles.get(dir);
    if (!filesInDir) {
      filesInDir = new Set();
      dirToFiles.set(dir, filesInDir);
    }
    filesInDir.add(file);
    rememberMtime(file);
    ensureDirWatch(dir);
  }

  return {
    clearModule(rootId, moduleId) {
      const key = moduleKey(rootId, moduleId);
      const files = moduleToFiles.get(key);
      if (!files) {
        return;
      }
      for (const file of files) {
        unlinkFile(file, key);
      }
      moduleToFiles.delete(key);
      pendingKeys.delete(key);
    },
    clearRoot(rootId) {
      for (const key of [...moduleToFiles.keys()]) {
        if (key.startsWith(`${rootId}::`)) {
          const moduleId = key.slice(rootId.length + 2);
          this.clearModule(rootId, moduleId);
        }
      }
    },
    listModuleIds(rootId) {
      const ids: string[] = [];
      for (const key of moduleToFiles.keys()) {
        if (key.startsWith(`${rootId}::`)) {
          ids.push(key.slice(rootId.length + 2));
        }
      }
      return ids;
    },
    setModuleGraph(rootId, moduleId, absolutePaths) {
      const key = moduleKey(rootId, moduleId);
      const previous = moduleToFiles.get(key);
      if (previous) {
        for (const file of previous) {
          unlinkFile(file, key);
        }
      }
      const next = new Set(absolutePaths.map((path) => normalizePath(path)));
      moduleToFiles.set(key, next);
      for (const file of next) {
        linkFile(file, key);
      }
    },
    watch(onChange) {
      listener = onChange;
      for (const dir of dirToFiles.keys()) {
        ensureDirWatch(dir);
      }
      return () => {
        if (listener === onChange) {
          listener = null;
        }
        if (debounceTimer !== undefined) {
          clearTimeout(debounceTimer);
          debounceTimer = undefined;
        }
        pendingKeys.clear();
        for (const watcher of dirWatchers.values()) {
          watcher.close();
        }
        dirWatchers.clear();
      };
    },
  };
}

export function toStaleEvents(
  changes: Array<{ moduleId: string; rootId: string }>
): LiveModuleEvent[] {
  const seen = new Set<string>();
  const events: LiveModuleEvent[] = [];
  for (const change of changes) {
    const key = `${change.rootId}::${change.moduleId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    events.push({
      moduleId: change.moduleId,
      rootId: change.rootId,
      type: "stale",
    });
  }
  return events;
}
