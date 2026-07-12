import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { managedPluginPackageManifestSchema } from "@shared/contracts/managed-plugin.ts";
import { describe, expect, it } from "vitest";

const APPROVED_BUNDLED_WIDGET_SIZE_POLICIES = [
  {
    defaultSize: { h: 3, w: 4 },
    maxSize: { h: 4, w: 8 },
    minSize: { h: 3, w: 2 },
    pluginId: "pier.codex",
    widgetId: "pier.codex.accounts",
  },
  {
    defaultSize: { h: 3, w: 4 },
    maxSize: { h: 5, w: 8 },
    minSize: { h: 3, w: 2 },
    pluginId: "pier.codex",
    widgetId: "pier.codex.cost",
  },
] as const;

const packagesRoot = join(process.cwd(), "packages");
const bundledPluginManifests = readdirSync(packagesRoot, {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("plugin-"))
  .map((entry) => join(packagesRoot, entry.name, "plugin.json"))
  .filter(existsSync)
  .map((manifestPath) => ({
    path: relative(process.cwd(), manifestPath),
    raw: JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
  }));

const builderConfig = readFileSync(
  join(process.cwd(), "electron-builder.yml"),
  "utf8"
);
const releaseWorkflow = readFileSync(
  join(process.cwd(), ".github/workflows/release-plugin.yml"),
  "utf8"
);
const prePushHook = readFileSync(
  join(process.cwd(), ".husky/pre-push"),
  "utf8"
);
const buildDistScript = readFileSync(
  join(process.cwd(), "scripts/build-dist.sh"),
  "utf8"
);
const packageJson = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8")
) as { scripts?: Record<string, string> };
const committedOfficialIndex = JSON.parse(
  readFileSync(join(process.cwd(), "plugins/index.v1.json"), "utf8")
) as { signature?: { alg?: string } };

describe("managed plugin packaging governance", () => {
  it("ships bundled plugin metadata beside packaged archives", () => {
    expect(builderConfig).toMatch(/to:\s*plugin-packages/);
    expect(builderConfig).toContain("*.tgz");
    expect(builderConfig).toContain("*.tgz.sha256");
    expect(builderConfig).toContain("plugin.json");
    expect(buildDistScript).toContain("pnpm plugin:codex:pack");
  });

  it("requires Ed25519 signing when the release workflow regenerates the official index", () => {
    expect(releaseWorkflow).toContain("PIER_PLUGIN_INDEX_REQUIRE_SIGNATURE");
    expect(releaseWorkflow).toContain(
      "PIER_PLUGIN_INDEX_SIGNING_PRIVATE_KEY_BASE64"
    );
    expect(releaseWorkflow).toContain("PIER_PLUGIN_INDEX_SIGNING_KEY_ID");
  });

  it("automatically publishes an immutable plugin release after one version change lands on main", () => {
    expect(releaseWorkflow).toMatch(
      /push:\s+branches:\s+- main\s+paths:\s+- 'packages\/plugin-\*\/package\.json'/
    );
    expect(releaseWorkflow).toContain(
      "expected exactly one changed plugin package.json"
    );
    expect(releaseWorkflow).toContain('if [ "$ACTUAL_VERSION" != "$VERSION" ]');
    expect(releaseWorkflow).toContain("Check existing release");
    expect(releaseWorkflow).toContain(
      "Verify existing release asset is immutable"
    );
    expect(releaseWorkflow).toContain("same-version hash drift");
  });

  it("does not commit an unsigned official index", () => {
    expect(committedOfficialIndex.signature?.alg).toBe("Ed25519");
  });

  it("checks official plugin index metadata before pushing", () => {
    expect(packageJson.scripts?.["check:plugin-index"]).toContain(
      "verify-plugin-index-assets.mjs"
    );
    expect(packageJson.scripts?.["check:plugin-index"]).toContain(
      "plugins:pack"
    );
    expect(prePushHook).toContain("pnpm check:plugin-index");
  });

  it("matches every bundled widget to its approved explicit sizing policy", () => {
    expect(
      bundledPluginManifests,
      "packages/plugin-*/plugin.json enumeration must not be empty"
    ).not.toHaveLength(0);

    const sizingPolicies = bundledPluginManifests.flatMap(({ raw }) => {
      const manifest = managedPluginPackageManifestSchema.parse(raw);
      return manifest.missionControlWidgets.map((widget) => ({
        defaultSize: widget.defaultSize,
        maxSize: widget.maxSize,
        minSize: widget.minSize,
        pluginId: manifest.id,
        widgetId: widget.id,
      }));
    });

    expect(sizingPolicies).toEqual(APPROVED_BUNDLED_WIDGET_SIZE_POLICIES);
  });
});
