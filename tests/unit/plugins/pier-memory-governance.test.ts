import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SECTION_BEGIN,
  SECTION_END,
} from "@main/services/agent-managed-assets/guidance.ts";
import { MEMORY_PLUGIN_LOCALES } from "@plugins/builtin/memory/locales/index.ts";
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
});
