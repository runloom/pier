import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { managedPluginPackageManifestSchema } from "@shared/contracts/plugin/managed.ts";
import { describe, expect, it } from "vitest";

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
const verifyIndexWorkflow = readFileSync(
  join(process.cwd(), ".github/workflows/verify-index.yml"),
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

function pluginSourceImportsElectron(source: string): boolean {
  return (
    /from\s+["']electron(?:\/[^"']*)?["']/.test(source) ||
    /import\(\s*["']electron(?:\/[^"']*)?["']\s*\)/.test(source) ||
    /require\(\s*["']electron(?:\/[^"']*)?["']\s*\)/.test(source)
  );
}

function collectPluginSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") return [];
      return collectPluginSourceFiles(path);
    }
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
      ? [path]
      : [];
  });
}

describe("managed plugin packaging governance", () => {
  it("builds every workspace plugin before starting the dev host", () => {
    expect(packageJson.scripts?.predev).toContain("pnpm plugins:pack");
  });

  it("ships each bundled plugin into an isolated plugin-packages subdir", () => {
    expect(builderConfig).toContain("from: packages/plugin-claude/dist-pkg");
    expect(builderConfig).toContain("to: plugin-packages/pier.claude");
    expect(builderConfig).toContain("from: packages/plugin-tasks/dist-pkg");
    expect(builderConfig).toContain("to: plugin-packages/pier.tasks");
    expect(builderConfig).toContain("from: packages/plugin-codex/dist-pkg");
    expect(builderConfig).toContain("to: plugin-packages/pier.codex");
    expect(builderConfig).toContain("from: packages/plugin-grok/dist-pkg");
    expect(builderConfig).toContain("to: plugin-packages/pier.grok");
    expect(builderConfig).toContain("from: packages/plugin-ssh/dist-pkg");
    expect(builderConfig).toContain("to: plugin-packages/pier.ssh");
    expect(builderConfig).toContain(
      "from: packages/plugin-agent-splits/dist-pkg"
    );
    expect(builderConfig).toContain("to: plugin-packages/pier.agent-splits");
    // Language support is L0 (Files + host PATH providers), not bundled packs.
    expect(builderConfig).not.toContain("plugin-lsp-");
    expect(builderConfig).toContain("*.tgz");
    expect(builderConfig).toContain("*.tgz.sha256");
    expect(builderConfig).toContain("plugin.json");
    // Flat shared plugin-packages root collides on plugin.json across plugins.
    expect(builderConfig).not.toMatch(/to:\s*plugin-packages\s*$/m);
    expect(buildDistScript).toContain("pnpm plugins:pack");
  });

  it("requires Ed25519 signing when the release workflow regenerates the official index", () => {
    expect(releaseWorkflow).toContain("PIER_PLUGIN_INDEX_REQUIRE_SIGNATURE");
    expect(releaseWorkflow).toContain(
      "PIER_PLUGIN_INDEX_SIGNING_PRIVATE_KEY_BASE64"
    );
    expect(releaseWorkflow).toContain("PIER_PLUGIN_INDEX_SIGNING_KEY_ID");
  });

  it("automatically publishes immutable plugin releases for every package.json change on main", () => {
    expect(releaseWorkflow).toMatch(
      /push:\s+branches:\s+- main\s+paths:\s+- 'packages\/plugin-\*\/package\.json'/
    );
    expect(releaseWorkflow).toContain(
      "expected at least one changed plugin package.json"
    );
    expect(releaseWorkflow).not.toContain(
      "expected exactly one changed plugin package.json"
    );
    expect(releaseWorkflow).toContain("release_targets");
    expect(releaseWorkflow).toContain("sorted by tail");
    expect(releaseWorkflow).toContain("must have plugin.json");
    expect(releaseWorkflow).toContain(
      "skipping non-releasable package (no plugin.json)"
    );
    expect(releaseWorkflow).toContain("should_release");
    expect(releaseWorkflow).toContain(
      "no releasable plugin package.json changes (plugin.json required)"
    );
    expect(releaseWorkflow).toContain("same-version hash drift");
    expect(releaseWorkflow).toContain("Check existing release");
    expect(releaseWorkflow).toContain(
      "Verify existing release asset is immutable"
    );
    expect(releaseWorkflow).toContain("restoring published asset");
    expect(releaseWorkflow).toContain("pnpm plugins:index");
    expect(releaseWorkflow).toContain("chore(plugins): update index for");
    expect(releaseWorkflow).toContain("--latest=false");
    expect(releaseWorkflow).toContain("--prerelease");
  });

  it("does not commit an unsigned official index", () => {
    expect(committedOfficialIndex.signature?.alg).toBe("Ed25519");
  });

  it("checks official plugin index metadata before pushing", () => {
    expect(packageJson.scripts?.["check:plugin-index"]).toContain(
      "verify-plugin-index-assets.mjs"
    );
    expect(packageJson.scripts?.["check:plugin-index"]).toContain(
      "--source=release"
    );
    expect(packageJson.scripts?.["check:plugin-index"]).toContain(
      "plugins:pack"
    );
    // pre-push delegates to preflight:* which always runs check:plugin-index
    expect(prePushHook).toMatch(
      /preflight:(push|merge|ci|full)|check:plugin-index/
    );
    const preflightScript = readFileSync(
      join(process.cwd(), "scripts/preflight-ci.sh"),
      "utf8"
    );
    expect(preflightScript).toContain("pnpm check:plugin-index");
    expect(verifyIndexWorkflow).toContain(
      "verify-plugin-index-assets.mjs --source=release"
    );
  });

  it("does not declare workbenchWidgets on bundled plugin manifests", () => {
    expect(
      bundledPluginManifests,
      "packages/plugin-*/plugin.json enumeration must not be empty"
    ).not.toHaveLength(0);

    for (const { path, raw } of bundledPluginManifests) {
      expect(raw, path).not.toHaveProperty("workbenchWidgets");
      const manifest = managedPluginPackageManifestSchema.parse(raw);
      expect(manifest, path).not.toHaveProperty("workbenchWidgets");
    }
  });

  it("treats electron subpaths and require() as forbidden plugin imports", () => {
    expect(pluginSourceImportsElectron('import { app } from "electron"')).toBe(
      true
    );
    expect(
      pluginSourceImportsElectron('import { app } from "electron/main"')
    ).toBe(true);
    expect(pluginSourceImportsElectron('const e = require("electron")')).toBe(
      true
    );
    expect(pluginSourceImportsElectron('import fs from "node:fs"')).toBe(false);
  });

  it("does not import electron from official plugin sources", () => {
    const pluginDirs = readdirSync(packagesRoot, {
      withFileTypes: true,
    }).filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith("plugin-") &&
        entry.name !== "plugin-api"
    );
    expect(pluginDirs.length).toBeGreaterThan(0);
    for (const dir of pluginDirs) {
      const root = join(packagesRoot, dir.name, "src");
      if (!existsSync(root)) continue;
      for (const file of collectPluginSourceFiles(root)) {
        const source = readFileSync(file, "utf8");
        expect(
          pluginSourceImportsElectron(source),
          relative(process.cwd(), file)
        ).toBe(false);
      }
    }
  });
});
