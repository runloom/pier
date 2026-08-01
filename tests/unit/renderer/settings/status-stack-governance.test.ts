import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const COMPONENTS = join(
  ROOT,
  "src",
  "renderer",
  "pages",
  "settings",
  "components"
);

function readComponent(name: string): string {
  return readFileSync(join(COMPONENTS, name), "utf8");
}

describe("settings status stack governance", () => {
  it("managed plugins section does not render Alert banners", () => {
    const src = readComponent("managed-plugins-section.tsx");
    expect(src).not.toMatch(/<Alert\b/);
  });

  it("plugin diagnostics summary does not render Alert", () => {
    const src = readComponent("plugin-diagnostics-summary.tsx");
    expect(src).not.toMatch(/<Alert\b/);
  });

  it("plugins section mounts StatusStack for page status", () => {
    const src = readComponent("plugins-section.tsx");
    expect(src).toMatch(/StatusStack/);
    expect(src).toMatch(/buildPluginStatusItems/);
    expect(src).not.toMatch(/<Alert\b/);
    expect(src).not.toMatch(/PluginDiagnosticsSummary/);
  });

  it("notifications policy does not use warning Alert for hooks-off", () => {
    // 通知设置三卡拆分后，StatusStack 与 hooks-off 项在 delivery-card（提醒方式卡顶部）
    const src = readComponent("notifications/delivery-card.tsx");
    expect(src).toMatch(/StatusStack/);
    // hooks-off must be info tone, not warning Alert
    expect(src).toMatch(/id:\s*["']notif-hooks-off["']/);
    expect(src).toMatch(/tone:\s*["']info["']/);
    expect(src).not.toMatch(/<Alert\b/);
  });

  it("skills project detail and import review use StatusStack without Alert", () => {
    const project = readComponent("skills/project-detail.tsx");
    const review = readComponent("skills/import-review.tsx");
    expect(project).toMatch(/StatusStack/);
    expect(project).not.toMatch(/<Alert\b/);
    expect(review).toMatch(/StatusStack/);
    expect(review).not.toMatch(/<Alert\b/);
  });
});
