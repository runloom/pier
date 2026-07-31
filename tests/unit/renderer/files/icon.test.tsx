import {
  fileNameFromTabIconId,
  fileTabIconId,
  PierFileIcon,
} from "@pier/ui/file/icon.tsx";
import {
  isCanvasFileIconName,
  mergeCanvasFileIconIntoBuiltInSpriteSheet,
  PIER_CANVAS_FILE_EXTENSIONS,
  PIER_CANVAS_FILE_ICON_SYMBOL,
  PIER_CANVAS_FILE_ICON_SYMBOL_ID,
  PIER_CANVAS_FILE_ICON_TOKEN,
  PIER_FILE_ICON_CUSTOM_SPRITE_SHEET,
  PIER_FILE_TREE_ICONS,
} from "@pier/ui/file/icon-config.ts";
import {
  pierFileTreeStyle,
  TREE_SCROLLBAR_CSS,
} from "@pier/ui/file/tree-style.ts";
import { LIVE_MODULE_CANVAS_FILE_SUFFIXES } from "@shared/live-module-framework.ts";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

describe("Pier file icon", () => {
  afterEach(() => {
    document.querySelector('[data-pier-file-icon-sprite="true"]')?.remove();
  });
  it("encodes only the basename in a namespaced tab icon id", () => {
    const iconId = fileTabIconId("src/components/file.tsx");

    expect(iconId).toBe("pier.file:file.tsx");
    expect(fileNameFromTabIconId(iconId)).toBe("file.tsx");
    expect(fileNameFromTabIconId("pier.file:%E0%A4%A")).toBeNull();
    expect(fileNameFromTabIconId("terminal")).toBeNull();
  });

  it("keeps canvas icon extensions aligned with live-module framework suffixes", () => {
    const fromFramework = new Set(
      LIVE_MODULE_CANVAS_FILE_SUFFIXES.map((suffix) =>
        suffix.startsWith(".") ? suffix.slice(1) : suffix
      )
    );
    const fromIcons = new Set<string>(PIER_CANVAS_FILE_EXTENSIONS);
    expect([...fromIcons].sort()).toEqual([...fromFramework].sort());
  });

  it("uses the complete file-tree resolver and shared color token", () => {
    const { container } = render(<PierFileIcon fileName="src/file.ts" />);
    const icon = container.querySelector("[data-pier-file-icon]");

    expect(icon).toHaveAttribute("data-icon-token", "typescript");
    expect(icon).toHaveStyle({ color: "var(--pier-file-icon-blue)" });
    expect(icon?.querySelector("use")).toHaveAttribute(
      "href",
      "#file-tree-builtin-typescript"
    );
    expect(pierFileTreeStyle(undefined)).toMatchObject({
      "--trees-file-icon-color-typescript": "var(--pier-file-icon-blue)",
      "--trees-file-icon-color-canvas": "var(--pier-file-icon-indigo)",
    });
  });

  it("wires tree-only canvas icon config and shadow-DOM color CSS", () => {
    expect(PIER_FILE_TREE_ICONS.set).toBe("complete");
    expect(PIER_FILE_TREE_ICONS.colored).toBe(true);
    expect(PIER_FILE_TREE_ICONS.spriteSheet).toBe(
      PIER_FILE_ICON_CUSTOM_SPRITE_SHEET
    );
    expect(PIER_FILE_ICON_CUSTOM_SPRITE_SHEET).toContain(
      `id="${PIER_CANVAS_FILE_ICON_SYMBOL_ID}"`
    );
    for (const extension of PIER_CANVAS_FILE_EXTENSIONS) {
      expect(PIER_FILE_TREE_ICONS.byFileExtension).toHaveProperty(extension);
    }
    expect(TREE_SCROLLBAR_CSS).toContain('[data-icon-token="canvas"]');
    expect(TREE_SCROLLBAR_CSS).toContain("var(--trees-file-icon-color-canvas)");
  });

  it("merges the canvas glyph into the built-in sheet for PierFileIcon", () => {
    const builtIn = `<svg xmlns="http://www.w3.org/2000/svg"><symbol id="file-tree-builtin-typescript"/></svg>`;
    const merged = mergeCanvasFileIconIntoBuiltInSpriteSheet(builtIn);
    expect(merged).toContain(`id="${PIER_CANVAS_FILE_ICON_SYMBOL_ID}"`);
    expect(merged).toContain(PIER_CANVAS_FILE_ICON_SYMBOL);
    expect(merged.endsWith("</svg>")).toBe(true);
    // Idempotent when the symbol is already present.
    expect(mergeCanvasFileIconIntoBuiltInSpriteSheet(merged)).toBe(merged);
  });

  it("uses a dedicated canvas glyph for live-module canvas suffixes", () => {
    expect(isCanvasFileIconName("hello.canvas.tsx")).toBe(true);
    expect(isCanvasFileIconName("nested/hello.canvas.vue")).toBe(true);
    expect(isCanvasFileIconName("hello.tsx")).toBe(false);

    const { container } = render(
      <PierFileIcon fileName=".pier/canvases/smoke/hello.canvas.tsx" />
    );
    const icon = container.querySelector("[data-pier-file-icon]");

    expect(icon).toHaveAttribute(
      "data-icon-token",
      PIER_CANVAS_FILE_ICON_TOKEN
    );
    expect(icon).toHaveStyle({ color: "var(--pier-file-icon-indigo)" });
    expect(icon?.querySelector("use")).toHaveAttribute(
      "href",
      `#${PIER_CANVAS_FILE_ICON_SYMBOL_ID}`
    );
    expect(
      document.querySelector(
        `[data-pier-file-icon-sprite="true"] #${PIER_CANVAS_FILE_ICON_SYMBOL_ID}`
      )
    ).not.toBeNull();
  });

  it.each([
    "hello.canvas.tsx",
    "hello.canvas.jsx",
    "hello.canvas.vue",
    "hello.canvas.svelte",
    "hello.canvas.solid.tsx",
    "hello.canvas.solid.jsx",
  ] as const)("maps %s to the canvas icon token", (fileName) => {
    const { container } = render(<PierFileIcon fileName={fileName} />);
    const icon = container.querySelector("[data-pier-file-icon]");
    expect(icon).toHaveAttribute(
      "data-icon-token",
      PIER_CANVAS_FILE_ICON_TOKEN
    );
    expect(icon?.querySelector("use")).toHaveAttribute(
      "href",
      `#${PIER_CANVAS_FILE_ICON_SYMBOL_ID}`
    );
  });

  it("mounts one shared complete sprite sheet for multiple icons", () => {
    render(
      <>
        <PierFileIcon fileName="file.ts" />
        <PierFileIcon fileName="README.md" />
        <PierFileIcon fileName="hello.canvas.tsx" />
      </>
    );

    expect(
      document.querySelectorAll(
        '[data-pier-file-icon-sprite="true"] #file-tree-builtin-typescript'
      )
    ).toHaveLength(1);
    expect(
      document.querySelectorAll(
        `[data-pier-file-icon-sprite="true"] #${PIER_CANVAS_FILE_ICON_SYMBOL_ID}`
      )
    ).toHaveLength(1);
  });
});
