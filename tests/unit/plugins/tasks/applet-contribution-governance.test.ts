import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";

describe("canvas applet contribution governance", () => {
  it("rejects applet entries that escape the package", () => {
    expect(
      pluginManifestSchema.safeParse({
        apiVersion: 1,
        engines: { pier: ">=0.1.0 <0.2.0" },
        id: "pier.sample",
        name: "Sample",
        source: { kind: "official" },
        version: "1.0.0",
        applets: [
          {
            entry: "../secret/index.applet.tsx",
            id: "pier.sample.board",
          },
        ],
      }).success
    ).toBe(false);
  });

  it("does not eval-scan applet tsx in package validation", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/main/services/managed-plugins/package-validation.ts"
      ),
      "utf8"
    );
    expect(source).toContain("do not eval-scan");
    expect(source).not.toMatch(/assertNoEvalUsage\([^)]*applet/);
  });

  it("packs the whole applets tree so sibling copy catalogs ship", () => {
    const source = readFileSync(
      join(process.cwd(), "scripts/pack-plugin.mjs"),
      "utf8"
    );
    expect(source).toContain("function addAppletTree");
    expect(source).toContain('addAppletTree("applets")');
  });

  it("declares a project-level board panel and open command", () => {
    const manifest = JSON.parse(
      readFileSync(
        join(process.cwd(), "packages/plugin-tasks/plugin.json"),
        "utf8"
      )
    ) as {
      commands: Array<{ id: string }>;
      panels: Array<{ id: string }>;
      permissions: string[];
    };
    expect(manifest.panels.map((item) => item.id)).toEqual([
      "pier.tasks.board",
    ]);
    expect(manifest.commands.map((item) => item.id)).toContain(
      "pier.tasks.openBoard"
    );
    expect(manifest.permissions).toEqual(
      expect.arrayContaining([
        "command:register",
        "panel:open",
        "panel:register",
      ])
    );
  });

  it("keeps plugin-tasks applets prefixed", () => {
    const manifest = JSON.parse(
      readFileSync(
        join(process.cwd(), "packages/plugin-tasks/plugin.json"),
        "utf8"
      )
    ) as { applets: Array<{ deprecated?: boolean; id: string }> };
    expect(manifest.applets.map((item) => item.id)).toEqual([
      "pier.tasks.tracker-board",
      "pier.tasks.task-list",
      "pier.tasks.task-dag",
    ]);
    expect(manifest.applets.every((item) => item.deprecated !== true)).toBe(
      true
    );
  });

  it("opens Linear/Jira connect as a commit dialog, not an in-panel settings form", () => {
    const setup = readFileSync(
      join(
        process.cwd(),
        "packages/plugin-tasks/src/renderer/source-setup.tsx"
      ),
      "utf8"
    );
    const dialog = readFileSync(
      join(
        process.cwd(),
        "packages/plugin-tasks/src/renderer/connect-dialog.tsx"
      ),
      "utf8"
    );
    expect(setup).toContain("openConnectDialog");
    expect(setup).not.toContain('type="password"');
    expect(dialog).toContain("setFooter");
    expect(dialog).toContain("DIALOG_FOOTER_ACTIONS_CLASS");
    expect(dialog).toContain("dialogs.open");
  });

  it("mounts panel applets with panel chrome, not island cards", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/plugin-tasks/src/renderer/board-panel.tsx"),
      "utf8"
    );
    expect(source).toContain('chrome: "panel"');
    expect(source).not.toContain("embedded: true");
  });

  it("keeps tracker chrome while loading and does not remount on source switch", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/plugin-tasks/src/renderer/board-panel.tsx"),
      "utf8"
    );
    expect(source).toContain("TaskPanelHeader");
    expect(source).toContain("BoardViewSkeleton");
    expect(source).not.toContain("ToggleGroup");
    expect(source).not.toContain("TabsList");
    const header = readFileSync(
      join(
        process.cwd(),
        "packages/plugin-tasks/src/renderer/panel-header.tsx"
      ),
      "utf8"
    );
    expect(header).toContain('data-slot="file-panel-header"');
    expect(header).toContain(
      "flex h-10 shrink-0 items-center gap-2 border-border border-b bg-background px-2"
    );
    expect(header).toContain('size="icon-xs"');
    expect(header).toContain('variant="ghost"');
    expect(header).not.toContain("file/panel-layout");
    expect(header).not.toContain("react-resizable-panels");
    expect(source).not.toMatch(/if\s*\(\s*!loaded\s*\)/);
    expect(source).not.toMatch(/\$\{view\}:\$\{params\.provider\}/);
    const overlay = readFileSync(
      join(
        process.cwd(),
        "packages/plugin-tasks/src/renderer/view-skeleton.tsx"
      ),
      "utf8"
    );
    const boardView = readFileSync(
      join(
        process.cwd(),
        "packages/plugin-tasks/applets/tracker-board/view.tsx"
      ),
      "utf8"
    );
    expect(overlay).not.toContain("data-board-card-skeleton");
    expect(boardView).not.toContain("data-board-card-skeleton");
    expect(overlay).not.toMatch(/h-(10|24|28)/);
    expect(overlay).not.toContain('"todo", "inProgress", "done"');
    expect(boardView).not.toContain("<IdleColumns pulse");
    expect(boardView).toContain('status !== "loading"');
    const mount = readFileSync(
      join(process.cwd(), "src/renderer/lib/plugins/external/applet-mount.tsx"),
      "utf8"
    );
    expect(mount).toContain("updateLiveModule");
    expect(mount).not.toMatch(
      /}, \[moduleId, projectRootPath, propsKey, retry, t\]/
    );
  });
});
