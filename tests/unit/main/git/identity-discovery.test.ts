import { dirname } from "node:path";
import {
  createGitIdentityDiscovery,
  gitIdentityWatchDirectories,
  isGitIdentityMarkerFilename,
  shouldInvalidateGitIdentityWatch,
} from "@main/services/git/identity-discovery.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const HOME = "/Users/xyz";
const CWD = "/Users/xyz/ABC/chengsheng";

describe("gitIdentityWatchDirectories", () => {
  it("always watches cwd and ancestors below $HOME when gitRoot is missing", () => {
    expect(gitIdentityWatchDirectories(CWD, undefined, HOME)).toEqual([
      CWD,
      dirname(CWD),
    ]);
  });

  it("does not walk above $HOME", () => {
    expect(gitIdentityWatchDirectories(HOME, undefined, HOME)).toEqual([HOME]);
  });

  it("watches cwd and gitRoot without walking ancestors once identity exists", () => {
    expect(
      gitIdentityWatchDirectories(`${CWD}/src`, "/Users/xyz/ABC/pier", HOME)
    ).toEqual([`${CWD}/src`, "/Users/xyz/ABC/pier"]);
  });
});

describe("isGitIdentityMarkerFilename", () => {
  it("accepts .git and nested paths under it", () => {
    expect(isGitIdentityMarkerFilename(".git")).toBe(true);
    expect(isGitIdentityMarkerFilename(".git/HEAD")).toBe(true);
    expect(isGitIdentityMarkerFilename(".git\\HEAD")).toBe(true);
  });

  it("rejects .github, other names, and null", () => {
    expect(isGitIdentityMarkerFilename(".github")).toBe(false);
    expect(isGitIdentityMarkerFilename("README.md")).toBe(false);
    expect(isGitIdentityMarkerFilename(null)).toBe(false);
  });
});

describe("shouldInvalidateGitIdentityWatch", () => {
  it("invalidates on .git and on unknown (null) filenames", () => {
    expect(shouldInvalidateGitIdentityWatch(".git")).toBe(true);
    expect(shouldInvalidateGitIdentityWatch(null)).toBe(true);
  });

  it("does not invalidate .github", () => {
    expect(shouldInvalidateGitIdentityWatch(".github")).toBe(false);
  });
});

describe("createGitIdentityDiscovery", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeDiscovery(debounceMs: number) {
    const listeners = new Map<
      string,
      (eventType: string, filename: string | Buffer | null) => void
    >();
    const errorListeners = new Map<string, (error: Error) => void>();
    const discovery = createGitIdentityDiscovery({
      debounceMs,
      fsWatch: (dir, listener) => {
        listeners.set(dir, listener);
        return {
          close: () => {
            listeners.delete(dir);
            errorListeners.delete(dir);
          },
          on: (event, errorListener) => {
            if (event === "error") {
              errorListeners.set(dir, errorListener);
            }
          },
        };
      },
      homeDir: HOME,
    });
    return { discovery, errorListeners, listeners };
  }

  it("marks dirty immediately and invalidates when .git appears in cwd", () => {
    const { discovery, listeners } = makeDiscovery(0);
    const onDirty = vi.fn();
    const onInvalidate = vi.fn();
    discovery.sync("win-1::term-1", { cwd: CWD, onDirty, onInvalidate });

    listeners.get(CWD)?.("rename", ".git");

    expect(onDirty).toHaveBeenCalledTimes(1);
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  it("invalidates when filename is null", () => {
    const { discovery, listeners } = makeDiscovery(0);
    const onDirty = vi.fn();
    const onInvalidate = vi.fn();
    discovery.sync("win-1::term-1", { cwd: CWD, onDirty, onInvalidate });

    listeners.get(CWD)?.("rename", null);

    expect(onDirty).toHaveBeenCalledTimes(1);
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  it("invalidates when .git appears on an ancestor while identity is missing", () => {
    const { discovery, listeners } = makeDiscovery(0);
    const onDirty = vi.fn();
    const onInvalidate = vi.fn();
    discovery.sync("win-1::term-1", { cwd: CWD, onDirty, onInvalidate });

    listeners.get(dirname(CWD))?.("rename", ".git");

    expect(onDirty).toHaveBeenCalledTimes(1);
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  it("stops ancestor watches after gitRoot is known", () => {
    const { discovery, listeners } = makeDiscovery(0);
    const onDirty = vi.fn();
    const onInvalidate = vi.fn();
    discovery.sync("win-1::term-1", { cwd: CWD, onDirty, onInvalidate });
    expect(listeners.has(dirname(CWD))).toBe(true);

    discovery.sync("win-1::term-1", {
      cwd: CWD,
      gitRoot: CWD,
      onDirty,
      onInvalidate,
    });

    expect(listeners.has(dirname(CWD))).toBe(false);
    listeners.get(CWD)?.("rename", ".git");
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  it("ignores non-.git names", () => {
    const { discovery, listeners } = makeDiscovery(0);
    const onDirty = vi.fn();
    const onInvalidate = vi.fn();
    discovery.sync("win-1::term-1", { cwd: CWD, onDirty, onInvalidate });
    listeners.get(CWD)?.("rename", "package.json");
    expect(onDirty).not.toHaveBeenCalled();
    expect(onInvalidate).not.toHaveBeenCalled();
  });

  it("does not drop a pending debounce when sync dirs are unchanged", () => {
    vi.useFakeTimers();
    const { discovery, listeners } = makeDiscovery(100);
    const onDirty = vi.fn();
    const onInvalidate = vi.fn();
    discovery.sync("win-1::term-1", { cwd: CWD, onDirty, onInvalidate });
    listeners.get(CWD)?.("rename", ".git");
    expect(onDirty).toHaveBeenCalledTimes(1);
    expect(onInvalidate).not.toHaveBeenCalled();

    discovery.sync("win-1::term-1", { cwd: CWD, onDirty, onInvalidate });
    vi.advanceTimersByTime(100);

    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  it("marks dirty and closes the watcher on fs.watch error", () => {
    const { discovery, errorListeners, listeners } = makeDiscovery(0);
    const onDirty = vi.fn();
    const onInvalidate = vi.fn();
    discovery.sync("win-1::term-1", { cwd: CWD, onDirty, onInvalidate });

    errorListeners.get(CWD)?.(new Error("watch torn down"));

    expect(onDirty).toHaveBeenCalledTimes(1);
    expect(onInvalidate).toHaveBeenCalledTimes(1);
    expect(listeners.has(CWD)).toBe(false);
  });

  it("marks dirty when fs.watch throws during setup", () => {
    const onDirty = vi.fn();
    const onInvalidate = vi.fn();
    const discovery = createGitIdentityDiscovery({
      debounceMs: 0,
      fsWatch: () => {
        throw new Error("ENOSPC");
      },
      homeDir: HOME,
    });

    discovery.sync("win-1::term-1", { cwd: CWD, onDirty, onInvalidate });

    expect(onDirty).toHaveBeenCalled();
    expect(onInvalidate).toHaveBeenCalled();
  });

  it("release stops further invalidations", () => {
    const { discovery, listeners } = makeDiscovery(0);
    const onDirty = vi.fn();
    const onInvalidate = vi.fn();
    discovery.sync("win-1::term-1", { cwd: CWD, onDirty, onInvalidate });
    discovery.release("win-1::term-1");
    listeners.get(CWD)?.("rename", ".git");
    expect(onDirty).not.toHaveBeenCalled();
    expect(onInvalidate).not.toHaveBeenCalled();
  });
});
