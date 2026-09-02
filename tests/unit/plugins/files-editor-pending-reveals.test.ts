import { FileEditorPendingReveals } from "@plugins/builtin/files/renderer/editor/pending-reveals.ts";
import { describe, expect, it, vi } from "vitest";

describe("FileEditorPendingReveals", () => {
  it("tracks pending range and location reveals for mount skip-scroll", () => {
    const pending = new FileEditorPendingReveals();
    expect(pending.hasPending("s1")).toBe(false);

    pending.revealRange(undefined, "s1", "doc-a", 10, 20);
    expect(pending.hasPending("s1")).toBe(true);
    expect(pending.hasPending("s1", "doc-a")).toBe(true);
    expect(pending.hasPending("s1", "doc-b")).toBe(false);

    pending.cancel("s1");
    expect(pending.hasPending("s1")).toBe(false);

    pending.queueLocation("s1", "doc-a", 3, 1);
    expect(pending.hasPending("s1", "doc-a")).toBe(true);

    const session = {
      documentId: "doc-a",
      hasView: () => true,
      revealRange: vi.fn(),
    };
    expect(pending.revealRange(session, "s1", "doc-a", 1, 1)).toBe(true);
    expect(pending.hasPending("s1")).toBe(false);
  });
});
