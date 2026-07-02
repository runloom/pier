import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileService } from "@main/services/file-service.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tempDirs: string[] = [];
let root: string;
let outsideRoot: string;

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(async () => {
  root = await makeTempDir("pier-file-service-root-");
  outsideRoot = await makeTempDir("pier-file-service-outside-");
});

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { force: true, recursive: true }))
  );
  tempDirs = [];
});

describe("createFileService", () => {
  it("rejects listing a symlinked directory that resolves outside the declared root", async () => {
    const outsideDir = join(outsideRoot, "external-dir");
    await mkdir(outsideDir);
    await writeFile(join(outsideDir, "secret.txt"), "outside\n");
    await symlink(outsideDir, join(root, "linked-dir"));

    const service = createFileService();

    await expect(service.list({ path: "linked-dir", root })).rejects.toThrow();
  });

  it("rejects reading a symlinked file that resolves outside the declared root", async () => {
    const outsideFile = join(outsideRoot, "secret.txt");
    await writeFile(outsideFile, "outside\n");
    await symlink(outsideFile, join(root, "secret-link.txt"));

    const service = createFileService();

    await expect(
      service.readText({ path: "secret-link.txt", root })
    ).rejects.toThrow();
  });

  it("rejects writing through a symlinked directory before creating files outside the declared root", async () => {
    const outsideDir = join(outsideRoot, "external-dir");
    const outsideFile = join(outsideDir, "created.txt");
    await mkdir(outsideDir);
    await symlink(outsideDir, join(root, "linked-dir"));

    const service = createFileService();

    await expect(
      service.writeText({
        contents: "must stay inside root\n",
        path: "linked-dir/created.txt",
        root,
      })
    ).rejects.toThrow();
    await expect(readFile(outsideFile, "utf8")).rejects.toThrow();
  });
});
