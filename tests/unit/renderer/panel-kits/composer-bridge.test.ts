import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireComposerSend,
  clearReviewChipDraft,
  commitComposerSend,
  disposeTerminalComposerSession,
  enqueueComposerAttachmentMerge,
  getOrCreateTerminalComposerSession,
  getTerminalComposerSession,
  readComposerAttachments,
  readComposerDraft,
  readReviewChipDraft,
  releaseComposerSend,
  resetTerminalComposerSessionsForTests,
  takeComposerEdits,
  writeComposerDraft,
  writeReviewChipDraft,
} from "@/panel-kits/terminal/composer/session.ts";
import {
  dispatchComposerEdit,
  insertReviewCommentsIntoTerminalComposer,
  insertTextIntoTerminalComposer,
  isReviewInsertFlushPending,
  registerComposerEditHandler,
  registerComposerInserter,
  registerComposerOpener,
  registerComposerReviewInserter,
  resetComposerBridgeForTests,
} from "@/panel-kits/terminal/composer-bridge.ts";

afterEach(() => {
  resetComposerBridgeForTests();
  resetTerminalComposerSessionsForTests();
  vi.useRealTimers();
});

describe("insertTextIntoTerminalComposer", () => {
  it("queues a text edit and opens when editor is not mounted", () => {
    const session = getOrCreateTerminalComposerSession("p1");
    let opened = 0;
    registerComposerOpener(session, () => {
      opened += 1;
    });
    expect(insertTextIntoTerminalComposer("p1", "comment block")).toBe(true);
    expect(readComposerDraft(session)).toBe("");
    expect(opened).toBe(1);
    const delivered: string[] = [];
    registerComposerEditHandler(session, (edit) => {
      if (edit.kind === "text") {
        delivered.push(edit.text);
      }
      return true;
    });
    expect(delivered).toEqual(["comment block"]);
  });

  it("uses inserter when mounted and still ensures open", () => {
    const chunks: string[] = [];
    let opened = 0;
    registerComposerOpener(getOrCreateTerminalComposerSession("p2"), () => {
      opened += 1;
    });
    registerComposerInserter(
      getOrCreateTerminalComposerSession("p2"),
      (text) => {
        chunks.push(text);
      }
    );
    expect(insertTextIntoTerminalComposer("p2", "live")).toBe(true);
    expect(chunks).toEqual(["live"]);
    expect(opened).toBe(1);
  });

  it("returns false without opener when closed", () => {
    expect(insertTextIntoTerminalComposer("missing", "x")).toBe(false);
    expect(getTerminalComposerSession("missing")).toBeNull();
    expect(
      readComposerDraft(getOrCreateTerminalComposerSession("missing"))
    ).toBe("");
  });
});

describe("insertReviewCommentsIntoTerminalComposer", () => {
  it("queues chip and opens without writing plain draft when closed", async () => {
    let opened = 0;
    registerComposerOpener(getOrCreateTerminalComposerSession("r1"), () => {
      opened += 1;
    });
    writeComposerDraft(getOrCreateTerminalComposerSession("r1"), "existing");

    const pending = insertReviewCommentsIntoTerminalComposer("r1", {
      count: 2,
      label: "Comments · 2",
      payloadText: "Please address these review comments:\n\n- x",
    });
    expect(readComposerDraft(getOrCreateTerminalComposerSession("r1"))).toBe(
      "existing"
    );
    expect(opened).toBe(1);

    const chips: { count: number; label: string }[] = [];
    registerComposerReviewInserter(
      getOrCreateTerminalComposerSession("r1"),
      async (input) => {
        chips.push({ count: input.count, label: input.label });
        return true;
      }
    );

    await expect(pending).resolves.toBe(true);
    expect(chips).toEqual([{ count: 2, label: "Comments · 2" }]);
    expect(
      readReviewChipDraft(getOrCreateTerminalComposerSession("r1"))?.count
    ).toBe(2);
  });

  it("uses review inserter when mounted and acks true", async () => {
    const chips: { count: number; label: string }[] = [];
    let opened = 0;
    registerComposerOpener(getOrCreateTerminalComposerSession("r2"), () => {
      opened += 1;
    });
    registerComposerReviewInserter(
      getOrCreateTerminalComposerSession("r2"),
      async (input) => {
        chips.push({ count: input.count, label: input.label });
        return true;
      }
    );
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
    registerComposerOpener(
      getOrCreateTerminalComposerSession("r3"),
      () => undefined
    );
    registerComposerReviewInserter(
      getOrCreateTerminalComposerSession("r3"),
      async () => false
    );
    await expect(
      insertReviewCommentsIntoTerminalComposer("r3", {
        count: 1,
        label: "Comments · 1",
        payloadText: "payload",
      })
    ).resolves.toBe(false);
    expect(
      readReviewChipDraft(getOrCreateTerminalComposerSession("r3"))
    ).toBeNull();
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
    registerComposerOpener(
      getOrCreateTerminalComposerSession("r4"),
      () => undefined
    );
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
    registerComposerOpener(
      getOrCreateTerminalComposerSession("r5"),
      () => undefined
    );
    const pending = insertReviewCommentsIntoTerminalComposer("r5", {
      count: 1,
      label: "Comments · 1",
      payloadText: "payload-r5",
    });
    expect(isReviewInsertFlushPending("r5")).toBe(true);
    let sawFlushPendingDuringInsert = false;
    registerComposerReviewInserter(
      getOrCreateTerminalComposerSession("r5"),
      async () => {
        sawFlushPendingDuringInsert = isReviewInsertFlushPending("r5");
        return true;
      }
    );
    // Immediately after register, flush is scheduled (rehydrate must not race).
    expect(isReviewInsertFlushPending("r5")).toBe(true);
    await expect(pending).resolves.toBe(true);
    expect(sawFlushPendingDuringInsert).toBe(true);
    expect(isReviewInsertFlushPending("r5")).toBe(false);
  });

  it("does not keep chip draft when opener is missing", async () => {
    writeReviewChipDraft(getOrCreateTerminalComposerSession("r6"), {
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
    expect(
      readReviewChipDraft(getOrCreateTerminalComposerSession("r6"))
    ).toBeNull();
    clearReviewChipDraft(getOrCreateTerminalComposerSession("r6"));
  });
});

describe("composer bridge session disposal", () => {
  const chip = { count: 1, label: "Comments", payloadText: "old review" };

  it("does not write into a retained session without a registered entry", () => {
    const session = getOrCreateTerminalComposerSession("hidden");
    writeComposerDraft(session, "keep me");
    const unregister = registerComposerOpener(session, () => undefined);
    unregister();
    expect(insertTextIntoTerminalComposer("hidden", "orphan")).toBe(false);
    expect(readComposerDraft(session)).toBe("keep me");
  });

  it("settles queued inserts immediately on close and cancels their timers", async () => {
    vi.useFakeTimers();
    const session = getOrCreateTerminalComposerSession("queued");
    registerComposerOpener(session, () => undefined);
    const pending = insertReviewCommentsIntoTerminalComposer("queued", chip);
    disposeTerminalComposerSession("queued");
    await expect(pending).resolves.toBe(false);
    expect(isReviewInsertFlushPending("queued")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(getTerminalComposerSession("queued")).toBeNull();
  });

  it("does not let an old flush cancel a reused id's queued review", async () => {
    const old = getOrCreateTerminalComposerSession("reused");
    registerComposerOpener(old, () => undefined);
    const first = insertReviewCommentsIntoTerminalComposer("reused", chip);
    const oldInsert = vi.fn(() => true);
    const unregister = registerComposerReviewInserter(old, oldInsert);
    disposeTerminalComposerSession("reused");
    const current = getOrCreateTerminalComposerSession("reused");
    registerComposerOpener(current, () => undefined);
    const second = insertReviewCommentsIntoTerminalComposer("reused", {
      ...chip,
      payloadText: "new review",
    });
    await expect(first).resolves.toBe(false);
    expect(oldInsert).not.toHaveBeenCalled();
    expect(isReviewInsertFlushPending("reused")).toBe(true);
    const inserted: string[] = [];
    registerComposerReviewInserter(current, (input) => {
      inserted.push(input.payloadText);
      return true;
    });
    unregister();
    await expect(second).resolves.toBe(true);
    expect(inserted).toEqual(["new review"]);
    expect(readReviewChipDraft(current)?.payloadText).toBe("new review");
    expect(isReviewInsertFlushPending("reused")).toBe(false);
  });

  it("rejects a late live ack without overwriting a reused terminal's draft", async () => {
    const old = getOrCreateTerminalComposerSession("live");
    const ack = Promise.withResolvers<boolean>();
    const oldUnregister = registerComposerReviewInserter(
      old,
      () => ack.promise
    );
    const first = insertReviewCommentsIntoTerminalComposer("live", chip);
    disposeTerminalComposerSession("live");
    await expect(first).resolves.toBe(false);
    const current = getOrCreateTerminalComposerSession("live");
    registerComposerReviewInserter(current, () => true);
    oldUnregister();
    await expect(
      insertReviewCommentsIntoTerminalComposer("live", {
        ...chip,
        payloadText: "new review",
      })
    ).resolves.toBe(true);
    ack.resolve(true);
    await Promise.resolve();
    expect(readReviewChipDraft(old)).toBeNull();
    expect(readReviewChipDraft(current)?.payloadText).toBe("new review");
  });

  it("requires the original live registration to acknowledge the insert", async () => {
    const session = getOrCreateTerminalComposerSession("registration");
    const ack = Promise.withResolvers<boolean>();
    registerComposerReviewInserter(session, () => ack.promise);
    const pending = insertReviewCommentsIntoTerminalComposer(
      "registration",
      chip
    );
    const unregister = registerComposerReviewInserter(session, () => true);
    unregister();
    ack.resolve(true);
    await expect(pending).resolves.toBe(false);
    expect(readReviewChipDraft(session)).toBeNull();
  });
});

const LATE_FILE = {
  id: "late",
  kind: "file" as const,
  name: "late",
  path: "/late",
};

describe("composer edits across send", () => {
  it("stashes attachments during send without blocking commit", () => {
    const session = getOrCreateTerminalComposerSession("send");
    writeComposerDraft(session, "body");
    const lease = acquireComposerSend(session, "body");
    expect(lease).not.toBeNull();
    expect(
      dispatchComposerEdit(session, {
        attachments: [LATE_FILE],
        kind: "attachments",
      })
    ).toBe(true);
    expect(readComposerAttachments(session)).toEqual([]);
    expect(commitComposerSend(session, lease!)).toBe(true);
    expect(takeComposerEdits(session)).toEqual([]);
    releaseComposerSend(session, lease!);
  });

  it("drops in-flight merge apply after a successful commit", async () => {
    const session = getOrCreateTerminalComposerSession("gen");
    const gate = Promise.withResolvers<void>();
    let applied = false;
    const job = enqueueComposerAttachmentMerge(session, async () => {
      await gate.promise;
      applied = dispatchComposerEdit(session, {
        attachments: [LATE_FILE],
        kind: "attachments",
      });
    });
    await Promise.resolve();
    const lease = acquireComposerSend(session, "body");
    expect(lease).not.toBeNull();
    expect(commitComposerSend(session, lease!)).toBe(true);
    releaseComposerSend(session, lease!);
    gate.resolve();
    await job;
    expect(applied).toBe(false);
    expect(readComposerAttachments(session)).toEqual([]);
  });
});
