import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadLiveModulesProjectConfig,
  rememberLiveModuleConfigConsumer,
  saveLiveModulesProjectConfig,
} from "../../../../src/plugins/api/live-modules-project-config.ts";
import {
  applyLiveModulesProjectConfigAfterSave,
  applyLiveModulesProjectConfigFromDiskContents,
  ensureLiveModulesProjectConfigLoaded,
  resetLiveModulesProjectConfigCacheForTests,
  subscribeLiveModulesProjectConfigChanged,
} from "../../../../src/plugins/api/live-modules-project-config-cache.ts";
import {
  clearAllRuntimeLiveModuleContentDirectories,
  liveModuleProjectContentDirectories,
} from "../../../../src/shared/live-module-canvas-path.ts";

type ExistsFn = (input: { path: string; root: string }) => Promise<boolean>;
type ReadDocumentFn = (input: {
  path: string;
  root: string;
}) => Promise<
  | { kind: "text"; contents: string; revision: string }
  | { kind: "binary"; contents: ArrayBuffer; revision: string }
>;
type WriteDocumentFn = (input: {
  path: string;
  root: string;
  contents: string;
  expected: { kind: "absent" } | { kind: "revision"; revision: string };
}) => Promise<
  | { kind: "written"; revision: string }
  | { kind: "conflict"; message: string }
  | { kind: "failed"; message: string }
>;

function installFilesMock(handlers: {
  exists?: ExistsFn;
  readDocument?: ReadDocumentFn;
  writeDocument?: WriteDocumentFn;
  worktreeMainPath?: string;
}): void {
  const pier = {
    files: {
      exists:
        handlers.exists ??
        (async () => {
          throw new Error("exists not mocked");
        }),
      readDocument:
        handlers.readDocument ??
        (async () => {
          throw new Error("readDocument not mocked");
        }),
      writeDocument:
        handlers.writeDocument ??
        (async () => {
          throw new Error("writeDocument not mocked");
        }),
    },
    worktrees: {
      check: async ({ path }: { path: string }) =>
        handlers.worktreeMainPath
          ? {
              mainPath: handlers.worktreeMainPath,
              path,
              status: "supported" as const,
            }
          : {
              path,
              reason: "not_git_repo" as const,
              status: "unsupported" as const,
            },
    },
  };
  vi.stubGlobal("window", { pier });
}

describe("live-modules project config", () => {
  beforeEach(() => {
    resetLiveModulesProjectConfigCacheForTests();
    clearAllRuntimeLiveModuleContentDirectories();
  });

  afterEach(() => {
    resetLiveModulesProjectConfigCacheForTests();
    vi.unstubAllGlobals();
  });

  it("loads missing config as factory defaults for that project only", async () => {
    installFilesMock({
      exists: async () => false,
    });
    const result = await loadLiveModulesProjectConfig("/proj/a");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.contentDirectories).toEqual([".pier/canvases", "docs"]);
    expect(liveModuleProjectContentDirectories("/proj/a")).toEqual([
      ".pier/canvases",
      "docs",
    ]);
  });

  it("loads explicit contentDirectories and isolates projects", async () => {
    installFilesMock({
      exists: async ({ root }) => root === "/proj/a" || root === "/proj/b",
      readDocument: async ({ root }) => {
        if (root === "/proj/a") {
          return {
            kind: "text",
            contents: JSON.stringify({
              version: 1,
              contentDirectories: ["designs"],
            }),
            revision: "rev-a",
          };
        }
        return {
          kind: "text",
          contents: JSON.stringify({
            version: 1,
            contentDirectories: ["notes"],
          }),
          revision: "rev-b",
        };
      },
    });

    await loadLiveModulesProjectConfig("/proj/a");
    await loadLiveModulesProjectConfig("/proj/b");
    expect(liveModuleProjectContentDirectories("/proj/a")).toEqual(["designs"]);
    expect(liveModuleProjectContentDirectories("/proj/b")).toEqual(["notes"]);
  });

  it("rejects empty list on save", async () => {
    installFilesMock({});
    const result = await saveLiveModulesProjectConfig({
      projectRootPath: "/proj/a",
      contentDirectories: ["../evil", ""],
      expectedRevision: null,
    });
    expect(result).toEqual({
      kind: "failed",
      message: "At least one content directory is required.",
    });
  });

  it("writes full list and updates per-project runtime", async () => {
    installFilesMock({
      writeDocument: async () => ({ kind: "written", revision: "r2" }),
    });
    const result = await saveLiveModulesProjectConfig({
      projectRootPath: "/proj/a",
      contentDirectories: ["designs", "docs/"],
      expectedRevision: null,
    });
    expect(result.kind).toBe("written");
    if (result.kind !== "written") {
      return;
    }
    expect(result.contentDirectories).toEqual(["designs", "docs"]);
    expect(liveModuleProjectContentDirectories("/proj/a")).toEqual([
      "designs",
      "docs",
    ]);
  });

  it("does not sticky-cache failed ensure; re-applies on later success", async () => {
    let calls = 0;
    installFilesMock({
      exists: async () => true,
      readDocument: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("EIO temporary");
        }
        return {
          kind: "text",
          contents: JSON.stringify({
            version: 1,
            contentDirectories: ["designs"],
          }),
          revision: "r1",
        };
      },
    });

    await ensureLiveModulesProjectConfigLoaded("/proj/retry");
    // Failure → factory defaults for this root (runtime cleared)
    expect(liveModuleProjectContentDirectories("/proj/retry")).toEqual([
      ".pier/canvases",
      "docs",
    ]);

    await ensureLiveModulesProjectConfigLoaded("/proj/retry");
    expect(calls).toBe(2);
    expect(liveModuleProjectContentDirectories("/proj/retry")).toEqual([
      "designs",
    ]);
  });

  it("re-applies cached project list after another project load", async () => {
    installFilesMock({
      exists: async () => true,
      readDocument: async ({ root }) => ({
        kind: "text",
        contents: JSON.stringify({
          version: 1,
          contentDirectories: root.endsWith("a") ? ["from-a"] : ["from-b"],
        }),
        revision: "r",
      }),
    });

    await ensureLiveModulesProjectConfigLoaded("/proj/a");
    await ensureLiveModulesProjectConfigLoaded("/proj/b");
    // Both stored per root; loading B must not clobber A's map entry.
    expect(liveModuleProjectContentDirectories("/proj/a")).toEqual(["from-a"]);
    expect(liveModuleProjectContentDirectories("/proj/b")).toEqual(["from-b"]);
    // Re-ensure A re-applies A (even if a process-global would have been B).
    await ensureLiveModulesProjectConfigLoaded("/proj/a");
    expect(liveModuleProjectContentDirectories("/proj/a")).toEqual(["from-a"]);
  });

  it("notifies listeners after applyLiveModulesProjectConfigAfterSave", () => {
    const seen: string[] = [];
    const unsub = subscribeLiveModulesProjectConfigChanged((root) => {
      seen.push(root);
    });
    applyLiveModulesProjectConfigAfterSave("/proj/a", ["designs"]);
    expect(seen).toEqual(["/proj/a"]);
    expect(liveModuleProjectContentDirectories("/proj/a")).toEqual(["designs"]);
    unsub();
  });

  it("does not let a slow ensure overwrite applyAfterSave", async () => {
    let releaseLoad: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    installFilesMock({
      exists: async () => true,
      readDocument: async () => {
        await gate;
        return {
          kind: "text",
          contents: JSON.stringify({
            version: 1,
            contentDirectories: ["stale-from-disk"],
          }),
          revision: "old",
        };
      },
    });

    const ensurePromise = ensureLiveModulesProjectConfigLoaded("/proj/race");
    applyLiveModulesProjectConfigAfterSave("/proj/race", ["saved-list"]);
    expect(liveModuleProjectContentDirectories("/proj/race")).toEqual([
      "saved-list",
    ]);
    releaseLoad?.();
    await ensurePromise;
    expect(liveModuleProjectContentDirectories("/proj/race")).toEqual([
      "saved-list",
    ]);
  });

  it("reads and writes live-modules.json on the git primary checkout", async () => {
    const readRoots: string[] = [];
    const writeRoots: string[] = [];
    installFilesMock({
      worktreeMainPath: "/proj/main",
      exists: async ({ root }) => {
        readRoots.push(`exists:${root}`);
        return root === "/proj/main";
      },
      readDocument: async ({ root }) => {
        readRoots.push(`read:${root}`);
        return {
          kind: "text",
          contents: JSON.stringify({
            version: 1,
            contentDirectories: [".pier/canvases", "docs", "resources"],
          }),
          revision: "rev-main",
        };
      },
      writeDocument: async ({ root }) => {
        writeRoots.push(root);
        return { kind: "written", revision: "rev-2" };
      },
    });

    const loaded = await loadLiveModulesProjectConfig("/proj/worktree");
    expect(loaded.kind).toBe("ok");
    if (loaded.kind !== "ok") {
      return;
    }
    expect(loaded.configRootPath).toBe("/proj/main");
    expect(loaded.contentDirectories).toEqual([
      ".pier/canvases",
      "docs",
      "resources",
    ]);
    expect(readRoots).toEqual(["exists:/proj/main", "read:/proj/main"]);
    expect(liveModuleProjectContentDirectories("/proj/worktree")).toEqual([
      ".pier/canvases",
      "docs",
      "resources",
    ]);
    expect(liveModuleProjectContentDirectories("/proj/main")).toEqual([
      ".pier/canvases",
      "docs",
      "resources",
    ]);

    const saved = await saveLiveModulesProjectConfig({
      projectRootPath: "/proj/worktree",
      contentDirectories: [".pier/canvases", "docs", "resources"],
      expectedRevision: "rev-main",
    });
    expect(saved).toMatchObject({
      kind: "written",
      configRootPath: "/proj/main",
    });
    expect(writeRoots).toEqual(["/proj/main"]);
  });

  it("ignores a worktree-local live-modules.json write", async () => {
    installFilesMock({ worktreeMainPath: "/proj/main" });
    rememberLiveModuleConfigConsumer("/proj/worktree", "/proj/main");
    applyLiveModulesProjectConfigAfterSave("/proj/main", ["designs"]);
    await applyLiveModulesProjectConfigFromDiskContents(
      "/proj/worktree",
      JSON.stringify({
        version: 1,
        contentDirectories: ["from-worktree-copy"],
      })
    );
    expect(liveModuleProjectContentDirectories("/proj/main")).toEqual([
      "designs",
    ]);
    expect(liveModuleProjectContentDirectories("/proj/worktree")).toEqual([
      "designs",
    ]);
  });

  it("notifies worktree consumers after saving on the primary checkout", () => {
    installFilesMock({});
    const seen: string[] = [];
    const unsub = subscribeLiveModulesProjectConfigChanged((root) => {
      seen.push(root);
    });
    rememberLiveModuleConfigConsumer("/proj/worktree", "/proj/main");
    applyLiveModulesProjectConfigAfterSave("/proj/main", ["designs"]);
    expect(seen.sort()).toEqual(["/proj/main", "/proj/worktree"].sort());
    expect(liveModuleProjectContentDirectories("/proj/worktree")).toEqual([
      "designs",
    ]);
    unsub();
  });

  it("recovers invalid on-disk config so settings can overwrite", async () => {
    installFilesMock({
      exists: async () => true,
      readDocument: async () => ({
        kind: "text",
        // unknown key + bad path → schema fail, parseLiveModules falls back
        contents: JSON.stringify({
          version: 99,
          contentDirectories: ["../evil"],
          notAField: true,
        }),
        revision: "bad",
      }),
    });
    const result = await loadLiveModulesProjectConfig("/proj/broken");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.recoveredFromInvalid).toBe(true);
    expect(result.contentDirectories).toEqual([".pier/canvases", "docs"]);
    expect(result.config.version).toBe(1);
  });
});
