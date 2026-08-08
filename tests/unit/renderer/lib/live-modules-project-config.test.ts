import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadLiveModulesProjectConfig,
  saveLiveModulesProjectConfig,
} from "../../../../src/plugins/api/live-modules-project-config.ts";
import {
  applyLiveModulesProjectConfigAfterSave,
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
