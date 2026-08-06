import { type FSWatcher, watch } from "node:fs";
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
 * Watch parent directories (not individual files) so atomic editor saves
 * (write temp + rename) still fire events and keep hot-reload alive.
 */
export function createLiveModuleGraphTracker(): LiveModuleGraphTracker {
  const moduleToFiles = new Map<ModuleKey, Set<string>>();
  const fileToModules = new Map<string, Set<ModuleKey>>();
  const dirToFiles = new Map<string, Set<string>>();
  const dirWatchers = new Map<string, FSWatcher>();
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

  function ensureDirWatch(dir: string): void {
    if (dirWatchers.has(dir) || !listener) {
      return;
    }
    try {
      const watcher = watch(dir, (_eventType, filename) => {
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
              hit = true;
            }
          }
          // Rename / new sibling in a watched dir: fileToModules miss still
          // wakes every module that watches files here (broken import recovery).
          if (!hit) {
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
        for (const file of filesInDir) {
          notifyFile(file);
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
