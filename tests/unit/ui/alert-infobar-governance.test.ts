import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/**
 * Panel-chrome Alerts (content still visible) must use Alert layout="infobar".
 * In-content callouts (settings cards, Markdown, dialogs) keep the default
 * rounded card. Do not wrap a rounded Alert in extra padding or margin.
 */
const PANEL_INFOBAR_SITES = [
  "src/plugins/builtin/files/renderer/panel/parts.tsx",
  "src/plugins/builtin/files/renderer/preview/canvas-states.tsx",
  "src/plugins/builtin/git/renderer/review/document/view.tsx",
] as const;

describe("panel Alert infobar governance", () => {
  it("documents callout vs infobar on the shared Alert", () => {
    const src = readFileSync(join(ROOT, "packages/ui/src/alert.tsx"), "utf8");
    expect(src).toContain('layout="infobar"');
    expect(src).toContain('layout="callout"');
    expect(src).toContain(
      'infobar: "shrink-0 rounded-none border-x-0 border-t-0"'
    );
  });

  it("known panel-chrome banners use layout=infobar without a padded wrapper", () => {
    for (const rel of PANEL_INFOBAR_SITES) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src, `${rel} should use Alert layout=infobar`).toContain(
        'layout="infobar"'
      );
      expect(
        src,
        `${rel} must not duplicate infobar classes; use layout=infobar`
      ).not.toMatch(/rounded-none border-x-0 border-t-0/);
      expect(src, `${rel} must not wrap Alert in extra padding`).not.toMatch(
        /shrink-0 px-4 py-3[\s\S]{0,120}<Alert\b/
      );
      expect(src, `${rel} must not inset Alert with m-2`).not.toMatch(
        /<Alert\b[^>]*className="m-2"/
      );
    }
  });

  it("files panel save-error and workspace banners both use infobar", () => {
    const src = readFileSync(
      join(ROOT, "src/plugins/builtin/files/renderer/panel/parts.tsx"),
      "utf8"
    );
    const matches = src.match(/layout="infobar"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
