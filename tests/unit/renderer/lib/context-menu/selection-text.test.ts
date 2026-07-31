import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureDomSelectionText,
  hasSpecializedEditPipelineSurface,
  registerSelectionTextProvider,
  selectedTextFromInvocation,
} from "@/lib/context-menu/selection-text.ts";

describe("selection-text", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captures non-empty DOM selection text", () => {
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      toString: () => "hello\u00a0world",
    } as Selection);

    expect(captureDomSelectionText()).toBe("hello world");
  });

  it("falls back to registered providers when DOM selection is empty", () => {
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: true,
      toString: () => "",
    } as Selection);
    const dispose = registerSelectionTextProvider(
      "panel-a",
      () => "diff lines"
    );

    expect(captureDomSelectionText("panel-a")).toBe("diff lines");
    expect(captureDomSelectionText("panel-b")).toBe("");
    dispose();
    expect(captureDomSelectionText("panel-a")).toBe("");
  });

  it("returns empty string for collapsed selection without providers", () => {
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: true,
      toString: () => "ignored",
    } as Selection);

    expect(captureDomSelectionText()).toBe("");
  });

  it("reads selectedText from invocation metadata", () => {
    expect(
      selectedTextFromInvocation({ metadata: { selectedText: "diff line" } })
    ).toBe("diff line");
    expect(selectedTextFromInvocation({ metadata: { selectedText: 1 } })).toBe(
      ""
    );
  });

  it("specialized edit pipeline is only terminal live and files editor", () => {
    expect(hasSpecializedEditPipelineSurface("terminal/content")).toBe(true);
    expect(hasSpecializedEditPipelineSurface("files/editor")).toBe(true);
    // Trees are object surfaces: no specialized pipeline; they simply do not merge edit.
    expect(hasSpecializedEditPipelineSurface("files/tree-item")).toBe(false);
    expect(hasSpecializedEditPipelineSurface("files/tree-background")).toBe(
      false
    );
    expect(hasSpecializedEditPipelineSurface("git/review-tree-item")).toBe(
      false
    );
    expect(hasSpecializedEditPipelineSurface("panel/content")).toBe(false);
    expect(hasSpecializedEditPipelineSurface("files/markdown-preview")).toBe(
      false
    );
  });
});
