import { notifyFilesProjectDirectoryOpened } from "@plugins/api/files-project-directory-opened.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  projectDirectoryRevealForTests,
  registerFilesProjectDirectoryReveal,
} from "../../../../../src/plugins/builtin/files/renderer/project/open-directory-reveal.ts";
import {
  clearFileTreeSidebarCache,
  registerFilesTreeInstance,
  tryRevealFilesTreePathOnce,
} from "../../../../../src/plugins/builtin/files/renderer/tree/registry.ts";
import { waitUntilRevealReady } from "../../../../../src/plugins/builtin/files/renderer/tree/reveal.ts";

vi.mock(
  "../../../../../src/plugins/builtin/files/renderer/tree/reveal.ts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../../src/plugins/builtin/files/renderer/tree/reveal.ts")
      >();
    return {
      ...actual,
      ensureFilesTreeAncestorsLoaded: vi.fn(async () => undefined),
    };
  }
);

vi.mock(
  "../../../../../src/plugins/builtin/files/renderer/tree/preferences.ts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../../src/plugins/builtin/files/renderer/tree/preferences.ts")
      >();
    return {
      ...actual,
      ensureProjectFileTreeExpanded: vi.fn(),
    };
  }
);

vi.mock(
  "../../../../../src/plugins/builtin/files/renderer/tree/visibility.ts",
  () => ({
    filesTreeVisibilityForContext: () => ({
      isPathHiddenByGitIgnore: async () => false,
      list: vi.fn(),
      pinPath: () => false,
    }),
  })
);

const ROOT = "/repo";

function treeEntry(revealPath: ReturnType<typeof vi.fn>) {
  return {
    collapseAll: () => undefined,
    expandKnownDirectories: () => undefined,
    getApi: () =>
      ({
        revealPath,
      }) as never,
    openSearch: () => undefined,
    root: ROOT,
    toggleSearch: () => undefined,
  };
}

describe("revealCandidatePaths", () => {
  it("returns root for an empty path", () => {
    expect(
      projectDirectoryRevealForTests.revealCandidatePaths("", false)
    ).toEqual([""]);
  });

  it("walks nearest parent first then root", () => {
    expect(
      projectDirectoryRevealForTests.revealCandidatePaths(
        "src/foo/bar.ts",
        false
      )
    ).toEqual(["src/foo/bar.ts", "src/foo", "src", ""]);
  });

  it("skips the leaf when asked", () => {
    expect(
      projectDirectoryRevealForTests.revealCandidatePaths(
        "src/foo/bar.ts",
        true
      )
    ).toEqual(["src/foo", "src", ""]);
  });

  it("falls through to root for a missing root-level file", () => {
    expect(
      projectDirectoryRevealForTests.revealCandidatePaths("gone.ts", true)
    ).toEqual([""]);
  });
});

describe("tryRevealFilesTreePathOnce fallbackToRoot", () => {
  afterEach(() => {
    clearFileTreeSidebarCache();
  });

  it("does not fall back to the last same-root tree when disabled", () => {
    const editorReveal = vi.fn(() => true);
    const directoryReveal = vi.fn(() => true);
    registerFilesTreeInstance("editor-group", treeEntry(editorReveal));
    registerFilesTreeInstance("directory-group", treeEntry(directoryReveal));
    expect(
      tryRevealFilesTreePathOnce({
        fallbackToRoot: false,
        instanceId: "missing-id",
        path: "src/a.ts",
        root: ROOT,
      })
    ).toBe(false);
    expect(editorReveal).not.toHaveBeenCalled();
    expect(directoryReveal).not.toHaveBeenCalled();
  });

  it("falls back to the last same-root tree by default", () => {
    const editorReveal = vi.fn(() => true);
    registerFilesTreeInstance("editor-group", treeEntry(editorReveal));
    expect(
      tryRevealFilesTreePathOnce({
        instanceId: "stale-id",
        path: "src/a.ts",
        root: ROOT,
      })
    ).toBe(true);
    expect(editorReveal).toHaveBeenCalled();
  });
});

describe("registerFilesProjectDirectoryReveal", () => {
  const directoryReveal = vi.fn(() => true);
  const editorReveal = vi.fn(() => true);

  beforeEach(() => {
    directoryReveal.mockClear();
    editorReveal.mockClear();
    directoryReveal.mockReturnValue(true);
    editorReveal.mockReturnValue(true);
    clearFileTreeSidebarCache();
    registerFilesTreeInstance("editor-group", treeEntry(editorReveal));
    registerFilesTreeInstance("directory-group", treeEntry(directoryReveal));
  });

  afterEach(() => {
    clearFileTreeSidebarCache();
  });

  it("reveals the directory group's tree, not a sibling editor tree", async () => {
    const context = {
      files: {
        stat: vi.fn(async () => ({ exists: true })),
      },
      i18n: {
        t: (_key: string, _values?: unknown, fallback?: string) => fallback,
      },
      panels: {
        listInstances: () => [
          {
            groupId: "directory-group",
            id: "pier.files.filePanel:project:abc",
          },
        ],
      },
    } as never;
    const dispose = registerFilesProjectDirectoryReveal(context);
    notifyFilesProjectDirectoryOpened({
      instanceId: "pier.files.filePanel:project:abc",
      path: "src/a.ts",
      root: ROOT,
    });
    await vi.waitFor(() => {
      expect(directoryReveal).toHaveBeenCalled();
    });
    expect(editorReveal).not.toHaveBeenCalled();
    dispose();
  });
});

describe("waitUntilRevealReady", () => {
  afterEach(() => {
    clearFileTreeSidebarCache();
    vi.useRealTimers();
  });

  it("re-resolves the registry key on later polls and re-reveals after paint", async () => {
    vi.useFakeTimers();
    const revealPath = vi.fn(() => true);
    registerFilesTreeInstance("directory-group", treeEntry(revealPath));
    let calls = 0;
    const resolveInstanceId = vi.fn(() => {
      calls += 1;
      return calls === 1 ? "missing" : "directory-group";
    });
    const ready = waitUntilRevealReady({
      fallbackToRoot: false,
      path: "src/a.ts",
      resolveInstanceId,
      root: ROOT,
    });
    await vi.advanceTimersByTimeAsync(16);
    await expect(ready).resolves.toBe(true);
    expect(revealPath).toHaveBeenCalled();
    await Promise.resolve();
    expect(revealPath.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("does not last-chance fall back to another same-root tree", async () => {
    vi.useFakeTimers();
    const editorReveal = vi.fn(() => true);
    registerFilesTreeInstance("editor-group", treeEntry(editorReveal));
    const ready = waitUntilRevealReady({
      fallbackToRoot: false,
      instanceId: "missing",
      path: "src/a.ts",
      root: ROOT,
    });
    await vi.runAllTimersAsync();
    await expect(ready).resolves.toBe(false);
    expect(editorReveal).not.toHaveBeenCalled();
  });
});
