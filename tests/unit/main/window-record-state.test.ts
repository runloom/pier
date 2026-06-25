import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("window record state", () => {
  let userDataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    userDataDir = await mkdtemp(join(tmpdir(), "pier-window-record-state-"));
    vi.doMock("electron", () => ({
      app: {
        getPath: vi.fn((name: string) => {
          if (name !== "userData") {
            throw new Error(`unexpected app path: ${name}`);
          }
          return userDataDir;
        }),
      },
    }));
  });

  afterEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(userDataDir, { force: true, recursive: true });
  });

  it("tracks open and recently closed window records without deleting layout", async () => {
    const {
      createWindowRecord,
      markWindowRecordClosed,
      markWindowRecordOpen,
      readMostRecentClosedWindowRecordId,
      readOpenWindowRecordIds,
      readWindowRecordLayout,
      saveWindowRecordLayout,
    } = await import("@main/state/window-record-state.ts");

    const first = await createWindowRecord();
    const second = await createWindowRecord();
    await markWindowRecordOpen(first.id);
    await markWindowRecordOpen(second.id);
    await saveWindowRecordLayout(first.id, {
      grid: { root: "first-layout" },
    });

    await expect(readOpenWindowRecordIds()).resolves.toEqual([
      first.id,
      second.id,
    ]);

    await markWindowRecordClosed(first.id);

    await expect(readOpenWindowRecordIds()).resolves.toEqual([second.id]);
    await expect(readMostRecentClosedWindowRecordId()).resolves.toBe(first.id);
    await expect(readWindowRecordLayout(first.id)).resolves.toEqual({
      grid: { root: "first-layout" },
    });

    await markWindowRecordClosed(second.id);

    await expect(readOpenWindowRecordIds()).resolves.toEqual([]);
    await expect(readMostRecentClosedWindowRecordId()).resolves.toBe(second.id);
  });
});
