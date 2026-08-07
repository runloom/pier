import type { CodeViewHandle } from "@pierre/diffs/react";
import { describe, expect, it, vi } from "vitest";
import {
  CONTENT_DRAG_THRESHOLD_PX,
  isDiffCodeSelection,
  isGutterUtilityPath,
  readBrowserSelectedText,
  resolveDiffPointerLineHit,
  selectionFromPointerDrag,
} from "../../../../packages/ui/src/diff-view/pointer-selection.ts";

function makeEvent(
  target: Element
): Pick<PointerEvent, "composedPath" | "target" | "clientX" | "clientY"> {
  const path: EventTarget[] = [];
  let node: Element | null = target;
  while (node) {
    path.push(node);
    node = node.parentElement;
  }
  return {
    clientX: 0,
    clientY: 0,
    composedPath: () => path,
    target,
  };
}

describe("resolveDiffPointerLineHit", () => {
  it("resolves content line hits", () => {
    const host = document.createElement("diffs-container");
    const code = document.createElement("div");
    code.setAttribute("data-code", "");
    code.setAttribute("data-additions", "");
    const line = document.createElement("span");
    line.setAttribute("data-line", "13");
    code.append(line);
    host.append(code);

    const viewer = {
      getInstance: () => ({
        getRenderedItems: () => [
          {
            element: host,
            id: "file.ts",
          },
        ],
      }),
    } as unknown as CodeViewHandle;

    expect(resolveDiffPointerLineHit(makeEvent(line), viewer)).toEqual({
      fromNumberColumn: false,
      id: "file.ts",
      lineNumber: 13,
      side: "additions",
    });
  });

  it("marks number-column hits for Pierre-native line selection handoff", () => {
    const host = document.createElement("diffs-container");
    const number = document.createElement("span");
    number.setAttribute("data-column-number", "8");
    host.append(number);

    const viewer = {
      getInstance: () => ({
        getRenderedItems: () => [
          {
            element: host,
            id: "file.ts",
          },
        ],
      }),
    } as unknown as CodeViewHandle;

    expect(resolveDiffPointerLineHit(makeEvent(number), viewer)).toEqual({
      fromNumberColumn: true,
      id: "file.ts",
      lineNumber: 8,
      side: "additions",
    });
  });
});

describe("selectionFromPointerDrag", () => {
  it("builds a same-side range from anchor to current", () => {
    expect(
      selectionFromPointerDrag(
        {
          fromNumberColumn: false,
          id: "file-a",
          lineNumber: 11,
          side: "additions",
        },
        {
          fromNumberColumn: false,
          id: "file-a",
          lineNumber: 17,
          side: "additions",
        }
      )
    ).toEqual({
      id: "file-a",
      range: {
        end: 17,
        side: "additions",
        start: 11,
      },
    });
  });
});

describe("isGutterUtilityPath", () => {
  it("detects the native + utility button", () => {
    const button = document.createElement("button");
    button.setAttribute("data-utility-button", "");
    expect(isGutterUtilityPath([button])).toBe(true);
  });
});

describe("isDiffCodeSelection", () => {
  it("recognizes selection under data-line", () => {
    const line = document.createElement("span");
    line.setAttribute("data-line", "1");
    const text = document.createTextNode("code");
    line.append(text);
    document.body.append(line);
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(isDiffCodeSelection(selection)).toBe(true);
    selection?.removeAllRanges();
    line.remove();
  });

  it("rejects selection outside diff code", () => {
    const div = document.createElement("div");
    div.textContent = "ui chrome";
    document.body.append(div);
    const range = document.createRange();
    range.selectNodeContents(div);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(isDiffCodeSelection(selection)).toBe(false);
    selection?.removeAllRanges();
    div.remove();
  });
});

describe("readBrowserSelectedText", () => {
  it("normalizes nbsp and ignores collapsed selection", () => {
    const getSelection = vi.spyOn(window, "getSelection");
    getSelection.mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => "a\u00a0b",
      getRangeAt: () =>
        ({
          collapsed: false,
          toString: () => "a\u00a0b",
          cloneContents: () => ({ textContent: "" }),
        }) as unknown as Range,
    } as Selection);
    expect(readBrowserSelectedText()).toBe("a b");
    getSelection.mockReturnValue({
      isCollapsed: true,
      rangeCount: 0,
      toString: () => "ignored",
    } as Selection);
    expect(readBrowserSelectedText()).toBe("");
    getSelection.mockRestore();
  });

  it("falls back to cloneContents when toString is empty", () => {
    const getSelection = vi.spyOn(window, "getSelection");
    const fragment = document.createDocumentFragment();
    fragment.append(document.createTextNode("shadow\u00a0text"));
    getSelection.mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => "",
      getRangeAt: () =>
        ({
          collapsed: false,
          toString: () => "",
          cloneContents: () => fragment,
        }) as unknown as Range,
    } as Selection);
    expect(readBrowserSelectedText()).toBe("shadow text");
    getSelection.mockRestore();
  });
});

describe("content selection contract", () => {
  it("wires threshold, isDiffCodeSelection, and scoped sticky", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const contentSource = await readFile(
      join(process.cwd(), "packages/ui/src/diff-view/use-content-selection.ts"),
      "utf8"
    );
    const handleSource = await readFile(
      join(process.cwd(), "packages/ui/src/diff-view/use-handle.ts"),
      "utf8"
    );
    const appearanceSource = await readFile(
      join(process.cwd(), "packages/ui/src/diff-view/appearance.ts"),
      "utf8"
    );
    const buildEntries = await readFile(
      join(process.cwd(), "src/renderer/lib/context-menu/build-entries.ts"),
      "utf8"
    );

    expect(contentSource).not.toContain("setSelectedLines");
    expect(contentSource).toContain("CONTENT_DRAG_THRESHOLD_PX");
    expect(contentSource).toContain("isDiffCodeSelection");
    expect(contentSource).toContain("clearCopySnapshot");
    expect(contentSource).toContain("readBrowserSelectionLineSpan");
    expect(contentSource).toContain("handleContextMenuCapture");
    expect(handleSource).toContain("getDiffCopyStickyText");
    expect(appearanceSource).toMatch(/user-select:\s*text/);
    expect(buildEntries).toContain("isDiffCopyStickySurface");
    expect(CONTENT_DRAG_THRESHOLD_PX).toBeGreaterThan(0);

    const stickySource = await readFile(
      join(process.cwd(), "packages/ui/src/diff-view/copy-sticky.ts"),
      "utf8"
    );
    expect(stickySource).toContain("globalThis");
    expect(stickySource).toContain("isDiffCopyStickySurface");
  });
});

describe("copy-sticky global store", () => {
  it("survives across import identities (globalThis)", async () => {
    const a = await import(
      "../../../../packages/ui/src/diff-view/copy-sticky.ts"
    );
    a.clearDiffCopyStickyText();
    a.pinDiffCopyStickyText("hello-copy");
    expect(a.getDiffCopyStickyText()).toBe("hello-copy");
    const b = await import(
      "../../../../packages/ui/src/diff-view/copy-sticky.ts"
    );
    expect(b.getDiffCopyStickyText()).toBe("hello-copy");
    expect(a.isDiffCopyStickySurface("git/review-diff")).toBe(true);
    expect(a.isDiffCopyStickySurface("panel/edit")).toBe(false);
    a.clearDiffCopyStickyText();
  });
});
