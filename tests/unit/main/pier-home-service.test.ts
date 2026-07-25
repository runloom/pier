import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPierHomeService } from "@main/services/pier-home/service.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("createPierHomeService", () => {
  let tempDir: string;
  let now: number;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pier-home-"));
    now = 1_700_000_000_000;
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it("ensure creates root, meta, readme, canvases, skills library and is idempotent", async () => {
    const upserts: string[] = [];
    const service = createPierHomeService({
      userDataPath: tempDir,
      now: () => now,
      onEnsured: async (info) => {
        upserts.push(info.rootPath);
      },
    });

    const first = await service.ensure();
    const canonical = await realpath(join(tempDir, "pier-home"));
    expect(first).toMatchObject({
      kind: "pier-home",
      rootPath: canonical,
      createdAt: now,
    });
    expect(upserts).toEqual([canonical]);

    const meta = JSON.parse(
      await readFile(join(canonical, ".pier", "home.json"), "utf8")
    );
    expect(meta).toMatchObject({ kind: "pier-home", version: 1 });
    await readFile(join(canonical, "README.md"), "utf8");
    await mkdir(join(canonical, "canvases"), { recursive: true });
    await mkdir(join(canonical, "skills", "library"), { recursive: true });
    await readFile(join(canonical, "skills", "catalog.json"), "utf8");

    now = 1_800_000_000_000;
    const second = await service.ensure();
    expect(second.createdAt).toBe(first.createdAt);
    expect(upserts).toEqual([canonical, canonical]);
  });

  it("isHomeRoot compares realpaths", async () => {
    const service = createPierHomeService({
      userDataPath: tempDir,
      now: () => now,
    });
    const info = await service.ensure();
    await expect(service.isHomeRoot(info.rootPath)).resolves.toBe(true);
    const other = join(tempDir, "other");
    await mkdir(other, { recursive: true });
    await expect(service.isHomeRoot(other)).resolves.toBe(false);
  });
});
