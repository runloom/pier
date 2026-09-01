import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/**
 * Full-region errors (no primary body) must use Empty / ErrorEmpty.
 * Soft Alert banners are only for non-blocking tips while content remains.
 * See packages/ui/src/error-empty.tsx and AGENTS-adjacent product copy.
 */
const FULL_REGION_LOAD_FAILURE_SITES = [
  "packages/plugin-claude/src/renderer/accounts-settings-page.tsx",
  "packages/plugin-codex/src/renderer/accounts-settings-page.tsx",
  "packages/plugin-grok/src/renderer/accounts-settings-page.tsx",
  "packages/plugin-ssh/src/renderer/hosts-settings-page.tsx",
  "packages/plugin-tasks/src/renderer/board-panel.tsx",
  "packages/plugin-tasks/src/renderer/source-setup.tsx",
  "src/renderer/lib/plugins/external/applet-mount.tsx",
  "src/renderer/pages/settings/components/skills/content-body.tsx",
  "src/plugins/builtin/files/renderer/panel/body.tsx",
  "src/plugins/builtin/files/renderer/preview/canvas-states.tsx",
  "src/renderer/components/workspace/transfer/unavailable-panel.tsx",
] as const;

describe("full-region error Empty governance", () => {
  it("documents ErrorEmpty vs Alert rule on the shared component", () => {
    const src = readFileSync(
      join(ROOT, "packages/ui/src/error-empty.tsx"),
      "utf8"
    );
    expect(src).toContain("错误占据整个区域时用它替代 Alert 横条");
    expect(src).toContain("内容仍可见的非阻塞提示才用 Alert");
  });

  it("known full-region load-failure sites use ErrorEmpty/Empty, not sole Alert", () => {
    for (const rel of FULL_REGION_LOAD_FAILURE_SITES) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      const usesEmpty =
        src.includes("ErrorEmpty") ||
        src.includes("CanvasCompileErrorEmpty") ||
        src.includes("<Empty") ||
        src.includes('data-slot="file-canvas-error-empty"') ||
        src.includes("data-slot='file-canvas-error-empty'");
      expect(usesEmpty, `${rel} should present load failures via Empty`).toBe(
        true
      );

      // Anti-pattern: early loadError/loadFailed branch that only returns Alert.
      // Allow Alert elsewhere in the same file for soft banners / info tips.
      if (
        rel.endsWith("accounts-settings-page.tsx") ||
        rel.includes("hosts-settings")
      ) {
        expect(
          src,
          `${rel}: loadError branch must not use destructive Alert as sole shell`
        ).not.toMatch(
          /if\s*\(\s*loadError\s*\)[\s\S]{0,200}<Alert\s+variant=["']destructive["']/
        );
      }
      if (rel.endsWith("content-body.tsx")) {
        expect(src, `${rel}: loadFailed must use ErrorEmpty`).toMatch(
          /if\s*\(\s*loadFailed\s*\)[\s\S]{0,120}<ErrorEmpty\b/
        );
      }
      if (rel.endsWith("body.tsx") && rel.includes("files/renderer/panel")) {
        expect(
          src,
          `${rel}: loadState === "error" must use FileReadErrorEmpty/ErrorEmpty`
        ).toMatch(
          /loadState\s*===\s*["']error["'][\s\S]{0,400}<FileReadErrorEmpty\b/
        );
        expect(src).toMatch(/FileReadErrorEmpty/);
      }
      if (rel.endsWith("canvas-states.tsx")) {
        expect(src).toContain("CanvasCompileErrorEmpty");
        // Runtime crash titles belong on Empty, not soft Alert banner.
        expect(src).not.toMatch(/CanvasSoftErrorBanner[\s\S]{0,80}isRuntime/);
        expect(src).toMatch(
          /isRuntime[\s\S]{0,200}filePanel\.canvas\.runtimeFailed/
        );
      }
      if (rel.endsWith("unavailable-panel.tsx")) {
        expect(src).toContain("ErrorEmpty");
        expect(src).not.toContain("AlertTriangle");
        expect(src).toMatch(/data-slot=["']panel-transfer-unavailable["']/);
      }
      if (rel.endsWith("applet-mount.tsx")) {
        expect(src).toContain("ErrorEmpty");
        expect(src).not.toMatch(
          /if\s*\(\s*error\s*\)[\s\S]{0,200}<Alert\s+variant=["']destructive["']/
        );
      }
      if (rel.endsWith("board-panel.tsx")) {
        expect(src).toContain("ErrorEmpty");
        expect(src).not.toMatch(/EmptyDescription>\{error\}/);
      }
    }
  });

  it("task applets use Empty for full-region load failure", () => {
    for (const rel of [
      "packages/plugin-tasks/applets/load-error.tsx",
      "packages/plugin-tasks/applets/tracker-board/view.tsx",
      "packages/plugin-tasks/applets/task-list/index.applet.tsx",
      "packages/plugin-tasks/applets/task-dag/index.applet.tsx",
    ] as const) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src, rel).toMatch(/AppletLoadError|<Empty\b/);
    }
  });
});
