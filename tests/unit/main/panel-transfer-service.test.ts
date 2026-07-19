import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPanelTransferService } from "@main/services/panel-transfer/panel-transfer-service.ts";
import type {
  PanelTransferCaller,
  PanelTransferFilesPort,
  PanelTransferGeometryPort,
  PanelTransferTerminalPort,
  PanelTransferWindowPort,
  PanelTransferWorkspacePort,
} from "@main/services/panel-transfer/panel-transfer-types.ts";
import type { WindowTransitionLease } from "@main/services/window-service.ts";
import { PanelTransferJournal } from "@main/state/panel-transfer-journal.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TRANSFER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRANSFER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function caller(
  windowId: string,
  recordId: string,
  webContentsId: number
): PanelTransferCaller {
  return {
    navigationGeneration: 1,
    runtimeWindowId: windowId,
    webContentsId,
    windowRecordId: recordId,
  };
}

function movableOffer(transferId: string, panelId = "panel-1") {
  return {
    capability: "movable" as const,
    panel: {
      componentId: "welcome",
      panelId,
      title: "Welcome",
    },
    transferId,
    version: 1 as const,
  };
}

describe("PanelTransferService", () => {
  let userDataDir: string;
  let journal: PanelTransferJournal;
  let lease: WindowTransitionLease;
  let windows: PanelTransferWindowPort;
  let geometry: PanelTransferGeometryPort;
  let workspace: PanelTransferWorkspacePort;
  let files: PanelTransferFilesPort;
  let terminal: PanelTransferTerminalPort;
  let rendererExecute: ReturnType<typeof vi.fn>;
  let createForTransfer: ReturnType<typeof vi.fn>;
  let runExclusive: ReturnType<typeof vi.fn>;
  let pluginMutation: ReturnType<typeof vi.fn>;
  let now: number;
  let cursor: { x: number; y: number };

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), "pier-pts-"));
    journal = new PanelTransferJournal(userDataDir);
    lease = { token: Symbol("lease") };
    now = 1000;
    cursor = { x: 5000, y: 5000 };
    createForTransfer = vi.fn(async () => ({
      recordId: "record-new",
      windowId: "w-new",
    }));
    runExclusive = vi.fn(async (operation) => operation(lease));
    pluginMutation = vi.fn(async (operation) => operation());
    windows = {
      closeAfterTransfer: vi.fn(async () => undefined),
      createForTransfer,
      destroyForTransfer: vi.fn(async () => undefined),
      holdRendererShow: vi.fn(),
      list: vi.fn(() => [
        { focused: true, id: "main", recordId: "record-main" },
        { focused: false, id: "w-1", recordId: "record-w1" },
      ]),
      releaseRendererShow: vi.fn(),
      runExclusive,
    };
    geometry = {
      getCursorScreenPoint: () => cursor,
      getDisplayWorkAreaNear: () => ({ height: 1000, width: 1600, x: 0, y: 0 }),
      getWindowBounds: (windowId) => {
        if (windowId === "main") {
          return { height: 800, width: 1200, x: 0, y: 0 };
        }
        if (windowId === "w-1") {
          return { height: 800, width: 1200, x: 1300, y: 0 };
        }
        return null;
      },
    };
    workspace = {
      clearLayout: vi.fn(async () => undefined),
      hasPanelId: vi.fn(async () => false),
    };
    files = {
      commitDrafts: vi.fn(async () => undefined),
      rollbackDrafts: vi.fn(async () => undefined),
      stageDrafts: vi.fn(async () => undefined),
    };
    terminal = {
      commitMove: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      stageLease: vi.fn(async () => undefined),
    };
    rendererExecute = vi.fn(async (command: { type: string }) => {
      if (command.type === "panelTransfer.prepareSource") {
        return {
          data: {
            panel: {
              componentId: "welcome",
              panelId: "panel-1",
              title: "Welcome",
            },
            prepared: {},
            runtime: { kind: "web" },
          },
          ok: true,
          requestId: "r1",
        };
      }
      return { data: null, ok: true, requestId: "r1" };
    });
  });

  function createService(sleepImpl?: (ms: number) => Promise<void>) {
    return createPanelTransferService({
      files,
      geometry,
      journal,
      now: () => now,
      pluginMutation,
      rendererCommand: {
        execute: rendererExecute,
        resolve: () => undefined,
      },
      sleep: sleepImpl ?? (async () => undefined),
      terminal,
      userDataDir,
      windows,
      workspace,
    });
  }

  it("accepts movable offers and rejects unsupported without journal", async () => {
    const service = createService();
    const source = caller("main", "record-main", 1);
    await expect(
      service.offer(source, movableOffer(TRANSFER_A))
    ).resolves.toEqual({ accepted: true });
    await expect(
      service.offer(source, {
        capability: "unsupported",
        panel: { componentId: "x", panelId: "p", title: "t" },
        transferId: TRANSFER_B,
        version: 1,
      })
    ).resolves.toEqual({ accepted: false });
    expect(journal.list()).toEqual([]);
  });

  it("tryClaim is unique; second different claim is already_claimed", async () => {
    const service = createService();
    const source = caller("main", "record-main", 1);
    const targetA = caller("w-1", "record-w1", 2);
    const targetB = caller("w-2", "record-w2", 3);
    await service.offer(source, movableOffer(TRANSFER_A));

    const first = service.drop(targetA, {
      placement: { kind: "root" },
      transferId: TRANSFER_A,
    });
    const second = await service.drop(targetB, {
      placement: { kind: "root" },
      transferId: TRANSFER_A,
    });
    expect(second).toEqual({
      code: "already_claimed",
      message: "transfer already claimed",
      ok: false,
    });
    await expect(first).resolves.toMatchObject({
      ok: true,
      targetPanelId: "panel-1",
    });
  });

  it("unsupported finishDrag returns not_supported and never creates window", async () => {
    const service = createService();
    const source = caller("main", "record-main", 1);
    await service.offer(source, {
      capability: "unsupported",
      panel: { componentId: "x", panelId: "p", title: "t" },
      transferId: TRANSFER_A,
      version: 1,
    });
    await expect(service.finishDrag(source, TRANSFER_A)).resolves.toEqual({
      code: "not_supported",
      message: "panel transfer not supported",
      ok: false,
    });
    expect(createForTransfer).not.toHaveBeenCalled();
  });

  it("finishDrag returns null when managed drop already claimed", async () => {
    let releaseDrop!: () => void;
    const dropGate = new Promise<void>((resolve) => {
      releaseDrop = resolve;
    });
    // Keep runner blocked so claim stays live during finishDrag.
    runExclusive.mockImplementationOnce(async (operation) => {
      await dropGate;
      return operation(lease);
    });
    const service = createService(async () => undefined);
    const source = caller("main", "record-main", 1);
    const target = caller("w-1", "record-w1", 2);
    await service.offer(source, movableOffer(TRANSFER_A));
    const dropPromise = service.drop(target, {
      placement: { kind: "root" },
      transferId: TRANSFER_A,
    });
    await Promise.resolve();
    await expect(service.finishDrag(source, TRANSFER_A)).resolves.toBeNull();
    releaseDrop();
    await dropPromise;
  });

  it("finishDrag outside cursor creates transfer window via createForTransfer", async () => {
    cursor = { x: 5000, y: 5000 }; // outside both windows
    const service = createService(async () => undefined);
    const source = caller("main", "record-main", 1);
    await service.offer(source, movableOffer(TRANSFER_A));
    const result = await service.finishDrag(source, TRANSFER_A);
    expect(createForTransfer).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, targetPanelId: "panel-1" });
    expect(runExclusive).toHaveBeenCalled();
    expect(pluginMutation).toHaveBeenCalled();
  });

  it("rolls back before runtime-moved and roll-forwards after", async () => {
    const service = createService(async () => undefined);
    const source = caller("main", "record-main", 1);
    const target = caller("w-1", "record-w1", 2);
    await service.offer(source, movableOffer(TRANSFER_A));

    rendererExecute.mockImplementation(async (command: { type: string }) => {
      if (command.type === "panelTransfer.prepareSource") {
        return {
          data: {
            panel: {
              componentId: "welcome",
              panelId: "panel-1",
              title: "Welcome",
            },
            prepared: {},
            runtime: { kind: "web" },
          },
          ok: true,
          requestId: "r1",
        };
      }
      if (command.type === "panelTransfer.stageTarget") {
        return {
          error: { message: "stage failed" },
          ok: false,
          requestId: "r1",
        };
      }
      return { data: null, ok: true, requestId: "r1" };
    });

    await expect(
      service.drop(target, {
        placement: { kind: "root" },
        transferId: TRANSFER_A,
      })
    ).resolves.toMatchObject({ ok: false, code: "transfer_failed" });
    expect(journal.list()).toEqual([]);

    // post-commit recovery path via ready
    await journal.upsert({
      createdAt: 1,
      offer: movableOffer(TRANSFER_B),
      phase: "runtime-moved",
      placement: { kind: "root" },
      snapshot: {
        panel: movableOffer(TRANSFER_B).panel,
        prepared: {},
        runtime: { kind: "web" },
      },
      source,
      target: {
        kind: "managed",
        runtimeWindowId: "w-1",
        windowRecordId: "record-w1",
      },
      targetPanelId: "panel-1",
      transferId: TRANSFER_B,
      updatedAt: 2,
    });
    rendererExecute.mockImplementation(async () => ({
      data: null,
      ok: true,
      requestId: "r1",
    }));
    const ready = await service.ready(target, TRANSFER_B);
    expect(ready).toMatchObject({ ok: true, targetPanelId: "panel-1" });
  });

  it("bootstrap only includes source-prepared+ with snapshot", async () => {
    const service = createService();
    const source = caller("main", "record-main", 1);
    await journal.upsert({
      createdAt: 1,
      offer: movableOffer(TRANSFER_A),
      phase: "claimed",
      source,
      transferId: TRANSFER_A,
      updatedAt: 1,
    });
    await journal.upsert({
      createdAt: 1,
      offer: movableOffer(TRANSFER_B),
      phase: "source-prepared",
      snapshot: {
        panel: movableOffer(TRANSFER_B).panel,
        prepared: {},
        runtime: { kind: "web" },
      },
      source,
      target: {
        kind: "managed",
        runtimeWindowId: "w-1",
        windowRecordId: "record-w1",
      },
      transferId: TRANSFER_B,
      updatedAt: 2,
    });
    const boot = await service.bootstrap(source);
    expect(boot.pending.map((item) => item.transferId)).toEqual([TRANSFER_B]);
  });

  it("recoverPending aborts pre-commit and keeps post-commit snapshot pending", async () => {
    const service = createService();
    const source = caller("main", "record-main", 1);
    await journal.upsert({
      createdAt: 1,
      offer: movableOffer(TRANSFER_A),
      phase: "target-durable",
      snapshot: {
        panel: movableOffer(TRANSFER_A).panel,
        prepared: {},
        runtime: { kind: "web" },
      },
      source,
      target: {
        kind: "managed",
        runtimeWindowId: "w-1",
        windowRecordId: "record-w1",
      },
      transferId: TRANSFER_A,
      updatedAt: 1,
    });
    await journal.upsert({
      createdAt: 1,
      offer: movableOffer(TRANSFER_B),
      phase: "runtime-moved",
      snapshot: {
        panel: movableOffer(TRANSFER_B).panel,
        prepared: {},
        runtime: { kind: "web" },
      },
      source,
      target: {
        kind: "managed",
        runtimeWindowId: "w-1",
        windowRecordId: "record-w1",
      },
      transferId: TRANSFER_B,
      updatedAt: 2,
    });

    await service.recoverPending();
    const remaining = journal.list().map((entry) => entry.transferId);
    expect(remaining).toContain(TRANSFER_B);
    expect(remaining).not.toContain(TRANSFER_A);
  });

  it("createForTransfer/closeAfterTransfer require active lease via window port", async () => {
    const service = createService(async () => undefined);
    const source = caller("main", "record-main", 1);
    cursor = { x: 5000, y: 5000 };
    await service.offer(source, movableOffer(TRANSFER_A));
    await service.finishDrag(source, TRANSFER_A);
    expect(createForTransfer).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({ transferId: TRANSFER_A })
    );
  });

  it("target_conflict fails without side effects when panel id exists", async () => {
    workspace.hasPanelId = vi.fn(async () => true);
    const service = createService(async () => undefined);
    const source = caller("main", "record-main", 1);
    const target = caller("w-1", "record-w1", 2);
    await service.offer(source, movableOffer(TRANSFER_A));
    await expect(
      service.drop(target, {
        placement: { kind: "root" },
        transferId: TRANSFER_A,
      })
    ).resolves.toMatchObject({ code: "target_conflict", ok: false });
    expect(rendererExecute).not.toHaveBeenCalled();
  });

  it("recoverPending retains post-commit journal when no live windows", async () => {
    windows.list = vi.fn(() => []);
    const service = createService();
    const source = caller("main", "record-main", 1);
    await journal.upsert({
      createdAt: 1,
      offer: movableOffer(TRANSFER_B),
      phase: "runtime-moved",
      snapshot: {
        panel: movableOffer(TRANSFER_B).panel,
        prepared: {},
        runtime: { kind: "web" },
      },
      source,
      target: {
        kind: "managed",
        runtimeWindowId: "w-1",
        windowRecordId: "record-w1",
      },
      targetPanelId: "panel-1",
      transferId: TRANSFER_B,
      updatedAt: 2,
    });

    await service.recoverPending();
    expect(journal.list().map((entry) => entry.transferId)).toEqual([
      TRANSFER_B,
    ]);
    expect(rendererExecute).not.toHaveBeenCalled();
  });

  it("rollback destroys internal target window created for transfer", async () => {
    cursor = { x: 5000, y: 5000 };
    const service = createService(async () => undefined);
    const source = caller("main", "record-main", 1);
    await service.offer(source, movableOffer(TRANSFER_A));

    rendererExecute.mockImplementation(async (command: { type: string }) => {
      if (command.type === "panelTransfer.prepareSource") {
        return {
          data: {
            panel: {
              componentId: "welcome",
              panelId: "panel-1",
              title: "Welcome",
            },
            prepared: {},
            runtime: { kind: "web" },
          },
          ok: true,
          requestId: "r1",
        };
      }
      if (command.type === "panelTransfer.stageTarget") {
        return {
          error: { message: "stage failed" },
          ok: false,
          requestId: "r1",
        };
      }
      return { data: null, ok: true, requestId: "r1" };
    });

    await expect(service.finishDrag(source, TRANSFER_A)).resolves.toMatchObject(
      {
        code: "transfer_failed",
        ok: false,
      }
    );
    expect(createForTransfer).toHaveBeenCalledOnce();
    expect(windows.destroyForTransfer).toHaveBeenCalledWith(
      lease,
      "w-new",
      TRANSFER_A
    );
    expect(windows.releaseRendererShow).toHaveBeenCalledWith(
      "w-new",
      "panel-transfer"
    );
  });

  it("recoverPending reports journal parse failure via hook", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-pts-bad-"));
    await writeFile(join(dir, "panel-transfers.json"), "{not-json", "utf8");
    const reportJournalParseFailure = vi.fn();
    const badJournal = new PanelTransferJournal(dir);
    const service = createPanelTransferService({
      files,
      geometry,
      journal: badJournal,
      now: () => now,
      pluginMutation,
      rendererCommand: {
        execute: rendererExecute,
        resolve: () => undefined,
      },
      reportJournalParseFailure,
      sleep: async () => undefined,
      terminal,
      userDataDir: dir,
      windows,
      workspace,
    });

    await service.recoverPending();
    expect(reportJournalParseFailure).toHaveBeenCalledOnce();
    expect(reportJournalParseFailure.mock.calls[0]?.[0]).toContain(
      "panel-transfers.json"
    );
  });

  it("roll-forward calls closeAfterTransfer after source-durable", async () => {
    const service = createService(async () => undefined);
    const source = caller("main", "record-main", 1);
    const target = caller("w-1", "record-w1", 2);
    await service.offer(source, movableOffer(TRANSFER_A));
    await expect(
      service.drop(target, {
        placement: { kind: "root" },
        transferId: TRANSFER_A,
      })
    ).resolves.toMatchObject({ ok: true, targetPanelId: "panel-1" });
    expect(windows.closeAfterTransfer).toHaveBeenCalledWith(
      lease,
      "main",
      TRANSFER_A
    );
  });
});
