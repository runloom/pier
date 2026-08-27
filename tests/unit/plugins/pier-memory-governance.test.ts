import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SECTION_BEGIN,
  SECTION_END,
} from "@main/services/agent-managed-assets/guidance.ts";
import { MEMORY_PLUGIN_LOCALES } from "@plugins/builtin/memory/locales/index.ts";
import {
  MEMORY_PLUGIN_MANIFEST,
  MEMORY_PROJECT_SETTINGS_ID,
} from "@plugins/builtin/memory/manifest.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function messageKeys(locale: keyof typeof MEMORY_PLUGIN_LOCALES): string[] {
  return Object.keys(MEMORY_PLUGIN_LOCALES[locale].messages ?? {}).sort();
}

describe("pier.memory governance", () => {
  it("keeps the design title in the spec", () => {
    const spec = readFileSync(
      join(
        ROOT,
        "docs/superpowers/specs/2026-08-26-project-memory-plugin-design.md"
      ),
      "utf8"
    );
    expect(spec).toContain("# 项目记忆插件（pier.memory）");
    const ui = readFileSync(
      join(
        ROOT,
        "docs/superpowers/specs/2026-08-27-project-memory-settings-ui-design.md"
      ),
      "utf8"
    );
    expect(ui).toContain("# 项目记忆：设置页表面");
    expect(ui).toContain("pier.memory.project");
    expect(ui).toContain("设置 → 项目");
    expect(spec).toContain("projectSettings");
  });

  it("locks entityType set and marker constants", () => {
    expect(SECTION_BEGIN).toBe("<!-- pier-managed:memory begin -->");
    expect(SECTION_END).toBe("<!-- pier-managed:memory end -->");
    const guidance = readFileSync(
      join(ROOT, "src/main/services/agent-managed-assets/guidance.ts"),
      "utf8"
    );
    expect(guidance).toContain("convention | pitfall | decision | environment");
  });

  it("grants managedAssets:write only to desktop-renderer", () => {
    const granted = (
      Object.entries(DEFAULT_CAPABILITIES_BY_CLIENT_KIND) as [
        string,
        readonly string[],
      ][]
    )
      .filter(([, caps]) => caps.includes("managedAssets:write"))
      .map(([kind]) => kind);
    expect(granted).toEqual(["desktop-renderer"]);
  });

  it("keeps locale message keys aligned", () => {
    const en = messageKeys("en");
    expect(messageKeys("zh-CN")).toEqual(en);
    expect(messageKeys("ja")).toEqual(en);
    expect(messageKeys("ko")).toEqual(en);
  });
  it("declares project settings and no plugin settings page", () => {
    expect(MEMORY_PLUGIN_MANIFEST.panels).toEqual([]);
    expect(MEMORY_PLUGIN_MANIFEST.settingsPages).toEqual([]);
    expect(MEMORY_PLUGIN_MANIFEST.projectSettings).toEqual([
      { id: MEMORY_PROJECT_SETTINGS_ID },
    ]);
    expect(MEMORY_PLUGIN_MANIFEST.permissions).toEqual([
      "workspace:read",
      "file:read",
      "managedAssets:write",
    ]);
  });

  it("locks projectSettings contribution in AGENTS.md", () => {
    const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    expect(agents).toContain("项目设置贡献点");
    expect(agents).toContain("projectSettings");
  });

  it("locks the v3 global-registration delivery and its zero-repo-write red line", () => {
    const v3 = readFileSync(
      join(
        ROOT,
        "docs/superpowers/specs/2026-08-27-project-memory-global-registration-v3-design.md"
      ),
      "utf8"
    );
    expect(v3).toContain("# 项目记忆 v3:全局注册 + 运行时解析");
    expect(v3).toContain("仓库内文件零写入");
    // 红线:项目级 reconciler 不再写任何 MCP 目标(交付面唯一在 registry)。
    const reconcile = readFileSync(
      join(ROOT, "src/main/services/agent-managed-assets/reconcile.ts"),
      "utf8"
    );
    expect(reconcile).not.toContain("applyMemoryTarget");
    expect(reconcile).not.toContain("isTracked");
  });
});
