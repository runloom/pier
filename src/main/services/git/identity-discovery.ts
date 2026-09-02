import { type FSWatcher, watch as fsWatchNative } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

/** Burst coalescing for the resolver call only — not an identity TTL. */
export const GIT_IDENTITY_DISCOVERY_DEBOUNCE_MS = 100;

export interface GitIdentityWatchHandle {
  close(): void;
  on?(event: "error", listener: (error: Error) => void): void;
}

export type GitIdentityDiscoveryFsWatch = (
  dir: string,
  listener: (eventType: string, filename: string | Buffer | null) => void
) => GitIdentityWatchHandle;

export interface GitIdentityDiscoverySyncInput {
  cwd: string;
  gitRoot?: string | undefined;
  onDirty: () => void;
  onInvalidate: () => void | Promise<void>;
}

export interface CreateGitIdentityDiscoveryOptions {
  debounceMs?: number;
  fsWatch?: GitIdentityDiscoveryFsWatch;
  homeDir?: string;
}

export interface GitIdentityDiscovery {
  release(scopeKey: string): void;
  reset(): void;
  retain(sessionScope: string, activePanelIds: readonly string[]): void;
  sync(scopeKey: string, input: GitIdentityDiscoverySyncInput): void;
}

function defaultFsWatch(
  dir: string,
  listener: (eventType: string, filename: string | Buffer | null) => void
): FSWatcher {
  return fsWatchNative(dir, { persistent: false }, listener);
}

function pathEquals(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function isFilesystemRoot(dir: string): boolean {
  return dirname(dir) === dir;
}

function setEquals(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

/**
 * Directories whose `.git` create/delete can change identity for this cwd.
 * Ancestor walk stops before $HOME and the filesystem root.
 */
export function gitIdentityWatchDirectories(
  cwd: string,
  gitRoot: string | undefined,
  homeDir: string
): string[] {
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(homeDir);
  const dirs = new Set<string>([resolvedCwd]);
  if (gitRoot) {
    dirs.add(resolve(gitRoot));
  } else {
    let dir = resolvedCwd;
    while (!pathEquals(dir, resolvedHome)) {
      const parent = dirname(dir);
      if (isFilesystemRoot(parent) || pathEquals(parent, resolvedHome)) {
        break;
      }
      dirs.add(parent);
      dir = parent;
    }
  }
  return [...dirs];
}

export function isGitIdentityMarkerFilename(
  filename: string | Buffer | null
): boolean {
  if (filename == null) {
    return false;
  }
  const raw = typeof filename === "string" ? filename : filename.toString();
  const normalized = raw.replaceAll("\\", "/");
  return normalized === ".git" || normalized.startsWith(".git/");
}

/** Invalidation signal only. `filename == null` is an unknown dir event. */
export function shouldInvalidateGitIdentityWatch(
  filename: string | Buffer | null
): boolean {
  return filename == null || isGitIdentityMarkerFilename(filename);
}

interface DirWatch {
  close: () => void;
  scopes: Set<string>;
}

interface ScopeState {
  dirs: Set<string>;
  onDirty: () => void;
  onInvalidate: () => void | Promise<void>;
}

export function createGitIdentityDiscovery({
  debounceMs = GIT_IDENTITY_DISCOVERY_DEBOUNCE_MS,
  fsWatch = defaultFsWatch,
  homeDir = homedir(),
}: CreateGitIdentityDiscoveryOptions = {}): GitIdentityDiscovery {
  const dirWatches = new Map<string, DirWatch>();
  const scopes = new Map<string, ScopeState>();
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function closeDir(dir: string): void {
    const watch = dirWatches.get(dir);
    if (!watch) {
      return;
    }
    try {
      watch.close();
    } catch {
      // watcher already gone
    }
    dirWatches.delete(dir);
  }

  function unwatchDirForScope(dir: string, scopeKey: string): void {
    const watch = dirWatches.get(dir);
    if (!watch) {
      return;
    }
    watch.scopes.delete(scopeKey);
    if (watch.scopes.size === 0) {
      closeDir(dir);
    }
  }

  function clearRefreshTimer(scopeKey: string): void {
    const timer = refreshTimers.get(scopeKey);
    if (timer !== undefined) {
      clearTimeout(timer);
      refreshTimers.delete(scopeKey);
    }
  }

  function fireInvalidate(scopeKey: string): void {
    const scope = scopes.get(scopeKey);
    if (!scope) {
      return;
    }
    Promise.resolve(scope.onInvalidate()).catch((err: unknown) => {
      console.error("[pier-cwd-identity] discovery invalidate failed:", err);
    });
  }

  function scheduleDebouncedRefresh(scopeKey: string): void {
    if (debounceMs <= 0) {
      fireInvalidate(scopeKey);
      return;
    }
    if (refreshTimers.has(scopeKey)) {
      return;
    }
    refreshTimers.set(
      scopeKey,
      setTimeout(() => {
        refreshTimers.delete(scopeKey);
        fireInvalidate(scopeKey);
      }, debounceMs)
    );
  }

  function markDirtyAndRefresh(scopeKey: string): void {
    const scope = scopes.get(scopeKey);
    if (!scope) {
      return;
    }
    scope.onDirty();
    scheduleDebouncedRefresh(scopeKey);
  }

  function notifyDir(dir: string): void {
    const watch = dirWatches.get(dir);
    if (!watch) {
      return;
    }
    for (const scopeKey of [...watch.scopes]) {
      markDirtyAndRefresh(scopeKey);
    }
  }

  function watchDir(dir: string, scopeKey: string): void {
    const existing = dirWatches.get(dir);
    if (existing) {
      existing.scopes.add(scopeKey);
      return;
    }
    try {
      const watcher = fsWatch(dir, (_eventType, filename) => {
        if (shouldInvalidateGitIdentityWatch(filename)) {
          notifyDir(dir);
        }
      });
      dirWatches.set(dir, {
        close: () => {
          watcher.close();
        },
        scopes: new Set([scopeKey]),
      });
      watcher.on?.("error", (err: Error) => {
        console.error("[pier-cwd-identity] watch failed:", dir, err);
        notifyDir(dir);
        closeDir(dir);
      });
    } catch (err: unknown) {
      console.error("[pier-cwd-identity] watch setup failed:", dir, err);
      markDirtyAndRefresh(scopeKey);
    }
  }

  function release(scopeKey: string): void {
    const scope = scopes.get(scopeKey);
    if (!scope) {
      return;
    }
    clearRefreshTimer(scopeKey);
    for (const dir of scope.dirs) {
      unwatchDirForScope(dir, scopeKey);
    }
    scopes.delete(scopeKey);
  }

  return {
    release,
    retain(sessionScope, activePanelIds) {
      const prefix = `${sessionScope}::`;
      const keep = new Set(
        activePanelIds.map((panelId) => `${sessionScope}::${panelId}`)
      );
      for (const scopeKey of [...scopes.keys()]) {
        if (scopeKey.startsWith(prefix) && !keep.has(scopeKey)) {
          release(scopeKey);
        }
      }
    },
    reset() {
      for (const scopeKey of [...scopes.keys()]) {
        release(scopeKey);
      }
    },
    sync(scopeKey, input) {
      const nextDirs = new Set(
        gitIdentityWatchDirectories(input.cwd, input.gitRoot, homeDir)
      );
      const previous = scopes.get(scopeKey);
      if (previous && !setEquals(previous.dirs, nextDirs)) {
        clearRefreshTimer(scopeKey);
        for (const dir of previous.dirs) {
          if (!nextDirs.has(dir)) {
            unwatchDirForScope(dir, scopeKey);
          }
        }
      }
      scopes.set(scopeKey, {
        dirs: nextDirs,
        onDirty: input.onDirty,
        onInvalidate: input.onInvalidate,
      });
      for (const dir of nextDirs) {
        watchDir(dir, scopeKey);
      }
    },
  };
}

let discovery: GitIdentityDiscovery = createGitIdentityDiscovery();

export function syncGitIdentityDiscovery(
  scopeKey: string,
  input: GitIdentityDiscoverySyncInput
): void {
  discovery.sync(scopeKey, input);
}

export function releaseGitIdentityDiscovery(scopeKey: string): void {
  discovery.release(scopeKey);
}

export function retainGitIdentityDiscovery(
  sessionScope: string,
  activePanelIds: readonly string[]
): void {
  discovery.retain(sessionScope, activePanelIds);
}

export function resetGitIdentityDiscoveryForTests(): void {
  discovery.reset();
  discovery = createGitIdentityDiscovery();
}

export function setGitIdentityDiscoveryForTests(
  next: GitIdentityDiscovery | null
): void {
  discovery.reset();
  discovery = next ?? createGitIdentityDiscovery();
}
