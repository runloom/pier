import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureDomSelectionText,
  registerSelectionTextProvider,
  selectedTextFromInvocation,
  surfaceHasLocalCopyAction,
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
    const dispose = registerSelectionTextProvider(() => "diff lines");

    expect(captureDomSelectionText()).toBe("diff lines");
    dispose();
    expect(captureDomSelectionText()).toBe("");
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

  it("hides shared copy on terminal, editor, and tree surfaces", () => {
    expect(surfaceHasLocalCopyAction("terminal/content")).toBe(true);
    expect(surfaceHasLocalCopyAction("files/editor")).toBe(true);
    expect(surfaceHasLocalCopyAction("files/tree-item")).toBe(true);
    expect(surfaceHasLocalCopyAction("files/tree-background")).toBe(true);
    expect(surfaceHasLocalCopyAction("git/review-tree-item")).toBe(true);
    expect(surfaceHasLocalCopyAction("panel/content")).toBe(false);
  });
});
