import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBundledPlugin } from "@main/app-core/bundled-plugin-reader.ts";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function makeRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function writePluginBundle(options: {
  readonly dir: string;
  readonly id: string;
  readonly version: string;
  readonly name: string;
}): Promise<void> {
  await mkdir(options.dir, { recursive: true });
  await writeFile(
    join(options.dir, "plugin.json"),
    JSON.stringify({
      id: options.id,
      name: options.name,
      version: options.version,
      commands: [],
      panels: [],
      terminalStatusItems: [],
      workbenchWidgets: [{ id: `${options.id}.widget` }],
    }),
    "utf8"
  );
  const archivePath = join(options.dir, `${options.id}-${options.version}.tgz`);
  await writeFile(
    archivePath,
    `archive:${options.id}@${options.version}`,
    "utf8"
  );
  await writeFile(`${archivePath}.sha256`, `${options.id}-sha\n`, "utf8");
}

describe("readBundledPlugin", () => {
  it("reads each production plugin from its own plugin-packages subdir", async () => {
    const resourcesPath = await makeRoot("pier-bundled-prod-");
    await writePluginBundle({
      dir: join(resourcesPath, "plugin-packages", "pier.codex"),
      id: "pier.codex",
      name: "Codex",
      version: "1.3.1",
    });
    await writePluginBundle({
      dir: join(resourcesPath, "plugin-packages", "pier.grok"),
      id: "pier.grok",
      name: "Grok",
      version: "1.0.1",
    });
    // Shared root plugin.json must not poison either plugin.
    await writeFile(
      join(resourcesPath, "plugin-packages", "plugin.json"),
      JSON.stringify({
        id: "pier.grok",
        name: "Grok poison",
        version: "9.9.9",
      }),
      "utf8"
    );

    const codex = readBundledPlugin(
      {
        devPackageDir: "packages/plugin-codex",
        fallbackId: "pier.codex",
        fallbackName: "Codex fallback",
        fallbackVersion: "0.0.0",
        prodPluginDirName: "pier.codex",
      },
      {
        isDevRuntime: () => false,
        resourcesPath,
      }
    );
    const grok = readBundledPlugin(
      {
        devPackageDir: "packages/plugin-grok",
        fallbackId: "pier.grok",
        fallbackName: "Grok fallback",
        fallbackVersion: "0.0.0",
        prodPluginDirName: "pier.grok",
      },
      {
        isDevRuntime: () => false,
        resourcesPath,
      }
    );

    expect(codex).toMatchObject({
      archivePath: join(
        resourcesPath,
        "plugin-packages",
        "pier.codex",
        "pier.codex-1.3.1.tgz"
      ),
      name: "Codex",
      sha256: "pier.codex-sha",
      version: "1.3.1",
    });
    expect(grok).toMatchObject({
      archivePath: join(
        resourcesPath,
        "plugin-packages",
        "pier.grok",
        "pier.grok-1.0.1.tgz"
      ),
      name: "Grok",
      sha256: "pier.grok-sha",
      version: "1.0.1",
    });
  });

  it("returns null when a production plugin.json id does not match the expected plugin", async () => {
    const resourcesPath = await makeRoot("pier-bundled-mismatch-");
    await writePluginBundle({
      dir: join(resourcesPath, "plugin-packages", "pier.codex"),
      id: "pier.grok",
      name: "Wrong",
      version: "1.0.1",
    });

    expect(
      readBundledPlugin(
        {
          devPackageDir: "packages/plugin-codex",
          fallbackId: "pier.codex",
          fallbackName: "Codex fallback",
          fallbackVersion: "0.0.0",
          prodPluginDirName: "pier.codex",
        },
        {
          isDevRuntime: () => false,
          resourcesPath,
        }
      )
    ).toBeNull();
  });

  it("keeps dev layout on package dist-pkg without requiring prod subdirs", async () => {
    const cwd = await makeRoot("pier-bundled-dev-");
    const packageDir = join(cwd, "packages", "plugin-codex");
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, "plugin.json"),
      JSON.stringify({
        id: "pier.codex",
        name: "Codex dev",
        version: "1.3.1",
        commands: [{ id: "x" }],
        panels: [],
        terminalStatusItems: [],
        workbenchWidgets: [],
      }),
      "utf8"
    );
    await writePluginBundle({
      dir: join(packageDir, "dist-pkg"),
      id: "pier.codex",
      name: "Codex packed",
      version: "1.3.1",
    });

    const bundle = readBundledPlugin(
      {
        devPackageDir: "packages/plugin-codex",
        fallbackId: "pier.codex",
        fallbackName: "Codex fallback",
        fallbackVersion: "0.0.0",
        prodPluginDirName: "pier.codex",
      },
      {
        cwd,
        isDevRuntime: () => true,
      }
    );

    expect(bundle).toMatchObject({
      archivePath: join(packageDir, "dist-pkg", "pier.codex-1.3.1.tgz"),
      contributionCounts: {
        commands: 1,
        panels: 0,
        terminalStatusItems: 0,
        workbenchWidgets: 0,
      },
      name: "Codex dev",
      sha256: "pier.codex-sha",
      version: "1.3.1",
    });
  });
});
