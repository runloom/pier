import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverPendingTransfers } from "@main/services/panel-transfer/recovery.ts";
import type { PanelTransferTransactionDeps } from "@main/services/panel-transfer/transaction.ts";
import type { PanelTransferJournalRecord } from "@main/services/panel-transfer/types.ts";
import { PanelTransferJournal } from "@main/state/panel-transfer-journal.ts";
import type { RendererCommandResult } from "@shared/contracts/renderer-command.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TRANSFER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function okResult(): RendererCommandResult {
  return { data: null, ok: true, requestId: "r1" };
}

describe("panel transfer recovery — copy mode", () => {
  let journal: PanelTransferJournal;
  let releaseSource: ReturnType<
    typeof vi.fn<
      (input: {
        sourcePanelId: string;
        transferId: string;
        windowId: string;
      }) => Promise<RendererCommandResult>
    >
  >;
  let deps: PanelTransferTransactionDeps;

  beforeEach(async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "pier-recovery-copy-"));
    journal = new PanelTransferJournal(userDataDir);
    await journal.init();
    releaseSource = vi.fn(async () => okResult());
    deps = {
      files: {
        commitDrafts: vi.fn(async () => undefined),
        rollbackDrafts: vi.fn(async () => undefined),
        stageDrafts: vi.fn(async () => undefined),
      },
      journal,
      renderer: {
        finalize: vi.fn(async () => okResult()),
        prepareSource: vi.fn(async () => okResult()),
        probeWorkspace: vi.fn(async () => okResult()),
        releaseSource,
        resolveDefaultPlacement: vi.fn(async () => okResult()),
        resolvePlacement: vi.fn(async () => okResult()),
        stageTarget: vi.fn(async () => okResult()),
      },
      terminal: {
        commitMove: vi.fn(async () => undefined),
        getCurrentLifecycleId: vi.fn(() => ""),
        rollback: vi.fn(async () => undefined),
        stageLease: vi.fn(async () => undefined),
      },
      windows: {
        closeAfterTransfer: vi.fn(async () => undefined),
        closeOpenWindowRecord: vi.fn(async () => undefined),
        createForTransfer: vi.fn(async () => ({
          recordId: "r",
          windowId: "w",
        })),
        destroyForTransfer: vi.fn(async () => undefined),
        focus: vi.fn(),
        holdRendererShow: vi.fn(),
        list: vi.fn(() => [
          { focused: true, id: "main", recordId: "record-main" },
          { focused: false, id: "w-1", recordId: "record-w1" },
        ]),
        releaseRendererShow: vi.fn(),
        runExclusive: vi.fn(async (op) => op({ token: Symbol("lease") })),
      },
      workspace: {
        clearLayout: vi.fn(async () => undefined),
        hasPanelId: vi.fn(async () => false),
      },
    };
  });

  function baseRecord(mode: "move" | "copy"): PanelTransferJournalRecord {
    return {
      createdAt: 1,
      offer: {
        capability: "movable",
        mode,
        panel: {
          componentId: "pier.files.filePanel",
          panelId: "files-1",
          title: "a.ts",
        },
        transferId: TRANSFER_ID,
        version: 1,
      },
      phase: "runtime-moved",
      placement: { kind: "root" },
      snapshot: {
        panel: {
          componentId: "pier.files.filePanel",
          panelId: "files-1",
          title: "a.ts",
        },
        prepared: { drafts: [] },
        runtime: { kind: "web" },
      },
      source: {
        navigationGeneration: 1,
        runtimeWindowId: "main",
        webContentsId: 1,
        windowRecordId: "record-main",
      },
      target: {
        kind: "managed",
        runtimeWindowId: "w-1",
        windowRecordId: "record-w1",
      },
      targetPanelId: mode === "copy" ? "files-copy" : "files-1",
      transferId: TRANSFER_ID,
      updatedAt: 1,
    };
  }

  it("does not releaseSource for copy at runtime-moved", async () => {
    await journal.upsert(baseRecord("copy"));
    await recoverPendingTransfers({ deps, journal });
    expect(releaseSource).not.toHaveBeenCalled();
    expect(journal.get(TRANSFER_ID)?.phase).toBe("source-durable");
  });

  it("still releaseSource for move at runtime-moved", async () => {
    await journal.upsert(baseRecord("move"));
    await recoverPendingTransfers({ deps, journal });
    expect(releaseSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePanelId: "files-1",
        transferId: TRANSFER_ID,
        windowId: "main",
      })
    );
    expect(journal.get(TRANSFER_ID)?.phase).toBe("source-durable");
  });
});
