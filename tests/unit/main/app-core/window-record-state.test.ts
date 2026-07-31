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

  it("does not resolve layout save until a fresh store can read it", async () => {
    const { createWindowRecord, saveWindowRecordLayout } = await import(
      "@main/state/window-record-state.ts"
    );
    const record = await createWindowRecord();

    await saveWindowRecordLayout(record.id, { durable: true });
    vi.resetModules();
    const { readWindowRecordLayout } = await import(
      "@main/state/window-record-state.ts"
    );

    await expect(readWindowRecordLayout(record.id)).resolves.toEqual({
      durable: true,
    });
  });

  it("orders open records by the last focused open window without mutating the open set", async () => {
    const {
      createWindowRecord,
      markWindowRecordClosed,
      markWindowRecordFocused,
      markWindowRecordOpen,
      readOpenWindowRecordIds,
      readPreferredOpenWindowRecordIds,
    } = await import("@main/state/window-record-state.ts");

    const first = await createWindowRecord();
    const second = await createWindowRecord();
    const third = await createWindowRecord();
    await markWindowRecordOpen(first.id);
    await markWindowRecordOpen(second.id);
    await markWindowRecordOpen(third.id);

    await markWindowRecordFocused(second.id);

    await expect(readPreferredOpenWindowRecordIds()).resolves.toEqual([
      second.id,
      first.id,
      third.id,
    ]);
    await expect(readOpenWindowRecordIds()).resolves.toEqual([
      first.id,
      second.id,
      third.id,
    ]);

    await markWindowRecordClosed(second.id);

    await expect(readPreferredOpenWindowRecordIds()).resolves.toEqual([
      first.id,
      third.id,
    ]);

    await markWindowRecordFocused("missing-record");

    await expect(readPreferredOpenWindowRecordIds()).resolves.toEqual([
      first.id,
      third.id,
    ]);
  });
});
