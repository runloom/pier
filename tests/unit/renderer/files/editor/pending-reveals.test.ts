import { FileEditorPendingReveals } from "@plugins/builtin/files/renderer/editor/pending-reveals.ts";
import { describe, expect, it, vi } from "vitest";

describe("FileEditorPendingReveals", () => {
  it("queues for a detached retained session even though savedState still has a line", () => {
    const reveals = new FileEditorPendingReveals();
    const revealRange = vi.fn();

    // 真实 ViewSession 语义：detach 保留 #savedState，currentLine() 恒非
    // null——「已挂载」判据必须是 hasView()，否则 reveal 被误判已应用而丢弃
    // （source → 预览 → 跳转 的主路径）。
    const applied = reveals.revealRange(
      {
        documentId: "document-a",
        hasView: () => false,
        revealRange,
      },
      "session-1",
      "document-a",
      5,
      5
    );

    expect(applied).toBe(false);
    expect(revealRange).not.toHaveBeenCalled();
    expect(reveals.map.get("session-1")).toEqual({
      documentId: "document-a",
      from: 5,
      to: 5,
    });
  });

  it("applies immediately only when a live view is attached", () => {
    const reveals = new FileEditorPendingReveals();
    const revealRange = vi.fn();

    const applied = reveals.revealRange(
      {
        documentId: "document-a",
        hasView: () => true,
        revealRange,
      },
      "session-1",
      "document-a",
      7,
      9
    );

    expect(applied).toBe(true);
    expect(revealRange).toHaveBeenCalledWith(7, 9);
    expect(reveals.map.has("session-1")).toBe(false);
  });

  it("does not apply or queue a reveal against a replacement document", () => {
    const reveals = new FileEditorPendingReveals();
    const revealRange = vi.fn();

    const applied = reveals.revealRange(
      {
        documentId: "document-b",
        hasView: () => true,
        revealRange,
      },
      "session-1",
      "document-a",
      5,
      5
    );

    expect(applied).toBe(false);
    expect(revealRange).not.toHaveBeenCalled();
    expect(reveals.map.has("session-1")).toBe(false);
  });

  it("discards a delayed reveal when a replacement document mounts", () => {
    const reveals = new FileEditorPendingReveals();
    reveals.revealRange(undefined, "session-1", "document-a", 5, 5);

    expect(reveals.take("session-1", "document-b")).toBeNull();
    expect(reveals.map.has("session-1")).toBe(false);
  });
});
