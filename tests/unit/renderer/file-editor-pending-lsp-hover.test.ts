import { FileEditorPendingLspHover } from "@plugins/builtin/files/renderer/file-editor-pending-lsp-hover.ts";
import { describe, expect, it, vi } from "vitest";

describe("FileEditorPendingLspHover", () => {
  it("keeps the latest intent per editor view without dropping other views", () => {
    const pending = new FileEditorPendingLspHover();

    pending.set("panel-one", "document-one");
    pending.set("panel-two", "document-two");
    pending.set("panel-one", "document-three");

    expect(pending.take("panel-one", "document-one")).toBeNull();
    expect(pending.take("panel-two", "document-two")).not.toBeNull();
    expect(pending.take("panel-one", "document-three")).not.toBeNull();
  });

  it("does not consume an intent for an owner mismatch", () => {
    const pending = new FileEditorPendingLspHover();
    pending.set("panel-one", "document-one");

    expect(pending.take("panel-two", "document-one")).toBeNull();
    expect(pending.take("panel-one", "document-one")).not.toBeNull();
  });

  it("does not consume an intent for a document mismatch", () => {
    const pending = new FileEditorPendingLspHover();
    pending.set("panel-one", "document-one");

    expect(pending.take("panel-one", "document-two")).toBeNull();
    expect(pending.take("panel-one", "document-one")).not.toBeNull();
  });

  it("consumes a matching attach intent exactly once", () => {
    const pending = new FileEditorPendingLspHover();
    pending.set("panel-one", "document-one");

    expect(pending.take("panel-one", "document-one")).not.toBeNull();
    expect(pending.take("panel-one", "document-one")).toBeNull();
  });

  it("delivers deferred completion only to the exact editor view owner", () => {
    const pending = new FileEditorPendingLspHover();
    const complete = vi.fn();
    pending.set("view-one", "shared-document", complete);

    expect(pending.take("view-two", "shared-document")).toBeNull();
    pending.take("view-one", "shared-document")?.complete("unavailable");

    expect(complete).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith("unavailable");
  });

  it("clears an intent when the document is replaced or the owner is disposed", () => {
    const pending = new FileEditorPendingLspHover();
    pending.set("panel-one", "document-one");

    pending.clear();

    expect(pending.take("panel-one", "document-one")).toBeNull();
  });
});
