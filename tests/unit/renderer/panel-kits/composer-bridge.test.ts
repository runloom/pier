import { afterEach, describe, expect, it, vi } from "vitest";
import {
  insertReviewCommentsIntoTerminalComposer,
  insertTextIntoTerminalComposer,
  isReviewInsertFlushPending,
  registerComposerInserter,
  registerComposerOpener,
  registerComposerReviewInserter,
  resetComposerBridgeForTests,
} from "@/panel-kits/terminal/composer-bridge.ts";
import {
  clearReviewChipDraft,
  readComposerDraft,
  readReviewChipDraft,
  resetTerminalComposerDraftsForTests,
  writeComposerDraft,
  writeReviewChipDraft,
} from "@/panel-kits/terminal/composer-helpers.ts";

afterEach(() => {
  resetComposerBridgeForTests();
  resetTerminalComposerDraftsForTests();
});

describe("insertTextIntoTerminalComposer", () => {
  it("writes draft and opens when editor is not mounted", () => {
    let opened = 0;
    registerComposerOpener("p1", () => {
      opened += 1;
    });
    expect(insertTextIntoTerminalComposer("p1", "comment block")).toBe(true);
    expect(readComposerDraft("p1")).toBe("comment block");
    expect(opened).toBe(1);
  });

  it("uses inserter when mounted and still ensures open", () => {
    const chunks: string[] = [];
    let opened = 0;
    registerComposerOpener("p2", () => {
      opened += 1;
    });
    registerComposerInserter("p2", (text) => {
      chunks.push(text);
    });
    expect(insertTextIntoTerminalComposer("p2", "live")).toBe(true);
    expect(chunks).toEqual(["live"]);
    expect(opened).toBe(1);
  });

  it("returns false without opener when closed", () => {
    expect(insertTextIntoTerminalComposer("missing", "x")).toBe(false);
  });
});

describe("insertReviewCommentsIntoTerminalComposer", () => {
  it("queues chip and opens without writing plain draft when closed", async () => {
    let opened = 0;
    registerComposerOpener("r1", () => {
      opened += 1;
    });
    writeComposerDraft("r1", "existing");

    const pending = insertReviewCommentsIntoTerminalComposer("r1", {
      count: 2,
      label: "Comments · 2",
      payloadText: "Please address these review comments:\n\n- x",
    });
    expect(readComposerDraft("r1")).toBe("existing");
    expect(opened).toBe(1);

    const chips: { count: number; label: string }[] = [];
    registerComposerReviewInserter("r1", async (input) => {
      chips.push({ count: input.count, label: input.label });
      return true;
    });

    await expect(pending).resolves.toBe(true);
    expect(chips).toEqual([{ count: 2, label: "Comments · 2" }]);
    expect(readReviewChipDraft("r1")?.count).toBe(2);
  });

  it("uses review inserter when mounted and acks true", async () => {
    const chips: { count: number; label: string }[] = [];
    let opened = 0;
    registerComposerOpener("r2", () => {
      opened += 1;
    });
    registerComposerReviewInserter("r2", async (input) => {
      chips.push({ count: input.count, label: input.label });
      return true;
    });
    await expect(
      insertReviewCommentsIntoTerminalComposer("r2", {
        count: 3,
        label: "评论 · 3",
        payloadText: "payload",
      })
    ).resolves.toBe(true);
    expect(chips).toEqual([{ count: 3, label: "评论 · 3" }]);
    expect(opened).toBe(1);
  });

  it("returns false when live insert acks failure (no delete path)", async () => {
    registerComposerOpener("r3", () => undefined);
    registerComposerReviewInserter("r3", async () => false);
    await expect(
      insertReviewCommentsIntoTerminalComposer("r3", {
        count: 1,
        label: "Comments · 1",
        payloadText: "payload",
      })
    ).resolves.toBe(false);
    expect(readReviewChipDraft("r3")).toBeNull();
  });

  it("returns false without opener", async () => {
    await expect(
      insertReviewCommentsIntoTerminalComposer("missing", {
        count: 1,
        label: "x",
        payloadText: "y",
      })
    ).resolves.toBe(false);
  });

  it("times out pending insert when editor never mounts", async () => {
    vi.useFakeTimers();
    registerComposerOpener("r4", () => undefined);
    const pending = insertReviewCommentsIntoTerminalComposer("r4", {
      count: 1,
      label: "Comments · 1",
      payloadText: "payload",
    });
    expect(isReviewInsertFlushPending("r4")).toBe(true);
    await vi.advanceTimersByTimeAsync(9000);
    await expect(pending).resolves.toBe(false);
    expect(isReviewInsertFlushPending("r4")).toBe(false);
    vi.useRealTimers();
  });

  it("marks flush pending while microtask drain runs after register", async () => {
    registerComposerOpener("r5", () => undefined);
    const pending = insertReviewCommentsIntoTerminalComposer("r5", {
      count: 1,
      label: "Comments · 1",
      payloadText: "payload-r5",
    });
    expect(isReviewInsertFlushPending("r5")).toBe(true);
    let sawFlushPendingDuringInsert = false;
    registerComposerReviewInserter("r5", async () => {
      sawFlushPendingDuringInsert = isReviewInsertFlushPending("r5");
      return true;
    });
    // Immediately after register, flush is scheduled (rehydrate must not race).
    expect(isReviewInsertFlushPending("r5")).toBe(true);
    await expect(pending).resolves.toBe(true);
    expect(sawFlushPendingDuringInsert).toBe(true);
    expect(isReviewInsertFlushPending("r5")).toBe(false);
  });

  it("does not keep chip draft when opener is missing", async () => {
    writeReviewChipDraft("r6", {
      count: 1,
      label: "old",
      payloadText: "old-payload",
    });
    await expect(
      insertReviewCommentsIntoTerminalComposer("r6", {
        count: 1,
        label: "new",
        payloadText: "new-payload",
      })
    ).resolves.toBe(false);
    expect(readReviewChipDraft("r6")).toBeNull();
    clearReviewChipDraft("r6");
  });
});

describe("reviewChipDraft lifecycle helpers", () => {
  it("clears when payload no longer present in plain draft", () => {
    writeReviewChipDraft("life", {
      count: 1,
      label: "Comments · 1",
      payloadText: "Please address these review comments:\n\n- x",
    });
    expect(readReviewChipDraft("life")?.count).toBe(1);
    clearReviewChipDraft("life");
    expect(readReviewChipDraft("life")).toBeNull();
  });
});
