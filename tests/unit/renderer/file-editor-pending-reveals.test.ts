import { FileEditorPendingReveals } from "@plugins/builtin/files/renderer/file-editor-pending-reveals.ts";
import { describe, expect, it, vi } from "vitest";

describe("FileEditorPendingReveals", () => {
  it("queues an exact document-bound range for a detached retained session", () => {
    const reveals = new FileEditorPendingReveals();
    const revealRange = vi.fn();

    const applied = reveals.revealRange(
      {
        currentLine: () => null,
        documentId: "document-a",
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

  it("does not apply or queue a reveal against a replacement document", () => {
    const reveals = new FileEditorPendingReveals();
    const revealRange = vi.fn();

    const applied = reveals.revealRange(
      {
        currentLine: () => 1,
        documentId: "document-b",
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
