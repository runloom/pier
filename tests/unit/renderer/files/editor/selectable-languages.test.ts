import { listSelectableEditorLanguages } from "@plugins/builtin/files/renderer/editor/selectable-languages.ts";
import { describe, expect, it } from "vitest";

describe("listSelectableEditorLanguages", () => {
  it("lists builtin languages without Canvas and includes Plain Text", () => {
    const items = listSelectableEditorLanguages();
    expect(
      items.some((item) => item.id === "text" && item.label === "Plain Text")
    ).toBe(true);
    expect(items.some((item) => item.id === "typescript")).toBe(true);
    expect(items.some((item) => item.id === "canvas")).toBe(false);
    const labels = items.map((item) => item.label);
    expect(labels).toEqual(
      [...labels].sort((left, right) => left.localeCompare(right))
    );
  });
});
