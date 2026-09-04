import { createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OFFICIAL_BUNDLED_PLUGIN_SPECS } from "@main/app-core/bundled-official-plugins.ts";
import {
  canonicalizeIndexPayload,
  OFFICIAL_PLUGIN_INDEX_PUBLIC_KEYS_BY_ID,
} from "@main/services/managed-plugins/official-index.ts";
import {
  isRetiredManagedPluginId,
  RETIRED_MANAGED_PLUGIN_IDS,
} from "@main/services/managed-plugins/retired-plugins.ts";
import { officialPluginIndexSchema } from "@shared/contracts/plugin/managed.ts";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-04-retired-managed-plugin-invisibility-gold-standard.md";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("retired managed plugin invisibility gold standard", () => {
  it("documents the contract in AGENTS.md and the spec", () => {
    const agents = read("AGENTS.md");
    const spec = read(SPEC);
    expect(existsSync(join(ROOT, SPEC))).toBe(true);
    expect(agents).toContain("### 退役官方插件彻底不可见");
    expect(agents).toContain(SPEC);
    expect(agents).toContain(
      "tests/unit/main/plugins/retired-plugin-invisibility-governance.test.ts"
    );
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("彻底不可见");
    expect(spec).toContain("RETIRED_MANAGED_PLUGIN_IDS");
    expect(spec).toContain("plugins/index.v1.json");
    expect(spec).toContain("决策树");
    expect(spec).toContain("明确不做");
    expect(spec).toContain("已退役");
    expect(spec).toContain("双卖");
    expect(spec).toContain("replacedBy");
  });

  it("does not advertise retired ids in the committed official index", () => {
    const index = officialPluginIndexSchema.parse(
      JSON.parse(read("plugins/index.v1.json"))
    );
    const advertised = Object.keys(index.plugins).filter((id) =>
      isRetiredManagedPluginId(id)
    );
    expect(advertised).toEqual([]);
    expect(index.plugins["pier.tmux"]).toBeUndefined();

    const publicKeyBase64 =
      OFFICIAL_PLUGIN_INDEX_PUBLIC_KEYS_BY_ID[index.signature.keyId];
    expect(publicKeyBase64).toBeDefined();
    if (!publicKeyBase64) {
      throw new Error(`unknown official index keyId: ${index.signature.keyId}`);
    }
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeyBase64, "base64"),
      format: "der",
      type: "spki",
    });
    expect(
      verify(
        null,
        Buffer.from(canonicalizeIndexPayload(index), "utf8"),
        publicKey,
        Buffer.from(index.signature.value, "base64")
      )
    ).toBe(true);
  });

  it("does not bundle or keep a source package for retired ids", () => {
    expect(
      OFFICIAL_BUNDLED_PLUGIN_SPECS.map((spec) => spec.id).filter(
        isRetiredManagedPluginId
      )
    ).toEqual([]);
    expect(existsSync(join(ROOT, "packages/plugin-tmux/plugin.json"))).toBe(
      false
    );
    expect(existsSync(join(ROOT, "packages/plugin-tmux/package.json"))).toBe(
      false
    );
  });

  it("hides retired ids on catalog, install, boot, and index generation", () => {
    const catalog = read(
      "src/main/services/managed-plugins/catalog-operations.ts"
    );
    const install = read(
      "src/main/services/managed-plugins/install-operations.ts"
    );
    const boot = read("src/main/services/managed-plugins/install-boot.ts");
    const generator = read("scripts/generate-plugin-index.mjs");
    expect(catalog).toContain("isRetiredManagedPluginId");
    expect(install).toContain("isRetiredManagedPluginId");
    expect(boot).toContain("purgeRetiredManagedPluginsFromStore");
    expect(generator).toContain("RETIRED_MANAGED_PLUGIN_IDS");
    expect(generator).toContain("retiredIds.has(");
    expect(RETIRED_MANAGED_PLUGIN_IDS.has("pier.tmux")).toBe(true);
  });
});
