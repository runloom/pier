// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCanvasContentDirectories } from "../../../../src/main/services/canvas-command/content-directories.ts";
import { LIVE_MODULE_DEFAULT_HOME_DIRECTORY } from "../../../../src/shared/contracts/live-modules.ts";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { force: true, recursive: true });
  }
});

describe("resolveCanvasContentDirectories", () => {
  it("falls back to factory defaults when the config file is missing", async () => {
    const project = await mkdtemp(join(tmpdir(), "pier-canvas-dirs-"));
    dirs.push(project);
    const directories = await resolveCanvasContentDirectories(project, {
      isHomeRoot: false,
    });
    expect(directories).toEqual([".pier/canvases", "docs"]);
  });

  it("loads an explicit contentDirectories list from disk", async () => {
    const project = await mkdtemp(join(tmpdir(), "pier-canvas-dirs-"));
    dirs.push(project);
    await mkdir(join(project, ".pier"), { recursive: true });
    await writeFile(
      join(project, ".pier/live-modules.json"),
      `${JSON.stringify({
        contentDirectories: ["resources/system-skills/pier-canvas/templates"],
        version: 1,
      })}\n`
    );
    const directories = await resolveCanvasContentDirectories(project, {
      isHomeRoot: false,
    });
    expect(directories).toEqual([
      "resources/system-skills/pier-canvas/templates",
    ]);
  });

  it("reads the config from the primary checkout for a linked worktree", async () => {
    const directories = await resolveCanvasContentDirectories(
      "/repo.worktree/feat",
      {
        isHomeRoot: false,
        readConfig: async (configRoot) => {
          expect(configRoot).toBe("/repo");
          return `${JSON.stringify({
            contentDirectories: ["designs"],
            version: 1,
          })}\n`;
        },
        resolveConfigRoot: async () => "/repo",
      }
    );
    expect(directories).toEqual(["designs"]);
  });

  it("unions the home canvases directory without dropping project roots", async () => {
    const directories = await resolveCanvasContentDirectories("/home", {
      isHomeRoot: true,
      readConfig: async () => null,
      resolveConfigRoot: async () => "/home",
    });
    expect(directories[0]).toBe(LIVE_MODULE_DEFAULT_HOME_DIRECTORY);
    expect(directories).toContain(".pier/canvases");
    expect(directories).toContain("docs");
  });
});
