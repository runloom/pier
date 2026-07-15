import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  listConfiguredWorkspaceRoots,
  readPluginWorkspaceConfigFile,
  resolveWorkspaceRootAbsolute,
} from "../../../src/main/services/managed-plugins/plugin-mode.ts";

describe("plugin workspace config file", () => {
  it("reads mode and custom roots from .pier-dev/plugin-workspace.json", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pier-plugin-mode-"));
    await mkdir(join(cwd, ".pier-dev"), { recursive: true });
    await writeFile(
      join(cwd, ".pier-dev/plugin-workspace.json"),
      JSON.stringify({
        mode: "workspace",
        roots: [
          { id: "pier.grok", path: "packages/plugin-grok" },
          { id: "my.custom", path: "../my-plugin" },
        ],
      })
    );

    expect(readPluginWorkspaceConfigFile(cwd)).toEqual({
      mode: "workspace",
      roots: [
        { id: "pier.grok", path: "packages/plugin-grok" },
        { id: "my.custom", path: "../my-plugin" },
      ],
    });
    expect(listConfiguredWorkspaceRoots(cwd)).toHaveLength(2);
    expect(resolveWorkspaceRootAbsolute(cwd, "packages/plugin-grok")).toBe(
      join(cwd, "packages/plugin-grok")
    );
  });

  it("returns null when config file is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pier-plugin-mode-missing-"));
    expect(readPluginWorkspaceConfigFile(cwd)).toBeNull();
    expect(listConfiguredWorkspaceRoots(cwd)).toEqual([]);
  });

  it("ignores malformed root rows", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pier-plugin-mode-bad-"));
    await mkdir(join(cwd, ".pier-dev"), { recursive: true });
    await writeFile(
      join(cwd, ".pier-dev/plugin-workspace.json"),
      JSON.stringify({
        mode: "release",
        roots: [
          { id: "ok", path: "./ok" },
          { id: "", path: "./bad" },
          { path: "./no-id" },
          "not-an-object",
        ],
      })
    );
    expect(readPluginWorkspaceConfigFile(cwd)).toEqual({
      mode: "release",
      roots: [{ id: "ok", path: "./ok" }],
    });
  });
});
