import {
  clearAllRuntimeLiveModuleContentDirectories,
  normalizeProjectRootKey,
  parseLiveModulesProjectConfig,
  setRuntimeLiveModuleContentDirectories,
} from "@shared/live-module-canvas-path.ts";
import { loadLiveModulesProjectConfig } from "./live-modules-project-config.ts";

/**
 * Per-root ensure cache. `generation` is bumped by applyAfterSave / invalidate so
 * in-flight loads cannot clobber a newer apply.
 */
interface CacheSlot {
  generation: number;
  promise: Promise<string[]>;
}

const loadedForRoot = new Map<string, CacheSlot>();
/** Monotonic generation per project root (bumped on apply / invalidate). */
const generationByRoot = new Map<string, number>();

const changeListeners = new Set<(projectRootPath: string) => void>();

function currentGeneration(key: string): number {
  return generationByRoot.get(key) ?? 0;
}

function bumpGeneration(key: string): number {
  const next = currentGeneration(key) + 1;
  generationByRoot.set(key, next);
  return next;
}

/**
 * Subscribe to Live Modules project config changes (settings save / disk write).
 * Listener receives the project root that changed.
 */
export function subscribeLiveModulesProjectConfigChanged(
  listener: (projectRootPath: string) => void
): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/** Notify open panels that content directories for a project changed. */
export function notifyLiveModulesProjectConfigChanged(
  projectRootPath: string
): void {
  for (const listener of changeListeners) {
    listener(projectRootPath);
  }
}

/**
 * Ensure project Live Modules config is applied for this project root.
 * Source of truth: Project → General settings → `.pier/live-modules.json`.
 *
 * - Success is cached and re-applied on subsequent calls (multi-project safe).
 * - Failures are not sticky: the cache entry is dropped so the next call retries.
 * - In-flight loads never overwrite a newer applyAfterSave / invalidate generation.
 */
export function ensureLiveModulesProjectConfigLoaded(
  projectRootPath: string
): Promise<void> {
  const key = normalizeProjectRootKey(projectRootPath);
  const existing = loadedForRoot.get(key);
  if (existing) {
    return existing.promise.then(
      (directories) => {
        // Re-apply only if this slot is still current (not superseded by save).
        const slot = loadedForRoot.get(key);
        if (slot?.promise === existing.promise) {
          setRuntimeLiveModuleContentDirectories(projectRootPath, directories);
        }
      },
      () => {
        // Prior attempt failed and was removed — retry once.
        if (!loadedForRoot.has(key)) {
          return ensureLiveModulesProjectConfigLoaded(projectRootPath);
        }
      }
    );
  }

  const generation = currentGeneration(key);
  // Holder so the async body can compare promise identity after assignment.
  const holder: { promise?: Promise<string[]> } = {};
  const isOwner = (): boolean => {
    const slot = loadedForRoot.get(key);
    return (
      slot?.promise === holder.promise && currentGeneration(key) === generation
    );
  };

  holder.promise = (async (): Promise<string[]> => {
    try {
      // Do not apply runtime inside load — ownership is decided here.
      const result = await loadLiveModulesProjectConfig(projectRootPath, {
        applyRuntime: false,
      });
      if (result.kind === "failed") {
        if (isOwner()) {
          loadedForRoot.delete(key);
          setRuntimeLiveModuleContentDirectories(projectRootPath, null);
        }
        throw new Error(result.message);
      }
      return result.contentDirectories;
    } catch (error) {
      if (isOwner()) {
        loadedForRoot.delete(key);
      }
      throw error;
    }
  })();

  const task = holder.promise;
  loadedForRoot.set(key, { generation, promise: task });

  return task.then(
    (directories) => {
      if (isOwner()) {
        setRuntimeLiveModuleContentDirectories(projectRootPath, directories);
      }
    },
    () => {
      // Best-effort for panel open: keep current runtime; next ensure retries.
    }
  );
}

/**
 * Seed the ensure-cache after a successful settings save (or disk write) so open
 * panels do not re-read a stale load, then broadcast a change notification.
 * Bumps generation so any in-flight ensure cannot clobber this result.
 */
export function applyLiveModulesProjectConfigAfterSave(
  projectRootPath: string,
  contentDirectories: readonly string[]
): void {
  const key = normalizeProjectRootKey(projectRootPath);
  const directories = [...contentDirectories];
  const generation = bumpGeneration(key);
  setRuntimeLiveModuleContentDirectories(projectRootPath, directories);
  loadedForRoot.set(key, {
    generation,
    promise: Promise.resolve(directories),
  });
  notifyLiveModulesProjectConfigChanged(projectRootPath);
}

/** Drop cache so the next ensure re-reads disk. Bumps generation. */
export function invalidateLiveModulesProjectConfigCache(
  projectRootPath?: string
): void {
  if (!projectRootPath) {
    loadedForRoot.clear();
    generationByRoot.clear();
    return;
  }
  const key = normalizeProjectRootKey(projectRootPath);
  bumpGeneration(key);
  loadedForRoot.delete(key);
}

/**
 * After the files panel (or any writer) saves `.pier/live-modules.json`, refresh
 * runtime + notify open panels without requiring Settings.
 */
export function applyLiveModulesProjectConfigFromDiskContents(
  projectRootPath: string,
  rawContents: string
): void {
  const parsed = parseLiveModulesProjectConfig(rawContents);
  applyLiveModulesProjectConfigAfterSave(
    projectRootPath,
    parsed.contentDirectories
  );
}

export function resetLiveModulesProjectConfigCacheForTests(): void {
  loadedForRoot.clear();
  generationByRoot.clear();
  changeListeners.clear();
  clearAllRuntimeLiveModuleContentDirectories();
}
