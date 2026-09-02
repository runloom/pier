import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-02-command-list-heading-gold-standard.md";
const PRESENTER = "src/renderer/lib/command-palette/present-groups.ts";
const COMMANDS_VIEW =
  "src/renderer/components/common/command-palette/action-rows.tsx";
const PALETTE = "src/renderer/components/common/command-palette/index.tsx";
const CREATE_MENU = "src/renderer/components/workspace/add-panel-action.tsx";
const LEGACY_GROUPING =
  "src/renderer/components/workspace/add-panel-create-menu.ts";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("command list group heading gold standard", () => {
  it("documents the contract in AGENTS.md and the spec", () => {
    const agents = read("AGENTS.md");
    const spec = read(SPEC);
    expect(agents).toContain("### 命令列表分组标题");
    expect(agents).toContain(
      "tests/unit/renderer/command-list-group-heading-governance.test.ts"
    );
    expect(agents).toContain("tests/unit/command/present-groups.test.ts");
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("标题门槛");
    expect(spec).toContain("相邻无标题组合并");
    expect(spec).toContain("频次只进");
    expect(spec).toContain("智能体子组");
    expect(spec).toContain("commandListItemValue");
    expect(spec).toContain("presentCommandListGroups");
    expect(spec).toContain("CommandsView");
  });

  it("keeps create menu and command palette on the shared presenter and view", () => {
    const createMenu = read(CREATE_MENU);
    const palette = read(PALETTE);
    const commandsView = read(COMMANDS_VIEW);
    const presenter = read(PRESENTER);
    expect(existsSync(join(ROOT, LEGACY_GROUPING))).toBe(false);
    expect(createMenu).toContain("presentCommandListGroups");
    expect(createMenu).toContain("CommandsView");
    expect(createMenu).not.toContain("heading={categoryHeading");
    expect(createMenu).not.toContain("maxGroupFrecency");
    expect(createMenu).toContain("recentsLimit: 0");
    expect(palette).toContain("presentCommandListGroups");
    expect(palette).toContain("CommandsView");
    expect(palette).not.toContain("heading={categoryHeading");
    expect(palette).not.toContain("compareGroups(");
    expect(commandsView).toContain("heading={group.heading ?? undefined}");
    expect(commandsView).toContain("commandListItemValue(group.id, action.id)");
    expect(commandsView).not.toContain("categoryHeading");
    expect(presenter).not.toContain("compareGroups(");
    expect(presenter).not.toContain("maxGroupFrecency");
    expect(presenter).toContain("AGENT_START_COMMAND_PREFIX");
    expect(presenter).toContain("recentsLimit");
  });
});
