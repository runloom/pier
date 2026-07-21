import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RECORD_A = "3f11de0e-6bd9-4281-8c3c-c178cd81f1a0";
const RECORD_B = "33da025e-7acb-4857-93c3-e1f9c71ce79e";

function panelEntry(title: string) {
  return { title, updatedAt: "2026-07-20T00:00:00.000Z" };
}

describe("terminal session scope migration", () => {
  let userDataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    userDataDir = await mkdtemp(join(tmpdir(), "pier-session-migrate-"));
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

  async function seedStore(windows: Record<string, unknown>): Promise<void> {
    await writeFile(
      join(userDataDir, "terminal-session-state.json"),
      JSON.stringify({ version: 1, windows }),
      "utf8"
    );
  }

  async function loadMigration() {
    return await import("@main/state/terminal-session-scope-migration.ts");
  }

  async function readStoreWindows(): Promise<Record<string, unknown>> {
    const raw = await readFile(
      join(userDataDir, "terminal-session-state.json"),
      "utf8"
    );
    return (JSON.parse(raw) as { windows: Record<string, unknown> }).windows;
  }

  it("maps legacy runtime keys to records in preferred restore order", async () => {
    await seedStore({
      main: { panels: { "terminal-1": panelEntry("from main") } },
      "w-1": { panels: { "terminal-2": panelEntry("from w-1") } },
    });
    const { migrateTerminalSessionScopesToRecordIds } = await loadMigration();
    await migrateTerminalSessionScopesToRecordIds([RECORD_A, RECORD_B]);

    const windows = await readStoreWindows();
    expect(Object.keys(windows).sort()).toEqual([RECORD_B, RECORD_A].sort());
    expect(windows[RECORD_A]).toMatchObject({
      panels: { "terminal-1": { title: "from main" } },
    });
    expect(windows[RECORD_B]).toMatchObject({
      panels: { "terminal-2": { title: "from w-1" } },
    });
  });

  it("drops unmappable runtime keys and keeps record-keyed entries", async () => {
    await seedStore({
      [RECORD_A]: { panels: { "terminal-9": panelEntry("already record") } },
      "w-7": { panels: { "terminal-ghost": panelEntry("orphan") } },
    });
    const { migrateTerminalSessionScopesToRecordIds } = await loadMigration();
    await migrateTerminalSessionScopesToRecordIds([RECORD_A]);

    const windows = await readStoreWindows();
    expect(Object.keys(windows)).toEqual([RECORD_A]);
    expect(windows[RECORD_A]).toMatchObject({
      panels: { "terminal-9": { title: "already record" } },
    });
  });

  it("merges into existing record scope with record entries winning", async () => {
    await seedStore({
      main: {
        panels: {
          "terminal-1": panelEntry("legacy value"),
          "terminal-legacy-only": panelEntry("legacy only"),
        },
      },
      [RECORD_A]: {
        panels: { "terminal-1": panelEntry("record value") },
      },
    });
    const { migrateTerminalSessionScopesToRecordIds } = await loadMigration();
    await migrateTerminalSessionScopesToRecordIds([RECORD_A]);

    const windows = await readStoreWindows();
    expect(windows[RECORD_A]).toMatchObject({
      panels: {
        "terminal-1": { title: "record value" },
        "terminal-legacy-only": { title: "legacy only" },
      },
    });
  });

  it("is a no-op when no legacy keys remain", async () => {
    await seedStore({
      [RECORD_A]: { panels: { "terminal-1": panelEntry("stable") } },
    });
    const { migrateTerminalSessionScopesToRecordIds } = await loadMigration();
    await migrateTerminalSessionScopesToRecordIds([RECORD_A, RECORD_B]);

    const windows = await readStoreWindows();
    expect(Object.keys(windows)).toEqual([RECORD_A]);
  });
});
