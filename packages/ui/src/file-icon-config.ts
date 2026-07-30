import type { FileTreeIcons, RemappedIcon } from "@pierre/trees";

/**
 * Shared Pier file-icon overrides on top of `@pierre/trees` complete set.
 *
 * Canvas live modules (`.canvas.tsx` / `.canvas.vue` / …) have no industry-
 * standard file glyph in VS Code / Material Icon Theme / Pierre built-ins.
 * Closest common metaphor is a multi-panel dashboard layout (Lucide
 * `layout-dashboard`, Figma/artboard mosaics): a composed UI surface rather
 * than a language badge.
 */

export const PIER_CANVAS_FILE_ICON_SYMBOL_ID = "file-tree-pier-canvas";

/** Color token consumed by PierFileIcon + file-tree colored-icons CSS. */
export const PIER_CANVAS_FILE_ICON_TOKEN = "canvas";

/**
 * Compound extensions without a leading dot. Must stay equal (order-
 * independent) to `LIVE_MODULE_CANVAS_FILE_SUFFIXES` in
 * `src/shared/live-module-framework.ts` — locked by
 * `tests/unit/renderer/file-icon.test.tsx`. Package boundary: ui cannot import
 * host `shared/`. Trees resolver walks candidates from the full tail.
 */
export const PIER_CANVAS_FILE_EXTENSIONS = [
  "canvas.solid.tsx",
  "canvas.solid.jsx",
  "canvas.tsx",
  "canvas.jsx",
  "canvas.vue",
  "canvas.svelte",
] as const;

/**
 * Filled 16×16 dashboard mosaic (layout-dashboard metaphor), monochrome via
 * `currentColor` to match other Pierre file glyphs.
 */
export const PIER_CANVAS_FILE_ICON_SYMBOL = `<symbol id="${PIER_CANVAS_FILE_ICON_SYMBOL_ID}" viewBox="0 0 16 16"><path fill="currentColor" d="M2.5 1.5h4a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1zm6.5 0h4.5a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1zM1.5 11a1 1 0 0 1 1-1H5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1zm6.5 0a1 1 0 0 1 1-1h4.5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z"/></symbol>`;

/**
 * Custom sprite fragment for PierFileTree only (`icons.spriteSheet`).
 * Tab / standalone `PierFileIcon` merges the same symbol into the built-in
 * complete sheet via {@link mergeCanvasFileIconIntoBuiltInSpriteSheet}.
 */
export const PIER_FILE_ICON_CUSTOM_SPRITE_SHEET = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">${PIER_CANVAS_FILE_ICON_SYMBOL}</svg>`;

/**
 * Append the canvas glyph into a `@pierre/trees` built-in complete sprite SVG
 * for light-DOM `PierFileIcon` (single sheet, no second mount).
 */
export function mergeCanvasFileIconIntoBuiltInSpriteSheet(
  builtInSvg: string
): string {
  if (builtInSvg.includes(`id="${PIER_CANVAS_FILE_ICON_SYMBOL_ID}"`)) {
    return builtInSvg;
  }
  return builtInSvg.replace(
    "</svg>",
    `${PIER_CANVAS_FILE_ICON_SYMBOL}\n</svg>`
  );
}

/**
 * Runtime `token` is applied by `@pierre/trees` Icon but omitted from the
 * public `RemappedIcon` type — assert so typed config stays assignable.
 */
const CANVAS_FILE_ICON = {
  name: PIER_CANVAS_FILE_ICON_SYMBOL_ID,
  token: PIER_CANVAS_FILE_ICON_TOKEN,
} as RemappedIcon & { token: typeof PIER_CANVAS_FILE_ICON_TOKEN };

const canvasByFileExtension = Object.fromEntries(
  PIER_CANVAS_FILE_EXTENSIONS.map((extension) => [extension, CANVAS_FILE_ICON])
) as Record<string, RemappedIcon>;

/**
 * Single source for PierFileIcon + PierFileTree. Must keep `set: "complete"`
 * when adding overrides — otherwise trees defaults custom-only configs to
 * `set: "none"`.
 */
export const PIER_FILE_TREE_ICONS = {
  set: "complete",
  colored: true,
  spriteSheet: PIER_FILE_ICON_CUSTOM_SPRITE_SHEET,
  byFileExtension: canvasByFileExtension,
} as const satisfies FileTreeIcons;

export function isCanvasFileIconName(fileName: string): boolean {
  const base = fileName.split(/[/\\]/u).at(-1) ?? fileName;
  const lowered = base.toLowerCase();
  return PIER_CANVAS_FILE_EXTENSIONS.some((extension) => {
    const suffix = `.${extension}`;
    return lowered.length > suffix.length && lowered.endsWith(suffix);
  });
}
