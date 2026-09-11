import { afterEach, describe, expect, it } from "vitest";
import {
  acquireComposerSend,
  appendComposerEdit,
  commitComposerSend,
  disposeTerminalComposerSession,
  enqueueComposerAttachmentMerge,
  getOrCreateTerminalComposerSession,
  getTerminalComposerSession,
  readComposerAttachments,
  readComposerDraft,
  readComposerEditorSnapshot,
  readReviewChipDraft,
  releaseComposerSend,
  resetTerminalComposerSessionsForTests,
  writeComposerAttachments,
  writeComposerDraft,
  writeComposerEditorSnapshot,
  writeReviewChipDraft,
} from "@/panel-kits/terminal/composer/session.ts";

afterEach(resetTerminalComposerSessionsForTests);

describe("terminal composer session ownership", () => {
  it("invalidates all payloads before abort and rejects stale writers after id reuse", () => {
    const session = getOrCreateTerminalComposerSession("terminal");
    const chip = { count: 1, label: "Comments", payloadText: "review" };
    const attachments = [
      { id: "file", kind: "file" as const, name: "file", path: "/file" },
    ];
    writeComposerDraft(session, "unsent");
    writeComposerEditorSnapshot(session, "editor snapshot");
    writeReviewChipDraft(session, chip);
    writeComposerAttachments(session, attachments);
    expect(getOrCreateTerminalComposerSession("terminal")).toBe(session);
    session.signal.addEventListener(
      "abort",
      () => {
        expect(getTerminalComposerSession("terminal")).toBeNull();
        expect(readComposerDraft(session)).toBe("");
        expect(readComposerEditorSnapshot(session)).toBeNull();
        expect(readReviewChipDraft(session)).toBeNull();
        expect(readComposerAttachments(session)).toEqual([]);
      },
      { once: true }
    );

    disposeTerminalComposerSession("terminal");
    disposeTerminalComposerSession("terminal");
    const next = getOrCreateTerminalComposerSession("terminal");
    writeComposerDraft(next, "new terminal");
    writeComposerDraft(session, "late draft");
    writeComposerEditorSnapshot(session, "late snapshot");
    writeReviewChipDraft(session, chip);
    writeComposerAttachments(session, attachments);
    expect(session.signal.aborted).toBe(true);
    expect(next.signal.aborted).toBe(false);
    expect(readComposerDraft(next)).toBe("new terminal");
    expect(readComposerEditorSnapshot(next)).toBeNull();
    expect(readReviewChipDraft(next)).toBeNull();
    expect(readComposerAttachments(next)).toEqual([]);
  });

  it("commit clears composition including attachments without ending the session", () => {
    const session = getOrCreateTerminalComposerSession("terminal");
    writeComposerDraft(session, "sent");
    writeComposerEditorSnapshot(session, "snapshot");
    writeReviewChipDraft(session, {
      count: 1,
      label: "Comments",
      payloadText: "sent",
    });
    const attachments = [
      { id: "file", kind: "file" as const, name: "file", path: "/file" },
    ];
    writeComposerAttachments(session, attachments);
    const lease = acquireComposerSend(session, "sent");
    expect(lease).not.toBeNull();
    expect(commitComposerSend(session, lease!)).toBe(true);
    expect(readComposerDraft(session)).toBe("");
    expect(readComposerEditorSnapshot(session)).toBeNull();
    expect(readReviewChipDraft(session)).toBeNull();
    expect(readComposerAttachments(session)).toEqual([]);
    releaseComposerSend(session, lease!);
    writeComposerDraft(session, "next message");
    expect(getTerminalComposerSession("terminal")).toBe(session);
    expect(readComposerDraft(session)).toBe("next message");
  });

  it("refuses to acquire a send while hidden edits are still unapplied", () => {
    const session = getOrCreateTerminalComposerSession("terminal");
    writeComposerDraft(session, "body");
    expect(appendComposerEdit(session, { kind: "text", text: "pending" })).toBe(
      true
    );
    expect(acquireComposerSend(session, "body")).toBeNull();
  });

  it("skips queued merge work captured before a successful send commit", async () => {
    const session = getOrCreateTerminalComposerSession("terminal");
    const gate = Promise.withResolvers<void>();
    const completed: string[] = [];
    const first = enqueueComposerAttachmentMerge(session, () => gate.promise);
    await Promise.resolve();
    const queued = enqueueComposerAttachmentMerge(session, () => {
      completed.push("queued before commit");
    });
    const lease = acquireComposerSend(session, "body");
    expect(lease).not.toBeNull();
    expect(commitComposerSend(session, lease!)).toBe(true);
    releaseComposerSend(session, lease!);
    const after = enqueueComposerAttachmentMerge(session, () => {
      completed.push("after commit");
    });
    gate.resolve();
    await Promise.all([first, queued, after]);
    expect(completed).toEqual(["after commit"]);
  });

  it("isolates merge queues and skips queued work after closing a blocked terminal", async () => {
    const session = getOrCreateTerminalComposerSession("terminal");
    const other = getOrCreateTerminalComposerSession("other");
    const gate = Promise.withResolvers<void>();
    const completed: string[] = [];
    const first = enqueueComposerAttachmentMerge(session, () => gate.promise);
    await Promise.resolve();
    const queued = enqueueComposerAttachmentMerge(session, () => {
      completed.push("old queued");
    });
    await enqueueComposerAttachmentMerge(other, () => {
      completed.push("other");
    });
    expect(completed).toEqual(["other"]);
    disposeTerminalComposerSession("terminal");
    const next = getOrCreateTerminalComposerSession("terminal");
    await enqueueComposerAttachmentMerge(next, () => {
      completed.push("new terminal");
    });
    gate.resolve();
    await Promise.all([first, queued]);
    await enqueueComposerAttachmentMerge(session, () => {
      completed.push("stale");
    });
    expect(completed).toEqual(["other", "new terminal"]);
  });

  it("continues a terminal's queue after rejection, preserving serial order", async () => {
    const session = getOrCreateTerminalComposerSession("terminal");
    const gate = Promise.withResolvers<void>();
    const completed: string[] = [];
    const first = enqueueComposerAttachmentMerge(session, async () => {
      await gate.promise;
      completed.push("first");
      throw new Error("attachment failed");
    });
    const second = enqueueComposerAttachmentMerge(session, () => {
      completed.push("second");
    });
    const rejection = expect(first).rejects.toThrow("attachment failed");
    expect(completed).toEqual([]);
    gate.resolve();
    await rejection;
    await second;
    expect(completed).toEqual(["first", "second"]);
  });
});
