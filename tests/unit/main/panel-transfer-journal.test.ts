import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyPanelTransferJournal,
  loadPanelTransferJournal,
  PanelTransferJournal,
  writePanelTransferJournal,
} from "@main/state/panel-transfer-journal.ts";
import { describe, expect, it } from "vitest";

const TRANSFER_ID = "11111111-1111-4111-8111-111111111111";

function sampleRecord() {
  return {
    createdAt: 1,
    offer: {
      capability: "movable" as const,
      panel: {
        componentId: "welcome",
        panelId: "panel-1",
        title: "Welcome",
      },
      transferId: TRANSFER_ID,
      version: 1 as const,
    },
    phase: "claimed" as const,
    source: {
      navigationGeneration: 0,
      runtimeWindowId: "main",
      webContentsId: 1,
      windowRecordId: "record-main",
    },
    target: {
      kind: "managed" as const,
      runtimeWindowId: "w-1",
      windowRecordId: "record-target",
    },
    targetPanelId: "panel-1",
    transferId: TRANSFER_ID,
    updatedAt: 2,
  };
}

describe("panel-transfer-journal", () => {
  it("writes and loads durable journal records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-ptj-"));
    const journal = new PanelTransferJournal(dir);
    await journal.upsert(sampleRecord());
    await journal.flush();

    const loaded = await loadPanelTransferJournal(journal.filePath);
    expect(loaded.kind).toBe("ok");
    if (loaded.kind !== "ok") {
      return;
    }
    expect(loaded.file.transfers).toHaveLength(1);
    expect(loaded.file.transfers[0]?.transferId).toBe(TRANSFER_ID);
  });

  it("does not wipe corrupt journal on parse failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-ptj-bad-"));
    const filePath = join(dir, "panel-transfers.json");
    await writeFile(filePath, "{not-json", "utf8");

    const journal = new PanelTransferJournal(dir);
    await journal.init();
    expect(journal.parseFailure?.path).toBe(filePath);
    expect(journal.list()).toEqual([]);

    await expect(journal.upsert(sampleRecord())).rejects.toThrow(/unreadable/);
    const raw = await readFile(filePath, "utf8");
    expect(raw).toBe("{not-json");
  });

  it("rejects unsupported offers in journal schema", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-ptj-un-"));
    const filePath = join(dir, "panel-transfers.json");
    await expect(
      writePanelTransferJournal(filePath, {
        transfers: [
          {
            ...sampleRecord(),
            offer: {
              capability: "unsupported",
              panel: {
                componentId: "x",
                panelId: "p",
                title: "t",
              },
              transferId: TRANSFER_ID,
              version: 1,
            },
          } as never,
        ],
        version: 1,
      })
    ).rejects.toThrow();
  });

  it("remove deletes only the matching transfer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-ptj-rm-"));
    const journal = new PanelTransferJournal(dir);
    await journal.upsert(sampleRecord());
    await journal.remove(TRANSFER_ID);
    await journal.flush();
    expect(journal.list()).toEqual([]);
    expect(emptyPanelTransferJournal()).toEqual({ transfers: [], version: 1 });
  });
});
