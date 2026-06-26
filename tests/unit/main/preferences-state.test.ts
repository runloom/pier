import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("preferences state", () => {
  let tempDir: string;

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
    vi.restoreAllMocks();
    await rm(tempDir, { force: true, recursive: true });
  });

  it("fills schema defaults when reading an older preferences file", async () => {
    await writeFile(
      join(tempDir, "preferences.json"),
      `${JSON.stringify({
        theme: "light",
        stylePresetId: "pierre",
        language: "zh-CN",
        uiFontFamily: "",
        monoFontFamily: "",
        monoFontSize: 13,
      })}\n`
    );
    const { readPreferences } = await import("@main/state/preferences.ts");

    await expect(readPreferences()).resolves.toMatchObject({
      terminalCursorStyle: "block",
      terminalCursorBlink: true,
      terminalScrollbackMb: 64,
      terminalPasteProtection: true,
      terminalNewCwdPolicy: "activeTerminal",
      windowZoomLevel: 0,
    });
  });
});
