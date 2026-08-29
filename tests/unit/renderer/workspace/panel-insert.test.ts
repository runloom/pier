import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  panelInsertIndexFields,
  resolvePanelInsertIndex,
  withinGroupPosition,
  withinPanelPosition,
} from "@/lib/workspace/panel-insert.ts";

const ROOT = process.cwd();
const SOURCE_FILE_RE = /\.(ts|tsx)$/;
const WITHIN_DIRECTION_RE = /direction:\s*["']within["']/;
const PANEL_INSERT_IMPORT_RE =
  /from ["']@\/lib\/workspace\/panel-insert\.ts["']/;
const INSERT_SCAN_ROOTS = [
  join(ROOT, "src", "renderer"),
  join(ROOT, "src", "plugins"),
];
const WITHIN_WITHOUT_INSERT_POLICY_ALLOWLIST = new Set([
  // DnD already computes a drop index; not a related-open insert.
  "src/renderer/components/workspace/transfer/commands.ts",
]);

function walkSourceFiles(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkSourceFiles(full));
      continue;
    }
    if (SOURCE_FILE_RE.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

function panel(id: string) {
  return { id };
}

describe("resolvePanelInsertIndex", () => {
  it("inserts after the active tab", () => {
    const a = panel("a");
    const b = panel("b");
    const c = panel("c");
    expect(
      resolvePanelInsertIndex(
        { activePanel: b, panels: [a, b, c] },
        "after-active"
      )
    ).toBe(2);
  });

  it("appends when the active tab is last", () => {
    const a = panel("a");
    const b = panel("b");
    expect(
      resolvePanelInsertIndex(
        { activePanel: b, panels: [a, b] },
        "after-active"
      )
    ).toBe(2);
  });

  it("appends when the group has no active panel", () => {
    const a = panel("a");
    expect(resolvePanelInsertIndex({ panels: [a] }, "after-active")).toBe(1);
  });

  it("uses an explicit after-panel id over group.activePanel", () => {
    const a = panel("a");
    const b = panel("b");
    const c = panel("c");
    expect(
      resolvePanelInsertIndex(
        { activePanel: c, panels: [a, b, c] },
        "after-active",
        "a"
      )
    ).toBe(1);
  });

  it("appends for blank Welcome tabs", () => {
    const a = panel("a");
    const b = panel("b");
    expect(
      resolvePanelInsertIndex({ activePanel: a, panels: [a, b] }, "end")
    ).toBe(2);
  });

  it("omits the index when group.panels is unavailable", () => {
    expect(
      resolvePanelInsertIndex({ activePanel: panel("a") })
    ).toBeUndefined();
    expect(resolvePanelInsertIndex(null, "end")).toBeUndefined();
  });

  it("returns 0 for an empty group", () => {
    expect(resolvePanelInsertIndex({ panels: [] }, "after-active")).toBe(0);
    expect(resolvePanelInsertIndex({ panels: [] }, "end")).toBe(0);
  });
});

describe("placement helpers", () => {
  it("spreads no index field when the group has no panels list", () => {
    expect(panelInsertIndexFields({ activePanel: panel("a") })).toEqual({});
  });

  it("builds a within-group placement after the active tab", () => {
    const group = { activePanel: panel("a"), id: "g", panels: [panel("a")] };
    expect(withinGroupPosition(group)).toEqual({
      direction: "within",
      index: 1,
      referenceGroup: group,
    });
  });

  it("builds a within-panel placement after the referenced tab", () => {
    const group = {
      activePanel: panel("b"),
      panels: [panel("a"), panel("b")],
    };
    expect(withinPanelPosition("a", group)).toEqual({
      direction: "within",
      index: 1,
      referencePanel: "a",
    });
  });
});

describe("within-group insert policy governance", () => {
  it("requires related-open within placements to go through panel-insert", () => {
    const violations: string[] = [];
    for (const root of INSERT_SCAN_ROOTS) {
      for (const file of walkSourceFiles(root)) {
        const rel = relative(ROOT, file).split("\\").join("/");
        if (WITHIN_WITHOUT_INSERT_POLICY_ALLOWLIST.has(rel)) {
          continue;
        }
        if (rel === "src/renderer/lib/workspace/panel-insert.ts") {
          continue;
        }
        const source = readFileSync(file, "utf8");
        if (!WITHIN_DIRECTION_RE.test(source)) {
          continue;
        }
        if (PANEL_INSERT_IMPORT_RE.test(source)) {
          continue;
        }
        violations.push(rel);
      }
    }
    expect(violations).toEqual([]);
  });
});
