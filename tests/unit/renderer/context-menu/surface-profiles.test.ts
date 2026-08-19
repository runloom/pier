import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  expandContextMenuSurfaces,
  getSurfaceProfile,
  listedContextMenuSurfaces,
  PANEL_CONTENT_SURFACE,
  PANEL_EDIT_SURFACE,
  PANEL_LAYOUT_SURFACE,
  SURFACE_PROFILES,
  shouldActivatePanelForContextMenu,
} from "@/lib/context-menu/surface-profiles.ts";

const SRC_ROOT = join(process.cwd(), "src");

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkSourceFiles(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** 扫描 popupContextMenuAt("…") / contextMenu.popup("…") / useContextMenu("…") 字面量。 */
function collectPopupSurfaceLiterals(): string[] {
  const patterns = [
    /(?:popupContextMenuAt|contextMenu\s*\.\s*popup)\s*\(\s*["']([^"']+)["']/g,
    /useContextMenu\s*\(\s*["']([^"']+)["']/g,
  ];
  const found = new Set<string>();
  for (const file of walkSourceFiles(SRC_ROOT)) {
    const text = readFileSync(file, "utf8");
    for (const re of patterns) {
      re.lastIndex = 0;
      for (const match of text.matchAll(re)) {
        const surface = match[1];
        if (surface) {
          found.add(surface);
        }
      }
    }
  }
  return [...found].sort();
}

describe("context-menu surface profiles", () => {
  it("expands panel/content into edit + layout", () => {
    expect(expandContextMenuSurfaces(PANEL_CONTENT_SURFACE)).toEqual([
      PANEL_CONTENT_SURFACE,
      PANEL_EDIT_SURFACE,
      PANEL_LAYOUT_SURFACE,
    ]);
  });

  it("keeps object trees free of edit and layout merge", () => {
    for (const surface of [
      "files/breadcrumb",
      "files/tree-item",
      "files/tree-background",
      "files/search-result",
      "git/review-tree-item",
    ] as const) {
      expect(expandContextMenuSurfaces(surface)).toEqual([surface]);
      const profile = getSurfaceProfile(surface);
      expect(profile?.mergeEdit).toBe(false);
      expect(profile?.mergeLayout).toBe(false);
      expect(profile?.role).toBe("object");
    }
  });

  it("merges layout only for terminal live content", () => {
    expect(expandContextMenuSurfaces("terminal/content")).toEqual([
      "terminal/content",
      PANEL_LAYOUT_SURFACE,
    ]);
  });

  it("merges edit only for markdown preview", () => {
    expect(expandContextMenuSurfaces("files/markdown-preview")).toEqual([
      "files/markdown-preview",
      PANEL_EDIT_SURFACE,
    ]);
  });

  it("merges edit only for canvas preview", () => {
    expect(expandContextMenuSurfaces("files/canvas-preview")).toEqual([
      "files/canvas-preview",
      PANEL_EDIT_SURFACE,
    ]);
    expect(shouldActivatePanelForContextMenu("files/canvas-preview")).toBe(
      false
    );
  });

  it("merges edit and layout for terminal restored DOM results", () => {
    expect(expandContextMenuSurfaces("terminal/restored")).toEqual([
      "terminal/restored",
      PANEL_EDIT_SURFACE,
      PANEL_LAYOUT_SURFACE,
    ]);
    expect(
      getSurfaceProfile("terminal/restored")?.specializedEditPipeline
    ).toBe(false);
  });

  it("does not merge unknown surfaces", () => {
    expect(expandContextMenuSurfaces("plugin.unknown/surface")).toEqual([
      "plugin.unknown/surface",
    ]);
  });

  it("lists all registered surfaces", () => {
    expect(listedContextMenuSurfaces()).toEqual(
      Object.keys(SURFACE_PROFILES).sort()
    );
  });

  it("registers every popup / useContextMenu surface literal in src", () => {
    const literals = collectPopupSurfaceLiterals();
    const missing = literals.filter((surface) => !SURFACE_PROFILES[surface]);
    expect(
      missing,
      `Unregistered context-menu surfaces (add to SURFACE_PROFILES): ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("does not force setActive for document/viewport content menus", () => {
    expect(shouldActivatePanelForContextMenu("git/review-diff")).toBe(false);
    expect(shouldActivatePanelForContextMenu(PANEL_CONTENT_SURFACE)).toBe(
      false
    );
    expect(shouldActivatePanelForContextMenu("files/editor")).toBe(false);
    expect(shouldActivatePanelForContextMenu("terminal/content")).toBe(false);
    expect(shouldActivatePanelForContextMenu("dockview-tab")).toBe(false);
    expect(shouldActivatePanelForContextMenu("git/review-tree-item")).toBe(
      true
    );
    expect(shouldActivatePanelForContextMenu("files/tree-item")).toBe(true);
  });
});
