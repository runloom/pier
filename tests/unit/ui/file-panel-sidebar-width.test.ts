import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FILE_PANEL_DEFAULT_SIDEBAR_WIDTH_PX,
  FILE_PANEL_LEGACY_SIDEBAR_WIDTH_STORAGE_KEYS,
  FILE_PANEL_MIN_SIDEBAR_WIDTH_PX,
  FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY,
  persistMigratedSidebarWidth,
  readSidebarWidth,
  resetFilePanelSidebarWidthListenersForTests,
  subscribeSidebarWidth,
  writeSidebarWidth,
} from "@pier/ui/file/panel-sidebar-width.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../..");
const MIN = FILE_PANEL_MIN_SIDEBAR_WIDTH_PX;
const DEFAULT = FILE_PANEL_DEFAULT_SIDEBAR_WIDTH_PX;

afterEach(() => {
  resetFilePanelSidebarWidthListenersForTests();
  localStorage.clear();
});

describe("file panel sidebar width", () => {
  beforeEach(() => {
    localStorage.clear();
    resetFilePanelSidebarWidthListenersForTests();
  });

  it("falls back to the default width when nothing is stored", () => {
    expect(
      readSidebarWidth(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, DEFAULT, MIN)
    ).toBe(DEFAULT);
  });

  it("reads the shared key before legacy Files or Git keys", () => {
    localStorage.setItem(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, "300");
    localStorage.setItem(
      FILE_PANEL_LEGACY_SIDEBAR_WIDTH_STORAGE_KEYS[0],
      "280"
    );
    localStorage.setItem(
      FILE_PANEL_LEGACY_SIDEBAR_WIDTH_STORAGE_KEYS[1],
      "220"
    );

    expect(
      readSidebarWidth(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, DEFAULT, MIN)
    ).toBe(300);
  });

  it("migrates a Files width when the shared key is missing", () => {
    localStorage.setItem(
      FILE_PANEL_LEGACY_SIDEBAR_WIDTH_STORAGE_KEYS[0],
      "280"
    );
    localStorage.setItem(
      FILE_PANEL_LEGACY_SIDEBAR_WIDTH_STORAGE_KEYS[1],
      "220"
    );

    expect(
      readSidebarWidth(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, DEFAULT, MIN)
    ).toBe(280);
  });

  it("migrates a Git width when only the review key exists", () => {
    localStorage.setItem(
      FILE_PANEL_LEGACY_SIDEBAR_WIDTH_STORAGE_KEYS[1],
      "220"
    );

    expect(
      readSidebarWidth(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, DEFAULT, MIN)
    ).toBe(220);
  });

  it("ignores stored values below the minimum width", () => {
    localStorage.setItem(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, "80");

    expect(
      readSidebarWidth(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, DEFAULT, MIN)
    ).toBe(DEFAULT);
  });

  it("does not read legacy keys for an isolated storage key", () => {
    localStorage.setItem(
      FILE_PANEL_LEGACY_SIDEBAR_WIDTH_STORAGE_KEYS[0],
      "280"
    );

    expect(readSidebarWidth("test.tree-width", DEFAULT, MIN)).toBe(DEFAULT);
  });

  it("copies a legacy Files width into the shared key once", () => {
    localStorage.setItem(
      FILE_PANEL_LEGACY_SIDEBAR_WIDTH_STORAGE_KEYS[0],
      "280"
    );

    persistMigratedSidebarWidth(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, MIN);

    expect(localStorage.getItem(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY)).toBe(
      "280"
    );
  });

  it("does not invent a stored width from the default", () => {
    persistMigratedSidebarWidth(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, MIN);

    expect(
      localStorage.getItem(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY)
    ).toBeNull();
  });

  it("does not overwrite an existing shared width with a legacy key", () => {
    localStorage.setItem(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, "300");
    localStorage.setItem(
      FILE_PANEL_LEGACY_SIDEBAR_WIDTH_STORAGE_KEYS[0],
      "280"
    );

    persistMigratedSidebarWidth(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, MIN);

    expect(localStorage.getItem(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY)).toBe(
      "300"
    );
  });

  it("skips no-op writes so listeners are not re-entered", () => {
    const listener = vi.fn();
    const stop = subscribeSidebarWidth(
      FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY,
      listener
    );
    writeSidebarWidth(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, 300);
    writeSidebarWidth(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, 300.4);

    expect(localStorage.getItem(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY)).toBe(
      "300"
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(300);
    stop();
  });

  it("notifies same-window subscribers and stops after unsubscribe", () => {
    const listener = vi.fn();
    const stop = subscribeSidebarWidth(
      FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY,
      listener
    );
    writeSidebarWidth(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, 312);
    stop();
    writeSidebarWidth(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, 330);

    expect(listener).toHaveBeenCalledExactlyOnceWith(312);
  });

  it("does not cross-talk between storage keys", () => {
    const listener = vi.fn();
    const stop = subscribeSidebarWidth("test.other-tree-width", listener);
    writeSidebarWidth(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, 312);
    stop();

    expect(listener).not.toHaveBeenCalled();
  });

  it("applies storage events from other windows", () => {
    const listener = vi.fn();
    const stop = subscribeSidebarWidth(
      FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY,
      listener
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY,
        newValue: "340",
      })
    );
    stop();

    expect(listener).toHaveBeenCalledExactlyOnceWith(340);
  });

  it("keeps Files and Git review on the shared FilePanelLayout width", () => {
    const filesParts = readFileSync(
      join(REPO_ROOT, "src/plugins/builtin/files/renderer/panel/parts.tsx"),
      "utf8"
    );
    const gitLayout = readFileSync(
      join(
        REPO_ROOT,
        "src/plugins/builtin/git/renderer/review/panel-layout.tsx"
      ),
      "utf8"
    );
    const sharedLayout = readFileSync(
      join(REPO_ROOT, "packages/ui/src/file/panel-layout.tsx"),
      "utf8"
    );

    expect(filesParts).not.toMatch(/treeWidthPx/);
    expect(gitLayout).not.toMatch(/treeWidthPx/);
    expect(filesParts).not.toContain("sidebarWidthStorageKey");
    expect(gitLayout).not.toContain("sidebarWidthStorageKey");
    expect(sharedLayout).toContain(
      "sidebarWidthStorageKey = FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY"
    );
    expect(sharedLayout).toContain("meta.isUserInteraction");
    expect(sharedLayout).toContain("hostWidthPx() <= 0");
  });
});
