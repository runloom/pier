import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPluginService,
  type PluginServiceError,
} from "@main/services/plugin-service.ts";
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-plugin-service-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

const builtinManifest = {
  apiVersion: 1,
  commands: [
    {
      id: "sample.sayHello",
      title: "Say Hello",
    },
  ],
  description: "Sample builtin plugin",
  engines: { pier: ">=0.1.0" },
  homepage: "https://example.com/pier-plugin",
  id: "sample.builtin",
  name: "Sample Builtin",
  panels: [
    {
      component: "sample.panel",
      id: "sample.panel",
      title: "Sample Panel",
    },
  ],
  permissions: ["plugin:read", "panel:register", "command:register"],
  publisher: "Pier",
  repository: "https://example.com/repo.git",
  source: { kind: "builtin" },
  version: "1.0.0",
};

describe("pluginManifestSchema", () => {
  it("校验 manifest source、权限、commands 和 panels", () => {
    expect(pluginManifestSchema.parse(builtinManifest)).toMatchObject({
      commands: [{ id: "sample.sayHello" }],
      panels: [{ id: "sample.panel" }],
      permissions: ["plugin:read", "panel:register", "command:register"],
      source: { kind: "builtin" },
    });
  });

  it("拒绝无效 manifest", () => {
    expect(() =>
      pluginManifestSchema.parse({
        ...builtinManifest,
        id: "",
        source: { kind: "remote" },
      })
    ).toThrow();
  });
});

describe("createPluginService", () => {
  it("发现 builtin 和 local manifest，并支持 list/inspect", async () => {
    const dir = await makeTempDir();
    const localPath = join(dir, "pier-plugin.json");
    await writeFile(
      localPath,
      JSON.stringify({
        ...builtinManifest,
        id: "sample.local",
        name: "Sample Local",
        permissions: ["plugin:read"],
        source: { kind: "local", url: localPath },
      })
    );
    const service = createPluginService({
      sources: [
        { kind: "builtin", manifest: builtinManifest },
        { kind: "local", path: localPath },
      ],
      state: {
        read: () =>
          Promise.resolve({
            plugins: { "sample.local": { enabled: true, updatedAt: 1 } },
            version: 1,
          }),
        setEnabled: (id, enabled) =>
          Promise.resolve({
            plugins: { [id]: { enabled, updatedAt: 2 } },
            version: 1,
          }),
      },
    });

    await expect(service.list()).resolves.toMatchObject([
      {
        enabled: false,
        id: "sample.builtin",
        manifest: { source: { kind: "builtin" } },
      },
      {
        enabled: true,
        id: "sample.local",
        manifest: { source: { kind: "local", url: localPath } },
      },
    ]);

    await expect(service.inspect("sample.local")).resolves.toMatchObject({
      commands: [{ id: "sample.sayHello" }],
      enabled: true,
      id: "sample.local",
      panels: [{ id: "sample.panel" }],
    });
  });

  it("enabled/disabled 状态由 userData state 决定", async () => {
    let enabled = false;
    const service = createPluginService({
      sources: [{ kind: "builtin", manifest: builtinManifest }],
      state: {
        read: () =>
          Promise.resolve({
            plugins: { "sample.builtin": { enabled, updatedAt: 1 } },
            version: 1,
          }),
        setEnabled: (_id, nextEnabled) => {
          enabled = nextEnabled;
          return Promise.resolve({
            plugins: { "sample.builtin": { enabled, updatedAt: 2 } },
            version: 1,
          });
        },
      },
    });

    await expect(service.inspect("sample.builtin")).resolves.toMatchObject({
      enabled: false,
    });
    await expect(
      service.setEnabled("sample.builtin", true)
    ).resolves.toMatchObject({
      enabled: true,
    });
  });

  it("git 和 registry source 返回明确 unsupported 错误", async () => {
    const service = createPluginService({
      sources: [{ kind: "git", url: "https://example.com/plugin.git" }],
    });

    await expect(service.list()).rejects.toMatchObject({
      code: "unsupported",
      message: "plugin source kind is not supported yet: git",
    } satisfies Partial<PluginServiceError>);
  });
});
