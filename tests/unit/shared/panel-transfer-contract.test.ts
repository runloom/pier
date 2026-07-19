import { pierCommandSchema } from "@shared/contracts/commands.ts";
import {
  PANEL_TRANSFER_MIME,
  PANEL_TRANSFER_TEXT_PREFIX,
  panelTransferBootstrapStateSchema,
  panelTransferOfferSchema,
  panelTransferPhaseSchema,
  panelTransferPlacementSchema,
  panelTransferPreparedSourceSchema,
  panelTransferResultSchema,
  panelTransferSourceSnapshotSchema,
} from "@shared/contracts/panel-transfer.ts";
import { rendererCommandSchema } from "@shared/contracts/renderer-command.ts";
import { describe, expect, it } from "vitest";

const TRANSFER_ID = "9af45a46-24f2-4ac0-9371-fbe78ca295dc";

const movablePanel = {
  componentId: "files.editor",
  panelId: "panel-files-1",
  title: "notes.md",
  params: { path: "notes.md" },
} as const;

const movableOffer = {
  version: 1 as const,
  transferId: TRANSFER_ID,
  capability: "movable" as const,
  panel: movablePanel,
};

const sourceSnapshot = {
  panel: movablePanel,
  runtime: { kind: "web" as const },
  prepared: {
    drafts: [{ sourceKey: "draft:src", targetKey: "draft:tgt" }],
  },
};

describe("panel transfer constants", () => {
  it("exports stable MIME and text-prefix markers for source-side diagnostics", () => {
    expect(PANEL_TRANSFER_MIME).toBe("application/x-pier-panel-transfer");
    expect(PANEL_TRANSFER_TEXT_PREFIX).toBe("pier-panel-transfer:");
  });
});

describe("panelTransferOfferSchema", () => {
  it("accepts movable and unsupported offers", () => {
    expect(panelTransferOfferSchema.parse(movableOffer)).toEqual(movableOffer);
    expect(
      panelTransferOfferSchema.parse({
        version: 1,
        transferId: TRANSFER_ID,
        capability: "unsupported",
        panel: {
          componentId: "external.widget",
          panelId: "panel-x",
          title: "External",
        },
      })
    ).toMatchObject({ capability: "unsupported" });
  });

  it("rejects empty or oversized ids, unknown version, and unknown fields", () => {
    expect(
      panelTransferOfferSchema.safeParse({
        ...movableOffer,
        transferId: "",
      }).success
    ).toBe(false);
    expect(
      panelTransferOfferSchema.safeParse({
        ...movableOffer,
        transferId: "not-a-uuid",
      }).success
    ).toBe(false);
    expect(
      panelTransferOfferSchema.safeParse({
        ...movableOffer,
        panel: { ...movablePanel, panelId: "" },
      }).success
    ).toBe(false);
    expect(
      panelTransferOfferSchema.safeParse({
        ...movableOffer,
        panel: { ...movablePanel, panelId: "p".repeat(257) },
      }).success
    ).toBe(false);
    expect(
      panelTransferOfferSchema.safeParse({
        ...movableOffer,
        panel: { ...movablePanel, componentId: "c".repeat(257) },
      }).success
    ).toBe(false);
    expect(
      panelTransferOfferSchema.safeParse({
        ...movableOffer,
        panel: { ...movablePanel, title: "t".repeat(1025) },
      }).success
    ).toBe(false);
    expect(
      panelTransferOfferSchema.safeParse({
        ...movableOffer,
        version: 2,
      }).success
    ).toBe(false);
    expect(
      panelTransferOfferSchema.safeParse({
        ...movableOffer,
        extra: true,
      }).success
    ).toBe(false);
    expect(
      panelTransferOfferSchema.safeParse({
        ...movableOffer,
        panel: { ...movablePanel, surprise: 1 },
      }).success
    ).toBe(false);
  });

  it("rejects non-JSON panel params and descriptors over the 256 KiB UTF-8 cap", () => {
    expect(
      panelTransferOfferSchema.safeParse({
        ...movableOffer,
        panel: {
          ...movablePanel,
          params: { nested: { ok: true }, list: [1, "x", null] },
        },
      }).success
    ).toBe(true);

    expect(
      panelTransferOfferSchema.safeParse({
        ...movableOffer,
        panel: {
          ...movablePanel,
          // Functions are not JSON values.
          params: { bad: () => 1 },
        },
      }).success
    ).toBe(false);

    const oversized = "x".repeat(300_000);
    expect(
      panelTransferOfferSchema.safeParse({
        ...movableOffer,
        panel: {
          ...movablePanel,
          params: { blob: oversized },
        },
      }).success
    ).toBe(false);
  });

  it("rejects unsupported offers that smuggle params", () => {
    expect(
      panelTransferOfferSchema.safeParse({
        version: 1,
        transferId: TRANSFER_ID,
        capability: "unsupported",
        panel: {
          componentId: "external.widget",
          panelId: "panel-x",
          title: "External",
          params: { no: true },
        },
      }).success
    ).toBe(false);
  });
});

describe("panelTransferPlacementSchema", () => {
  it("accepts tab, split, and root placements", () => {
    expect(
      panelTransferPlacementSchema.parse({
        kind: "tab",
        groupId: "group-1",
        index: 0,
      })
    ).toEqual({ kind: "tab", groupId: "group-1", index: 0 });
    expect(
      panelTransferPlacementSchema.parse({
        kind: "split",
        direction: "right",
      })
    ).toEqual({ kind: "split", direction: "right" });
    expect(
      panelTransferPlacementSchema.parse({
        kind: "split",
        referenceGroupId: "group-2",
        direction: "below",
      })
    ).toMatchObject({ kind: "split", referenceGroupId: "group-2" });
    expect(panelTransferPlacementSchema.parse({ kind: "root" })).toEqual({
      kind: "root",
    });
  });

  it("rejects illegal placement shapes", () => {
    expect(
      panelTransferPlacementSchema.safeParse({
        kind: "tab",
        groupId: "",
        index: 0,
      }).success
    ).toBe(false);
    expect(
      panelTransferPlacementSchema.safeParse({
        kind: "tab",
        groupId: "g".repeat(257),
        index: 0,
      }).success
    ).toBe(false);
    expect(
      panelTransferPlacementSchema.safeParse({
        kind: "tab",
        groupId: "group-1",
        index: -1,
      }).success
    ).toBe(false);
    expect(
      panelTransferPlacementSchema.safeParse({
        kind: "tab",
        groupId: "group-1",
        index: 10_001,
      }).success
    ).toBe(false);
    expect(
      panelTransferPlacementSchema.safeParse({
        kind: "split",
        direction: "diagonal",
      }).success
    ).toBe(false);
    expect(
      panelTransferPlacementSchema.safeParse({
        kind: "root",
        extra: true,
      }).success
    ).toBe(false);
    expect(
      panelTransferPlacementSchema.safeParse({ kind: "floating" }).success
    ).toBe(false);
  });
});

describe("panelTransferPreparedSourceSchema", () => {
  it("caps drafts and requires distinct keys", () => {
    expect(
      panelTransferPreparedSourceSchema.parse({
        state: { mode: "edit" },
        drafts: [{ sourceKey: "a", targetKey: "b" }],
      })
    ).toEqual({
      state: { mode: "edit" },
      drafts: [{ sourceKey: "a", targetKey: "b" }],
    });

    expect(
      panelTransferPreparedSourceSchema.safeParse({
        drafts: [{ sourceKey: "same", targetKey: "same" }],
      }).success
    ).toBe(false);
    expect(
      panelTransferPreparedSourceSchema.safeParse({
        drafts: [{ sourceKey: "k".repeat(513), targetKey: "other" }],
      }).success
    ).toBe(false);
    expect(
      panelTransferPreparedSourceSchema.safeParse({
        drafts: Array.from({ length: 17 }, (_, index) => ({
          sourceKey: `src-${index}`,
          targetKey: `tgt-${index}`,
        })),
      }).success
    ).toBe(false);
  });
});

describe("panelTransferSourceSnapshotSchema and phase/bootstrap", () => {
  it("accepts web and terminal snapshots", () => {
    expect(panelTransferSourceSnapshotSchema.parse(sourceSnapshot)).toEqual(
      sourceSnapshot
    );
    expect(
      panelTransferSourceSnapshotSchema.parse({
        panel: movablePanel,
        runtime: { kind: "terminal", lifecycleId: "life-1" },
        prepared: {},
      })
    ).toMatchObject({ runtime: { kind: "terminal", lifecycleId: "life-1" } });
  });

  it("rejects illegal phases and bootstrap entries", () => {
    for (const phase of [
      "offered",
      "claimed",
      "source-prepared",
      "target-durable",
      "commit-intent",
      "runtime-moved",
      "source-durable",
      "target-active",
      "committed",
      "rolling-back",
      "aborted",
    ] as const) {
      expect(panelTransferPhaseSchema.parse(phase)).toBe(phase);
    }
    expect(panelTransferPhaseSchema.safeParse("done").success).toBe(false);

    expect(
      panelTransferBootstrapStateSchema.parse({
        pending: [
          {
            transferId: TRANSFER_ID,
            role: "target",
            panelId: "panel-files-1",
            phase: "source-prepared",
            snapshot: sourceSnapshot,
            inert: true,
          },
        ],
      })
    ).toMatchObject({ pending: [{ role: "target", inert: true }] });

    expect(
      panelTransferBootstrapStateSchema.safeParse({
        pending: [
          {
            transferId: "bad",
            role: "source",
            panelId: "panel-files-1",
            phase: "source-prepared",
            snapshot: sourceSnapshot,
            inert: false,
          },
        ],
      }).success
    ).toBe(false);
    expect(
      panelTransferBootstrapStateSchema.safeParse({
        pending: [
          {
            transferId: TRANSFER_ID,
            role: "owner",
            panelId: "panel-files-1",
            phase: "source-prepared",
            snapshot: sourceSnapshot,
            inert: false,
          },
        ],
      }).success
    ).toBe(false);
    expect(
      panelTransferBootstrapStateSchema.safeParse({
        pending: [
          {
            transferId: TRANSFER_ID,
            role: "target",
            panelId: "panel-files-1",
            phase: "source-prepared",
            snapshot: sourceSnapshot,
            inert: true,
            extra: 1,
          },
        ],
      }).success
    ).toBe(false);
  });
});

describe("panelTransferResultSchema", () => {
  it("accepts success and typed failure codes", () => {
    expect(
      panelTransferResultSchema.parse({
        ok: true,
        targetPanelId: "panel-files-1",
      })
    ).toEqual({ ok: true, targetPanelId: "panel-files-1" });
    expect(
      panelTransferResultSchema.parse({
        ok: false,
        code: "already_claimed",
        message: "claimed",
      })
    ).toEqual({
      ok: false,
      code: "already_claimed",
      message: "claimed",
    });
    expect(
      panelTransferResultSchema.safeParse({
        ok: false,
        code: "mystery",
        message: "x",
      }).success
    ).toBe(false);
    expect(
      panelTransferResultSchema.safeParse({
        ok: true,
        targetPanelId: "panel-files-1",
        extra: true,
      }).success
    ).toBe(false);
  });
});

describe("panel transfer commands", () => {
  it("registers the six main-mediated PierCommand routes", () => {
    expect(
      pierCommandSchema.parse({
        type: "panelTransfer.offer",
        offer: movableOffer,
      })
    ).toMatchObject({ type: "panelTransfer.offer" });
    expect(
      pierCommandSchema.parse({
        type: "panelTransfer.drop",
        transferId: TRANSFER_ID,
        placement: { kind: "root" },
      })
    ).toMatchObject({ type: "panelTransfer.drop" });
    expect(
      pierCommandSchema.parse({
        type: "panelTransfer.finishDrag",
        transferId: TRANSFER_ID,
      })
    ).toMatchObject({ type: "panelTransfer.finishDrag" });
    expect(
      pierCommandSchema.parse({
        type: "panelTransfer.cancel",
        transferId: TRANSFER_ID,
      })
    ).toMatchObject({ type: "panelTransfer.cancel" });
    expect(
      pierCommandSchema.parse({ type: "panelTransfer.bootstrap" })
    ).toMatchObject({ type: "panelTransfer.bootstrap" });
    expect(
      pierCommandSchema.parse({
        type: "panelTransfer.ready",
        transferId: TRANSFER_ID,
      })
    ).toMatchObject({ type: "panelTransfer.ready" });
  });

  it("does not accept window identities on panelTransfer commands", () => {
    expect(
      pierCommandSchema.safeParse({
        type: "panelTransfer.drop",
        transferId: TRANSFER_ID,
        placement: { kind: "root" },
        windowId: "main",
      }).success
    ).toBe(false);
    expect(
      pierCommandSchema.safeParse({
        type: "panelTransfer.offer",
        offer: movableOffer,
        recordId: "rec-1",
      }).success
    ).toBe(false);
  });

  it("registers the four renderer-side panelTransfer commands", () => {
    expect(
      rendererCommandSchema.parse({
        type: "panelTransfer.prepareSource",
        transferId: TRANSFER_ID,
        sourcePanelId: "panel-files-1",
      })
    ).toMatchObject({ type: "panelTransfer.prepareSource" });
    expect(
      rendererCommandSchema.parse({
        type: "panelTransfer.stageTarget",
        transferId: TRANSFER_ID,
        targetPanelId: "panel-files-1",
        panel: movablePanel,
        prepared: sourceSnapshot.prepared,
        placement: { kind: "tab", groupId: "g1", index: 1 },
      })
    ).toMatchObject({ type: "panelTransfer.stageTarget" });
    expect(
      rendererCommandSchema.parse({
        type: "panelTransfer.releaseSource",
        transferId: TRANSFER_ID,
        sourcePanelId: "panel-files-1",
      })
    ).toMatchObject({ type: "panelTransfer.releaseSource" });
    expect(
      rendererCommandSchema.parse({
        type: "panelTransfer.finalize",
        transferId: TRANSFER_ID,
        role: "source",
        outcome: "commit",
      })
    ).toMatchObject({ type: "panelTransfer.finalize" });
  });

  it("rejects illegal renderer panelTransfer payloads", () => {
    expect(
      rendererCommandSchema.safeParse({
        type: "panelTransfer.prepareSource",
        transferId: "bad",
        sourcePanelId: "panel-files-1",
      }).success
    ).toBe(false);
    expect(
      rendererCommandSchema.safeParse({
        type: "panelTransfer.finalize",
        transferId: TRANSFER_ID,
        role: "both",
        outcome: "commit",
      }).success
    ).toBe(false);
    expect(
      rendererCommandSchema.safeParse({
        type: "panelTransfer.stageTarget",
        transferId: TRANSFER_ID,
        targetPanelId: "panel-files-1",
        panel: movablePanel,
        prepared: sourceSnapshot.prepared,
        placement: { kind: "tab", groupId: "g1", index: 1 },
        windowId: "should-not-be-here",
      }).success
    ).toBe(false);
  });
});
