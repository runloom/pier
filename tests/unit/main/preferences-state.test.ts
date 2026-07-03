import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import { projectPreferencesSchema } from "@shared/contracts/preferences.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("preferences state", () => {
  let tempDir: string;

  const preferencesPath = () => join(tempDir, "preferences.json");

  async function writePreferences(
    preferences: Record<string, unknown>
  ): Promise<void> {
    await writeFile(preferencesPath(), `${JSON.stringify(preferences)}\n`);
  }

  async function readStoredPreferences(): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(preferencesPath(), "utf-8")) as Record<
      string,
      unknown
    >;
  }

  function completePreferences(
    overrides: Partial<ProjectPreferences>
  ): ProjectPreferences {
    return projectPreferencesSchema.parse(overrides);
  }

  function legacyPreferencesWithBranchPrefix(
    worktreeBranchPrefix: string
  ): Record<string, unknown> {
    return {
      ...completePreferences({}),
      worktreeBranchPrefix,
    };
  }

  async function importPreferencesState() {
    // Dynamic import is required so each test sees the mocked Electron app path.
    return await import("@main/state/preferences.ts");
  }

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "pier-preferences-state-"));
    vi.doMock("electron", () => ({
      app: {
        getPath: vi.fn(() => tempDir),
      },
    }));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(tempDir, { force: true, recursive: true });
  });

  it("does not expose the removed branch prefix when reading an older preferences file", async () => {
    await writePreferences({
      theme: "light",
      stylePresetId: "pierre",
      language: "zh-CN",
      uiFontFamily: "",
      monoFontFamily: "",
      monoFontSize: 13,
      worktreeBranchPrefix: "wt/",
    });
    const { readPreferences } = await importPreferencesState();

    const prefs = await readPreferences();

    expect(prefs).toMatchObject({
      terminalCursorStyle: "block",
      terminalCursorBlink: true,
      terminalScrollbackMb: 64,
      terminalPasteProtection: true,
      terminalNewCwdPolicy: "activeTerminal",
      windowZoomLevel: 0,
    });
    expect(prefs).not.toHaveProperty("worktreeBranchPrefix");
  });

  it("drops the legacy wt worktree branch prefix when normalizing stored preferences", async () => {
    await writePreferences(legacyPreferencesWithBranchPrefix("wt/"));
    const { readPreferences } = await importPreferencesState();

    await expect(readPreferences()).resolves.not.toHaveProperty(
      "worktreeBranchPrefix"
    );
  });

  it("rewrites the legacy wt worktree branch prefix removal to disk", async () => {
    vi.useFakeTimers();
    await writePreferences(legacyPreferencesWithBranchPrefix("wt/"));
    const { readPreferences } = await importPreferencesState();

    await readPreferences();
    await vi.advanceTimersByTimeAsync(500);

    await vi.waitFor(async () => {
      await expect(readStoredPreferences()).resolves.not.toHaveProperty(
        "worktreeBranchPrefix"
      );
    });
  });

  it("drops custom legacy worktree branch prefixes when normalizing stored preferences", async () => {
    await writePreferences(legacyPreferencesWithBranchPrefix("feature/"));
    const { readPreferences } = await importPreferencesState();

    await expect(readPreferences()).resolves.not.toHaveProperty(
      "worktreeBranchPrefix"
    );
  });
});
