import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const CONTROL_HEIGHT_CONSUMERS = [
  "packages/ui/src/button.tsx",
  "packages/ui/src/command.tsx",
  "packages/ui/src/input-group.tsx",
  "packages/ui/src/input.tsx",
  "packages/ui/src/menubar.tsx",
  "packages/ui/src/navigation-menu.tsx",
  "packages/ui/src/select.tsx",
  "packages/ui/src/shortcut-input.tsx",
  "packages/ui/src/tabs.tsx",
  "packages/ui/src/toggle.tsx",
  "src/renderer/components/primitives/sidebar.tsx",
] as const;

const CONTROL_ICON_CONSUMERS = [
  "packages/ui/src/button.tsx",
  "packages/ui/src/input-group.tsx",
  "packages/ui/src/input-otp.tsx",
  "packages/ui/src/pagination.tsx",
] as const;

const MENU_ITEM_CONSUMERS = [
  "packages/ui/src/command.tsx",
  "packages/ui/src/context-menu.tsx",
  "packages/ui/src/dropdown-menu.tsx",
  "packages/ui/src/menubar.tsx",
  "packages/ui/src/navigation-menu.tsx",
  "packages/ui/src/select.tsx",
] as const;

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("interactive density governance", () => {
  it("documents the 28px single-line control policy", () => {
    const context = source("AGENTS.md");

    expect(context).toContain("### 交互控件密度规范");
    expect(context).toContain("单行交互控件统一使用 28px 高度");
    expect(context).toContain("单行必须为 28px，多行说明可按内容自然增高");
  });

  it("keeps the density contract in one packages/ui owner", () => {
    const density = source("packages/ui/src/interactive-density.ts");

    expect(density).toContain('CONTROL_HEIGHT_CLASS = "h-7"');
    expect(density).toContain('CONTROL_ICON_SIZE_CLASS = "size-7"');
    expect(density).toContain('CONTROL_ICON_HIT_COMPACT_CLASS = "size-6"');
    expect(density).toContain(
      "CONTROL_ICON_GLYPH_CLASS =\n  \"[&_svg:not([class*='size-'])]:size-4\""
    );
    expect(density).toContain(
      "CONTROL_ICON_GLYPH_COMPACT_CLASS =\n  \"[&_svg:not([class*='size-'])]:size-3.5\""
    );
    expect(density).toContain(
      "CONTROL_ICON_GLYPH_SM_CLASS =\n  \"[&_svg:not([class*='size-'])]:size-3\""
    );
    expect(density).toContain(
      'MENU_ITEM_DENSITY_CLASS = "min-h-7 py-1 text-sm leading-5"'
    );
  });

  it("keeps icon-xs on compact hit with 14px glyph token", () => {
    const button = source("packages/ui/src/button.tsx");

    expect(button).toContain("CONTROL_ICON_HIT_COMPACT_CLASS");
    expect(button).toContain("CONTROL_ICON_GLYPH_CLASS");
    expect(button).toContain("CONTROL_ICON_GLYPH_COMPACT_CLASS");
    expect(button).toContain("CONTROL_ICON_GLYPH_SM_CLASS");
    // icon-xs uses the compact glyph token — not a raw size-3 (text xs only).
    expect(button).toMatch(
      /"icon-xs":\s*cn\(\s*CONTROL_ICON_HIT_COMPACT_CLASS,\s*CONTROL_ICON_GLYPH_COMPACT_CLASS\s*\)/
    );
    expect(button).not.toMatch(/"icon-xs":\s*[^,\n]*size-3[^\d.]/);
  });

  it("routes standard control height through the shared contract", () => {
    for (const path of CONTROL_HEIGHT_CONSUMERS) {
      expect(source(path), path).toContain("CONTROL_HEIGHT_CLASS");
    }
    for (const path of CONTROL_ICON_CONSUMERS) {
      expect(source(path), path).toContain("CONTROL_ICON_SIZE_CLASS");
    }
  });

  it("routes every menu family and command item through shared item density", () => {
    for (const path of MENU_ITEM_CONSUMERS) {
      const contents = source(path);
      expect(contents, path).toContain("MENU_ITEM_DENSITY_CLASS");
      expect(contents, path).not.toMatch(
        /min-h-7[^"\n]*py-1\.5|py-1\.5[^"\n]*min-h-7/
      );
    }
  });

  it("does not let command quick-pick restore the old oversized padding", () => {
    const quickPick = source(
      "src/renderer/components/common/command-palette-quick-pick-view.tsx"
    );

    expect(quickPick).not.toContain('className="items-center gap-2 py-2"');
    expect(quickPick).not.toContain("gap-2.5 py-0.5");
  });
});
