import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  GIT_REVIEW_TREE_ITEM_SURFACE,
  registerGitReviewTreeActions,
} from "@plugins/builtin/git/renderer/review/tree-actions.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";
import { listedContextMenuSurfaces } from "@/lib/context-menu/surface-profiles.ts";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-08-31-context-menu-order-gold-standard.md";
const SKETCHES = "tests/unit/renderer/context-menu/order-sketches.test.ts";
const COMPOSED =
  "tests/unit/renderer/context-menu/order-sketches-composed.test.ts";
const SLOT_GROUPS = [
  "0_edit",
  "1_find",
  "1_navigation",
  "1_new",
  "1_open",
  "1_reading",
  "1_review",
  "1_run",
  "2_appearance",
  "2_split",
  "2_view",
  "4_window",
  "5_edit",
  "5_open",
  "6_path",
  "7_danger",
  "8_clear",
  "9_close",
] as const;
const SKIP_SURFACES = new Set([
  "command-palette",
  "create-menu",
  "panel/edit",
  "panel/layout",
]);

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function menuFirstActionId(
  surface: string,
  metadata: Record<string, unknown>
): string | undefined {
  const first = buildMenuEntries(surface, { metadata, surface }).find(
    (entry) => entry.type === "action"
  );
  return first?.type === "action" ? first.id : undefined;
}

describe("context-menu order gold standard", () => {
  it("documents the contract in AGENTS.md and the spec", () => {
    const agents = read("AGENTS.md");
    const spec = read(SPEC);
    expect(agents).toContain("### 右键菜单顺序");
    expect(agents).toContain(
      "tests/unit/renderer/context-menu/order-governance.test.ts"
    );
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("隐藏提升");
    expect(spec).toContain("表面家族");
    expect(spec).toContain("5_open");
    expect(spec).toContain("8_clear");
    expect(spec).toContain("必须字典序小于 `1_new`");
    expect(spec).toContain("菜单加速键");
    expect(spec).toContain("只显示提示");
    expect(spec).toContain("拆分 → 聚焦 → 均分");
    expect(spec).toContain("新建终端或重跑 / 停止 → 重命名 → 增强输入");
    expect(spec).toContain("`2_view` / `2_appearance` / `2_split`");
    expect(spec).toContain("| 窗口 | `4_window`");
  });

  it("keeps find lexicographically before other 1_* primary groups", () => {
    expect([...SLOT_GROUPS].toSorted()).toEqual([...SLOT_GROUPS]);
    expect("1_find" < "1_new").toBe(true);
    expect("1_find" < "1_open").toBe(true);
    expect("1_find" < "1_run").toBe(true);
  });

  it("keeps leave-surface opens out of 1_open and 6_path", () => {
    const openDirectory = read(
      "src/plugins/builtin/git/renderer/review/directory/open-action.ts"
    );
    const openFile = read(
      "src/plugins/builtin/git/renderer/review/tree-actions.ts"
    );
    const terminal = read(
      "src/renderer/panel-kits/terminal/register-actions.ts"
    );
    const layout = read(
      "src/renderer/lib/actions/panel-layout-contributions.ts"
    );
    expect(openDirectory).toMatch(/group:\s*"5_open"/);
    expect(openDirectory).not.toMatch(/group:\s*"1_open"/);
    expect(openDirectory).not.toMatch(/group:\s*"6_path"/);
    expect(openFile).toMatch(/group:\s*"5_open"/);
    expect(terminal).toMatch(/group:\s*"1_find"/);
    expect(terminal).toMatch(/group:\s*"8_clear"/);
    expect(terminal).not.toMatch(/group:\s*"2_agent"/);
    expect(layout).not.toMatch(/group:\s*"3_focus"/);
    expect(layout).not.toMatch(/group:\s*"4_layout"/);
    const keepOpenBlock = layout
      .split('id: "pier.panel.keepOpen"')[1]
      ?.split("id:")[0];
    expect(keepOpenBlock).toMatch(/sortOrder:\s*1/);
    const equalizeAt = layout.indexOf('id: "pier.panel.equalizeSplits"');
    const equalizeBlock = layout.slice(
      Math.max(0, equalizeAt - 240),
      equalizeAt + 240
    );
    expect(equalizeBlock).toMatch(/group:\s*"2_split"/);
    expect(equalizeBlock).toMatch(/sortOrder:\s*20/);
    const focusAt = layout.indexOf('id: "pier.panel.focusRight"');
    const focusBlock = layout.slice(Math.max(0, focusAt - 240), focusAt + 80);
    expect(focusBlock).toMatch(/group:\s*"2_split"/);
    const panelActions = read("src/renderer/lib/actions/panel-actions.ts");
    expect(panelActions).not.toMatch(/group:\s*"3_focus"/);
    const taskRun = read(
      "src/renderer/lib/actions/task-run-context-actions.ts"
    );
    expect(taskRun).toMatch(/group:\s*"1_new"/);
    expect(taskRun).not.toMatch(/group:\s*"1_run"/);
  });

  it("covers every popup surface in the sketch files", () => {
    const sketches = `${read(SKETCHES)}\n${read(COMPOSED)}`;
    for (const surface of listedContextMenuSurfaces()) {
      if (SKIP_SURFACES.has(surface)) {
        continue;
      }
      expect(sketches).toContain(`"${surface}"`);
    }
    expect(read(COMPOSED)).toContain('menuSketch("git/review-diff"');
    expect(read(COMPOSED)).toContain('menuSketch("terminal/content"');
    expect(read(COMPOSED)).toContain('menuSketch("terminal/restored"');
    expect(read(COMPOSED)).toContain('menuSketch("files/canvas-preview"');
    expect(read(COMPOSED)).toContain('menuSketch("panel/content"');
    expect(read(COMPOSED)).toContain('menuSketch("dockview-tab"');
  });
});

describe("review tree hide-promotion", () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    actionRegistry.clearForTests();
    const context = {
      actions: {
        register: (action: Parameters<typeof actionRegistry.register>[0]) =>
          actionRegistry.register(action),
      },
      files: {
        openInEditor: () => true,
        openProjectDirectory: async () => ({
          ok: true,
          instanceId: "x",
          reused: false,
        }),
      },
      git: {
        applyReviewPathMutation: async () => ({
          kind: "ok" as const,
          operationId: "op",
        }),
      },
      i18n: {
        t: (_key: string, _values: unknown, fallback: string) => fallback,
      },
      notifications: {
        error: () => undefined,
        info: () => undefined,
        success: () => undefined,
      },
      dialogs: {
        alert: async () => undefined,
        choice: async () => "cancel",
        confirm: async () => false,
      },
      panels: { getActiveInstanceId: () => "panel-1" },
    } as unknown as RendererPluginContext;
    dispose = registerGitReviewTreeActions(context);
  });

  afterEach(() => {
    dispose?.();
    actionRegistry.clearForTests();
  });

  it("does not lead directory or group menus with open directory", () => {
    const directoryFirst = menuFirstActionId(GIT_REVIEW_TREE_ITEM_SURFACE, {
      contextId: "ctx",
      expectedIndexRevision: "index:1",
      gitRootPath: "/repo",
      hasUnstaged: true,
      kind: "directory",
      path: "src",
      repoPath: "src",
      stagePaths: ["src/a.ts"],
      uncommitted: true,
    });
    const groupFirst = menuFirstActionId(GIT_REVIEW_TREE_ITEM_SURFACE, {
      contextId: "ctx",
      expectedIndexRevision: "index:1",
      gitRootPath: "/repo",
      hasStaged: true,
      kind: "directory",
      path: "\u0001Changes",
      unstagePaths: ["a.ts"],
      uncommitted: true,
    });
    expect(directoryFirst).toBe("pier.git.review.stageFile");
    expect(groupFirst).toBe("pier.git.review.unstageFile");
  });
});
