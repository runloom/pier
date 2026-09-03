import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-03-overlay-separator-gold-standard.md";
const TOKENS = "packages/ui/src/separator.tsx";
const CREATE_MENU = "src/renderer/components/workspace/add-panel-action.tsx";
const MANAGE_AGENTS =
  "src/renderer/components/workspace/create-menu-manage-agents.tsx";
const NOTIFICATIONS =
  "src/renderer/components/common/notifications/center-control.tsx";

const MENU_SEPARATOR_CONSUMERS = [
  "packages/ui/src/command.tsx",
  "packages/ui/src/context-menu.tsx",
  "packages/ui/src/dropdown-menu.tsx",
  "packages/ui/src/menubar.tsx",
  "packages/ui/src/select.tsx",
] as const;

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("overlay separator gold standard", () => {
  it("documents the contract in AGENTS.md and the spec", () => {
    const agents = read("AGENTS.md");
    const spec = read(SPEC);
    expect(existsSync(join(ROOT, SPEC))).toBe(true);
    expect(agents).toContain("### 浮层分割线");
    expect(agents).toContain("separator.tsx");
    expect(agents).toContain(
      "tests/unit/renderer/overlay-separator-governance.test.ts"
    );
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("贴齐菜单壳");
    expect(spec).toContain("决策树");
    expect(spec).toContain("OVERLAY_MENU_SEPARATOR_CLASS");
    expect(spec).toContain("OVERLAY_REGION_FOOTER_CLASS");
    expect(spec).toContain("Popover + Command 杂交壳");
    expect(spec).toContain("rounded-none");
    expect(spec).toContain("给页脚加");
    expect(spec).toContain("明确不做");
  });

  it("keeps overlay hairline class strings in one token module", () => {
    const tokens = read(TOKENS);
    expect(tokens).toContain(
      'OVERLAY_MENU_SEPARATOR_CLASS = "-mx-1 my-1 h-px bg-border/50"'
    );
    expect(tokens).toContain('OVERLAY_REGION_SEPARATOR_CLASS = "bg-border/50"');
    expect(tokens).toContain(
      'OVERLAY_REGION_FOOTER_CLASS = "border-border/50 border-t p-1"'
    );
  });

  it("keeps p-1 menu primitives on OVERLAY_MENU_SEPARATOR_CLASS", () => {
    for (const file of MENU_SEPARATOR_CONSUMERS) {
      const source = read(file);
      expect(source, file).toContain("OVERLAY_MENU_SEPARATOR_CLASS");
      expect(source, file).not.toContain("-mx-1 my-1 h-px bg-border");
    }
  });

  it("keeps the create-menu footer as a full-bleed region rule outside cmdk", () => {
    const manage = read(MANAGE_AGENTS);
    const createMenu = read(CREATE_MENU);
    expect(manage).toContain("OVERLAY_REGION_FOOTER_CLASS");
    expect(manage).not.toContain("CommandSeparator");
    expect(manage).not.toContain("CommandItem");
    expect(manage).not.toContain("DropdownMenuSeparator");
    expect(manage).not.toContain("<hr");
    expect(manage).not.toContain('size="sm"');
    expect(manage).not.toMatch(/\bmx-1\b/);
    expect(manage).not.toMatch(/\bmx-2\b/);
    expect(createMenu).toContain("overflow-hidden p-0");
    expect(createMenu).toContain("rounded-none pb-0");
    expect(createMenu).toContain("CreateMenuManageAgents");
  });

  it("keeps the notification popover title/list rule full-bleed", () => {
    const notifications = read(NOTIFICATIONS);
    expect(notifications).toContain("OVERLAY_REGION_SEPARATOR_CLASS");
    expect(notifications).toContain("overflow-hidden p-0");
    expect(notifications).not.toContain("opacity-50");
    expect(notifications).not.toMatch(/\bmx-1\b/);
    expect(notifications).not.toMatch(/\bmx-2\b/);
  });
});
