/**
 * Fault-injection recovery matrix for panel transfers:
 * each journal phase × {crash, close, reload}.
 *
 * Crash  = cold start via recoverPending() with no live windows
 * Close  = mid-transfer with source/target missing from windows.list
 * Reload = post-commit bootstrap→ready after runtime id reassignment
 */
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPanelTransferService } from "@main/services/panel-transfer/panel-transfer-service.ts";
import type {
  PanelTransferCaller,
  PanelTransferFilesPort,
  PanelTransferGeometryPort,
  PanelTransferJournalRecord,
  PanelTransferTerminalPort,
  PanelTransferWindowPort,
  PanelTransferWorkspacePort,
} from "@main/services/panel-transfer/panel-transfer-types.ts";
import type { WindowTransitionLease } from "@main/services/window-service.ts";
import { PanelTransferJournal } from "@main/state/panel-transfer-journal.ts";
import type {
  PanelTransferPhase,
  PanelTransferSourceSnapshot,
} from "@shared/contracts/panel-transfer.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const PRE_COMMIT_PHASES = [
  "offered",
  "claimed",
  "source-prepared",
  "target-durable",
  "commit-intent",
  "rolling-back",
] as const satisfies readonly PanelTransferPhase[];

const POST_COMMIT_PHASES = [
  "runtime-moved",
  "source-durable",
  "target-active",
] as const satisfies readonly PanelTransferPhase[];

/** Committed is typically journal-removed; still covered for reload/crash edges. */
const POST_COMMIT_WITH_COMMITTED = [
  ...POST_COMMIT_PHASES,
  "committed",
] as const satisfies readonly PanelTransferPhase[];

type PreCommitPhase = (typeof PRE_COMMIT_PHASES)[number];
type PostCommitPhase = (typeof POST_COMMIT_WITH_COMMITTED)[number];

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

function webSnapshot(
  transferId: string,
  panelId = "panel-1"
): PanelTransferSourceSnapshot {
  return {
    panel: movableOffer(transferId, panelId).panel,
    prepared: {},
    runtime: { kind: "web" },
  };
}

function terminalSnapshot(
  transferId: string,
  lifecycleId = "life-1"
): PanelTransferSourceSnapshot {
  return {
    panel: movableOffer(transferId).panel,
    prepared: {},
    runtime: { kind: "terminal", lifecycleId },
  };
}

function draftsSnapshot(transferId: string): PanelTransferSourceSnapshot {
  return {
    panel: movableOffer(transferId).panel,
    prepared: {
      drafts: [{ sourceKey: "draft-src", targetKey: "draft-tgt" }],
    },
    runtime: { kind: "web" },
  };
}

function needsSnapshot(phase: PanelTransferPhase): boolean {
  return phase !== "offered" && phase !== "claimed" && phase !== "aborted";
}

function needsTarget(phase: PanelTransferPhase): boolean {
  return needsSnapshot(phase) || phase === "claimed";
}

describe("panel transfer recovery matrix", () => {
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

  const source = caller("main", "record-main", 1);

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), "pier-ptr-"));
    journal = new PanelTransferJournal(userDataDir);
    lease = { token: Symbol("lease") };
    now = 1000;
    createForTransfer = vi.fn(async () => ({
      recordId: "record-new",
      windowId: "w-new",
    }));
    runExclusive = vi.fn(async (operation) => operation(lease));
    pluginMutation = vi.fn(async (operation) => operation());
    windows = {
      closeAfterTransfer: vi.fn(async () => undefined),
      closeOpenWindowRecord: vi.fn(async () => undefined),
      createForTransfer: createForTransfer as never,
      destroyForTransfer: vi.fn(async () => undefined),
      holdRendererShow: vi.fn(),
      list: vi.fn(() => [
        { focused: true, id: "main", recordId: "record-main" },
        { focused: false, id: "w-1", recordId: "record-w1" },
      ]),
      releaseRendererShow: vi.fn(),
      runExclusive: runExclusive as never,
    };
    geometry = {
      getCursorScreenPoint: () => ({ x: 5000, y: 5000 }),
      getDisplayWorkAreaNear: () => ({
        height: 1000,
        width: 1600,
        x: 0,
        y: 0,
      }),
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
    rendererExecute = vi.fn(async () => ({
      data: null,
      ok: true,
      requestId: "r1",
    }));
  });

  function createService() {
    return createPanelTransferService({
      files,
      geometry,
      journal,
      now: () => now,
      pluginMutation: pluginMutation as never,
      rendererCommand: {
        execute: rendererExecute as never,
        resolve: () => undefined,
      },
      sleep: async () => undefined,
      terminal,
      userDataDir,
      windows,
      workspace,
    });
  }

  async function seedAtPhase(
    phase: PanelTransferPhase,
    options: {
      snapshot?: PanelTransferSourceSnapshot;
      sourceCaller?: PanelTransferCaller;
      targetRef?: PanelTransferJournalRecord["target"];
      transferId?: string;
    } = {}
  ): Promise<{ transferId: string; panelId: string }> {
    const transferId = options.transferId ?? randomUUID();
    const panelId = "panel-1";
    const snapshot =
      options.snapshot ??
      (needsSnapshot(phase) ? webSnapshot(transferId, panelId) : undefined);
    const targetRef =
      options.targetRef ??
      (needsTarget(phase) || snapshot
        ? {
            kind: "managed" as const,
            runtimeWindowId: "w-1",
            windowRecordId: "record-w1",
          }
        : undefined);

    await journal.upsert({
      createdAt: 1,
      offer: movableOffer(transferId, panelId),
      phase,
      placement: { kind: "root" },
      snapshot,
      source: options.sourceCaller ?? source,
      target: targetRef,
      targetPanelId: snapshot ? panelId : undefined,
      transferId,
      updatedAt: 2,
    });

    return { panelId, transferId };
  }

  function finalizeCalls(outcome?: "abort" | "commit") {
    return rendererExecute.mock.calls
      .map((call) => ({
        command: call[0] as {
          outcome?: string;
          role?: string;
          transferId?: string;
          type: string;
        },
        options: call[1] as { windowId?: string } | undefined,
      }))
      .filter(
        (entry) =>
          entry.command.type === "panelTransfer.finalize" &&
          (outcome === undefined || entry.command.outcome === outcome)
      );
  }

  function assertPreCommitUniqueSource(transferId: string) {
    expect(journal.list().map((entry) => entry.transferId)).not.toContain(
      transferId
    );
    expect(finalizeCalls("commit")).toEqual([]);
    // Source ownership was never committed onto the target.
    expect(workspace.hasPanelId).not.toHaveBeenCalledWith(
      expect.objectContaining({
        panelId: "panel-1",
        windowRecordId: "record-w1",
      })
    );
  }

  function assertPostCommitRetained(transferId: string) {
    const remaining = journal.get(transferId);
    expect(remaining).not.toBeNull();
    expect(remaining?.snapshot).toBeTruthy();
    expect(remaining?.target).toBeTruthy();
  }

  describe("crash", () => {
    describe.each(PRE_COMMIT_PHASES)("pre-commit phase %s", (phase) => {
      it("recoverPending aborts and clears journal (unique source)", async () => {
        windows.list = vi.fn(() => []);
        const service = createService();
        const { transferId } = await seedAtPhase(phase);

        await service.recoverPending();

        assertPreCommitUniqueSource(transferId);
        expect(terminal.rollback).toHaveBeenCalledWith({ transferId });
        if (needsSnapshot(phase)) {
          expect(finalizeCalls("abort").length).toBeGreaterThan(0);
          expect(
            finalizeCalls("abort").some(
              (entry) => entry.command.role === "target"
            )
          ).toBe(true);
        }
      });
    });

    describe.each(
      POST_COMMIT_WITH_COMMITTED
    )("post-commit phase %s", (phase) => {
      it("recoverPending retains journal snapshot until ready", async () => {
        windows.list = vi.fn(() => []);
        const service = createService();
        const { transferId } = await seedAtPhase(phase);

        await service.recoverPending();

        assertPostCommitRetained(transferId);
        expect(journal.get(transferId)?.phase).toBe(phase);
        // Cold start before restoreOpenWindows — no forced finalize.
        expect(finalizeCalls("commit")).toEqual([]);
      });
    });
  });

  describe("close", () => {
    describe.each(PRE_COMMIT_PHASES)("pre-commit phase %s", (phase) => {
      it("missing windows abort path keeps unique source", async () => {
        // Source/target gone (or never restored) — only an unrelated window.
        windows.list = vi.fn(() => [
          { focused: true, id: "other", recordId: "record-other" },
        ]);
        const service = createService();
        const { transferId } = await seedAtPhase(phase, {
          targetRef: {
            kind: "managed",
            runtimeWindowId: "w-gone",
            windowRecordId: "record-w1",
          },
        });

        await service.recoverPending();

        assertPreCommitUniqueSource(transferId);
        expect(terminal.rollback).toHaveBeenCalledWith({ transferId });
      });
    });

    describe.each(POST_COMMIT_PHASES)("post-commit phase %s", (phase) => {
      it("missing windows retain pending unique target claim", async () => {
        windows.list = vi.fn(() => []);
        const service = createService();
        const { transferId, panelId } = await seedAtPhase(phase);

        await service.recoverPending();

        assertPostCommitRetained(transferId);
        expect(journal.get(transferId)?.targetPanelId ?? panelId).toBe(panelId);
        expect(finalizeCalls("commit")).toEqual([]);
        // No second target ownership committed while windows are gone.
        expect(files.commitDrafts).not.toHaveBeenCalled();
        expect(terminal.commitMove).not.toHaveBeenCalled();
      });
    });
  });

  describe("reload", () => {
    describe.each(
      POST_COMMIT_WITH_COMMITTED
    )("post-commit phase %s", (phase: PostCommitPhase) => {
      it("bootstrap + ready completes roll-forward to unique target", async () => {
        const service = createService();
        const transferId = randomUUID();
        // Stale pre-restart runtime ids; durable recordIds stay stable.
        await seedAtPhase(phase, {
          sourceCaller: {
            ...source,
            runtimeWindowId: "old-main",
          },
          targetRef: {
            kind: "managed",
            runtimeWindowId: "old-w-1",
            windowRecordId: "record-w1",
          },
          transferId,
        });

        windows.list = vi.fn(() => [
          { focused: true, id: "main", recordId: "record-main" },
          { focused: false, id: "w-restored", recordId: "record-w1" },
        ]);
        const restoredTarget = caller("w-restored", "record-w1", 9);

        // Journal still holds the transfer before ready.
        assertPostCommitRetained(transferId);

        const boot = await service.bootstrap(restoredTarget);
        if (phase === "committed") {
          // Committed is usually journal-removed and omitted from bootstrap.
          expect(boot.pending.map((item) => item.transferId)).not.toContain(
            transferId
          );
        } else {
          expect(boot.pending).toEqual([
            expect.objectContaining({
              role: "target",
              transferId,
            }),
          ]);
        }

        const ready = await service.ready(restoredTarget, transferId);
        expect(ready).toMatchObject({
          ok: true,
          targetPanelId: "panel-1",
        });
        expect(journal.list().map((entry) => entry.transferId)).not.toContain(
          transferId
        );

        if (phase === "runtime-moved" || phase === "source-durable") {
          const commits = finalizeCalls("commit");
          expect(commits).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                command: expect.objectContaining({
                  outcome: "commit",
                  role: "source",
                  type: "panelTransfer.finalize",
                }),
                options: { windowId: "main" },
              }),
              expect.objectContaining({
                command: expect.objectContaining({
                  outcome: "commit",
                  role: "target",
                  type: "panelTransfer.finalize",
                }),
                options: { windowId: "w-restored" },
              }),
            ])
          );
        }
      });
    });
  });

  describe("staged side-effect recovery", () => {
    it("terminal-kind snapshot invokes terminal.rollback on pre-commit crash", async () => {
      windows.list = vi.fn(() => []);
      const service = createService();
      const transferId = randomUUID();
      await seedAtPhase("target-durable" satisfies PreCommitPhase, {
        snapshot: terminalSnapshot(transferId),
        transferId,
      });

      await service.recoverPending();

      assertPreCommitUniqueSource(transferId);
      expect(terminal.rollback).toHaveBeenCalledWith({ transferId });
      expect(
        finalizeCalls("abort").some((entry) => entry.command.role === "target")
      ).toBe(true);
    });

    it("drafts snapshot invokes files.rollbackDrafts on pre-commit crash", async () => {
      windows.list = vi.fn(() => []);
      const service = createService();
      const transferId = randomUUID();
      await seedAtPhase("commit-intent" satisfies PreCommitPhase, {
        snapshot: draftsSnapshot(transferId),
        transferId,
      });

      await service.recoverPending();

      assertPreCommitUniqueSource(transferId);
      expect(files.rollbackDrafts).toHaveBeenCalledWith({
        drafts: [{ sourceKey: "draft-src", targetKey: "draft-tgt" }],
        sourceOwner: "record-main",
        targetOwner: "record-w1",
        transferId,
      });
      expect(files.commitDrafts).not.toHaveBeenCalled();
      expect(terminal.rollback).toHaveBeenCalledWith({ transferId });
    });

    it("close with drafts+terminal rolls back both and leaves unique source", async () => {
      windows.list = vi.fn(() => []);
      const service = createService();
      const transferId = randomUUID();
      await seedAtPhase("target-durable", {
        snapshot: {
          panel: movableOffer(transferId).panel,
          prepared: {
            drafts: [{ sourceKey: "a", targetKey: "b" }],
          },
          runtime: { kind: "terminal", lifecycleId: "life-close" },
        },
        transferId,
      });

      await service.recoverPending();

      assertPreCommitUniqueSource(transferId);
      expect(terminal.rollback).toHaveBeenCalledWith({ transferId });
      expect(files.rollbackDrafts).toHaveBeenCalledWith(
        expect.objectContaining({ transferId })
      );
    });
  });
});
