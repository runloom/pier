import {
  collapseFileTreeMultiSelectOnEscape,
  handleFileTreeHostKeyDown,
  isFileTreeEditingKeyEvent,
} from "@pier/ui/file/tree-selection-model.ts";
import { describe, expect, it, vi } from "vitest";

function keyEvent(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ...init,
  });
}

describe("file-tree selection model host keys", () => {
  it("treats shadow-retargeted rename inputs as editing", () => {
    const input = document.createElement("input");
    const event = keyEvent("Backspace");
    Object.defineProperty(event, "composedPath", {
      value: () => [input, document.createElement("div")],
    });
    expect(isFileTreeEditingKeyEvent(event)).toBe(true);
    expect(isFileTreeEditingKeyEvent(keyEvent("Backspace"))).toBe(false);
  });

  it("does not collapse multi-select when product search is open", () => {
    const selectOnlyPath = vi.fn();
    const model = {
      focusPath: vi.fn(),
      getFocusedPath: () => "a.ts",
      getItem: () => null,
      getSelectedPaths: () => ["a.ts", "b.ts"],
      isSearchOpen: () => false,
      replaceSelectedPaths: vi.fn(),
      selectOnlyPath,
      selectPathRange: vi.fn(),
      togglePathSelectionFromInput: vi.fn(),
    };
    const event = keyEvent("Escape");
    collapseFileTreeMultiSelectOnEscape(event, model, { searchOpen: true });
    expect(selectOnlyPath).not.toHaveBeenCalled();
    collapseFileTreeMultiSelectOnEscape(event, model);
    expect(selectOnlyPath).toHaveBeenCalledWith("a.ts");
  });

  it("opens the focused file on Enter", () => {
    const onOpenPath = vi.fn();
    const selectOnlyPath = vi.fn();
    const model = {
      focusPath: vi.fn(),
      getFocusedPath: () => "b.ts",
      getItem: () => null,
      getSelectedPaths: () => ["a.ts"],
      isSearchOpen: () => false,
      replaceSelectedPaths: vi.fn(),
      selectOnlyPath,
      selectPathRange: vi.fn(),
      togglePathSelectionFromInput: vi.fn(),
    };
    const itemsByPath = new Map([["b.ts", { kind: "file", path: "b.ts" }]]);
    handleFileTreeHostKeyDown(keyEvent("Enter"), model, {
      itemsByPath,
      onOpenPath,
    });
    expect(selectOnlyPath).toHaveBeenCalledWith("b.ts");
    expect(onOpenPath).toHaveBeenCalledWith("b.ts");
  });
});
