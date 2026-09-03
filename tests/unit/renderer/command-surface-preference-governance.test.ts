import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-03-command-surface-preference-gold-standard.md";
const PRESENTER = "src/renderer/lib/command-palette/present-groups.ts";
const ACTION_ROWS =
  "src/renderer/components/common/command-palette/action-rows.tsx";
const PALETTE = "src/renderer/components/common/command-palette/index.tsx";
const CREATE_MENU = "src/renderer/components/workspace/add-panel-action.tsx";
const MANAGE_AGENTS =
  "src/renderer/components/workspace/create-menu-manage-agents.tsx";
const SKILL_RANK =
  "src/renderer/panel-kits/terminal/structured-composer/composer-skill-rank.ts";
const SKILL_SUGGEST =
  "src/renderer/panel-kits/terminal/structured-composer/composer-skill-suggest.ts";
const PATH_QUERY =
  "src/renderer/panel-kits/terminal/structured-composer/composer-path-query.ts";
const FRECENCY = "src/shared/frecency.ts";
const SEARCH_TYPES = "src/renderer/lib/search/types.ts";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function walkSourceFiles(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "out"
      ) {
        continue;
      }
      walkSourceFiles(full, acc);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (
      entry.name.endsWith(".ts") ||
      entry.name.endsWith(".tsx") ||
      entry.name.endsWith(".js")
    ) {
      acc.push(full);
    }
  }
}

function filesWithHalfLifeDecay(): string[] {
  const hits: string[] = [];
  for (const root of ["src/main", "src/renderer", "src/shared"]) {
    const files: string[] = [];
    walkSourceFiles(join(ROOT, root), files);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (source.includes("0.5 **")) {
        hits.push(
          file
            .slice(ROOT.length + 1)
            .split("\\")
            .join("/")
        );
      }
    }
  }
  return hits.sort();
}

describe("command surface preference gold standard", () => {
  it("documents the contract in AGENTS.md and the spec", () => {
    const agents = read("AGENTS.md");
    const spec = read(SPEC);
    expect(existsSync(join(ROOT, SPEC))).toBe(true);
    expect(agents).toContain("### 跨表面偏好分工");
    expect(agents).toContain(
      "tests/unit/renderer/command-surface-preference-governance.test.ts"
    );
    expect(agents).toContain(
      "tests/component/workspace/create-menu-preference.test.tsx"
    );
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("A 热路径");
    expect(spec).toContain("B 目录裁剪");
    expect(spec).toContain("C 习惯副本");
    expect(spec).toContain("D 情境一次");
    expect(spec).toContain("管理智能体");
    expect(spec).toContain("默认");
    expect(spec).toContain("明确不做");
    expect(spec).toContain("rankSearchDocuments");
    expect(spec).toContain("presentCommandListGroups");
    expect(spec).toContain("usageFrecency");
    expect(spec).toContain("scoreFilePath");
    expect(spec).toContain("recentsLimit");
    expect(spec).toContain("`includes` 保序");
  });

  it("keeps create-menu empty state on a stable catalog without recents", () => {
    const createMenu = read(CREATE_MENU);
    const groupsBlock = createMenu.slice(
      createMenu.indexOf("const groups = useMemo"),
      createMenu.indexOf("const ranked = useMemo")
    );
    expect(createMenu).toContain("presentCommandListGroups");
    expect(createMenu).toContain("rankActionsForPalette");
    expect(groupsBlock).toContain("recentsLimit: 0");
    expect(groupsBlock).not.toContain("frecencyMap");
    expect(createMenu).toContain("CreateMenuManageAgents");
    expect(createMenu).not.toContain("openSection(");
  });

  it("keeps the command palette on recents copies plus shared search", () => {
    const palette = read(PALETTE);
    const presenter = read(PRESENTER);
    expect(palette).toContain("COMMAND_PALETTE_RECENTS_LIMIT");
    expect(palette).toContain("presentCommandListGroups");
    expect(palette).toContain("rankActionsForPalette");
    expect(presenter).toContain("recentsLimit");
    expect(presenter).not.toContain("maxGroupFrecency");
    expect(presenter).not.toContain("compareGroups(");
  });

  it("opens agents settings from a non-cmdk create-menu footer", () => {
    const manage = read(MANAGE_AGENTS);
    expect(manage).toContain('openSection("agents")');
    expect(manage).toContain("workspace.addPanelMenu.manageAgents");
    expect(manage).not.toContain("setTimeout");
    expect(manage).not.toContain("CommandItem");
    expect(manage).not.toContain("recordUse");
    expect(manage).not.toContain('size="sm"');
  });

  it("marks the default agent with an outline badge, not a star", () => {
    const rows = read(ACTION_ROWS);
    expect(rows).toContain("defaultAffordance");
    expect(rows).toContain("commandPalette.action.defaultAgentMark");
    expect(rows).toContain("Badge");
    expect(rows).toContain('variant="outline"');
    expect(rows).toContain('size="xs"');
    expect(rows).not.toMatch(/\bStar\b/);
    expect(rows).not.toContain("StatusIcon");
  });

  it("routes slash-query ranking through rankSearchDocuments", () => {
    const rank = read(SKILL_RANK);
    const suggest = read(SKILL_SUGGEST);
    const types = read(SEARCH_TYPES);
    expect(types).toContain('"suggest"');
    expect(rank).toContain("rankSearchDocuments");
    expect(rank).toContain('kind: "suggest"');
    expect(suggest).toContain('from "./composer-skill-rank.ts"');
    expect(suggest).not.toContain("toLowerCase().includes");
    expect(suggest).not.toContain("rankSearchDocuments");
  });

  it("keeps path mentions on fileQuery, not command-title fuzzy", () => {
    const pathQuery = read(PATH_QUERY);
    expect(pathQuery).toContain("fileQuery");
    expect(pathQuery).not.toContain("rankSearchDocuments");
  });

  it("keeps usageFrecency as the only half-life decay", () => {
    const frecency = read(FRECENCY);
    expect(frecency).toContain("export function usageFrecency");
    expect(frecency).toContain("0.5 **");
    expect(filesWithHalfLifeDecay()).toEqual([FRECENCY]);
  });

  it("keeps four-locale copy for manage agents and the default mark", () => {
    expect(read("src/renderer/i18n/locales/zh-CN/workspace.ts")).toContain(
      'manageAgents: "管理智能体…"'
    );
    expect(read("src/renderer/i18n/locales/en/workspace.ts")).toContain(
      'manageAgents: "Manage Agents…"'
    );
    expect(read("src/renderer/i18n/locales/ja/workspace.ts")).toContain(
      'manageAgents: "エージェントを管理…"'
    );
    expect(read("src/renderer/i18n/locales/ko/workspace.ts")).toContain(
      'manageAgents: "에이전트 관리…"'
    );
    expect(
      read("src/renderer/i18n/locales/zh-CN/command-palette.ts")
    ).toContain('defaultAgentMark: "默认"');
    expect(read("src/renderer/i18n/locales/en/command-palette.ts")).toContain(
      'defaultAgentMark: "Default"'
    );
    expect(read("src/renderer/i18n/locales/ja/command-palette.ts")).toContain(
      'defaultAgentMark: "デフォルト"'
    );
    expect(read("src/renderer/i18n/locales/ko/command-palette.ts")).toContain(
      'defaultAgentMark: "기본"'
    );
  });
});
