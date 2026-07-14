import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPluginDataSchemaCompatibility,
  supportsIntegerSchemaVersion,
} from "@main/services/managed-plugins/data-schema-compatibility.ts";
import type { ManagedPluginPackageManifest } from "@shared/contracts/managed-plugin.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let workDir = "";

function manifest(
  read: string | null = ">=1 <=1"
): ManagedPluginPackageManifest {
  return {
    apiVersion: 1,
    commands: [],
    ...(read === null
      ? {}
      : { dataSchemas: { "codex.accounts": { read, write: 1 } } }),
    engines: { pier: ">=0.1.0" },
    id: "pier.codex",
    main: "dist/main.js",
    workbenchWidgets: [],
    name: "Codex",
    panels: [],
    permissions: [],
    renderer: "dist/renderer.js",
    settingsPages: [],
    terminalStatusItems: [],
    version: "1.0.3",
  };
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pier-data-schema-"));
  await mkdir(join(workDir, "pier.codex"), { recursive: true });
});

afterEach(async () => {
  await rm(workDir, { force: true, recursive: true });
});

describe("managed plugin data schema compatibility", () => {
  it("evaluates the declared integer range", () => {
    expect(supportsIntegerSchemaVersion(">=1 <=2", 1)).toBe(true);
    expect(supportsIntegerSchemaVersion(">=1 <=2", 3)).toBe(false);
    expect(supportsIntegerSchemaVersion("not-a-range", 1)).toBe(false);
  });

  it("accepts a declared compatible marker and fails closed otherwise", async () => {
    const markerPath = join(
      workDir,
      "pier.codex",
      ".pier-plugin-data-schemas.json"
    );
    await writeFile(
      markerPath,
      JSON.stringify({
        schemas: {
          "codex.accounts": {
            updatedByPluginVersion: "1.0.3",
            version: 1,
          },
        },
        version: 1,
      })
    );
    await expect(
      assertPluginDataSchemaCompatibility({
        manifest: manifest(),
        pluginId: "pier.codex",
        workDir,
      })
    ).resolves.toBeUndefined();
    await expect(
      assertPluginDataSchemaCompatibility({
        manifest: manifest(">=2 <=2"),
        pluginId: "pier.codex",
        workDir,
      })
    ).rejects.toThrow("incompatible");
    const undeclared = manifest(null);
    await expect(
      assertPluginDataSchemaCompatibility({
        manifest: undeclared,
        pluginId: "pier.codex",
        workDir,
      })
    ).rejects.toThrow("not declared");
  });

  it("fails closed for malformed markers", async () => {
    await writeFile(
      join(workDir, "pier.codex", ".pier-plugin-data-schemas.json"),
      '{"version":1,"schemas":{"codex.accounts":{"version":"1"}}}'
    );
    await expect(
      assertPluginDataSchemaCompatibility({
        manifest: manifest(),
        pluginId: "pier.codex",
        workDir,
      })
    ).rejects.toThrow();
  });
});
