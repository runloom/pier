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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("moves a file within the root via rename", async () => {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "index.ts"), "export {};\n");

    const service = createFileService();

    await expect(
      service.move({ newPath: "dest/main.ts", path: "src/index.ts", root })
    ).resolves.toEqual({
      moved: true,
      newPath: "dest/main.ts",
      oldPath: "src/index.ts",
      root,
    });
    await expect(readFile(join(root, "dest", "main.ts"), "utf8")).resolves.toBe(
      "export {};\n"
    );
    await expect(
      readFile(join(root, "src", "index.ts"), "utf8")
    ).rejects.toThrow();
  });

  it("falls back to copy + delete when rename fails with EXDEV", async () => {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "index.ts"), "export {};\n");

    // 真实测试环境无法稳定制造跨设备目录,注入抛 EXDEV 的 rename
    // 以覆盖降级分支;cp/rm 走真实文件系统验证复制+删源效果。
    const renameFile = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error("EXDEV: cross-device link not permitted"), {
          code: "EXDEV",
        })
      )
    );
    const service = createFileService({ renameFile });

    await expect(
      service.move({ newPath: "dest/main.ts", path: "src/index.ts", root })
    ).resolves.toEqual({
      moved: true,
      newPath: "dest/main.ts",
      oldPath: "src/index.ts",
      root,
    });
    expect(renameFile).toHaveBeenCalledWith(
      join(root, "src", "index.ts"),
      join(root, "dest", "main.ts")
    );
    await expect(readFile(join(root, "dest", "main.ts"), "utf8")).resolves.toBe(
      "export {};\n"
    );
    await expect(
      readFile(join(root, "src", "index.ts"), "utf8")
    ).rejects.toThrow();
  });

  it("rethrows non-EXDEV rename errors without the copy fallback", async () => {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "index.ts"), "export {};\n");

    const service = createFileService({
      renameFile: () =>
        Promise.reject(
          Object.assign(new Error("EPERM: operation not permitted"), {
            code: "EPERM",
          })
        ),
    });

    await expect(
      service.move({ newPath: "dest/main.ts", path: "src/index.ts", root })
    ).rejects.toThrow("EPERM");
    await expect(
      readFile(join(root, "dest", "main.ts"), "utf8")
    ).rejects.toThrow();
    await expect(readFile(join(root, "src", "index.ts"), "utf8")).resolves.toBe(
      "export {};\n"
    );
  });

  it("trashes via the injected trashItem with the resolved absolute path", async () => {
    await writeFile(join(root, "junk.txt"), "junk\n");

    const trashItem = vi.fn(() => Promise.resolve());
    const service = createFileService({ trashItem });

    await expect(service.trash({ path: "junk.txt", root })).resolves.toEqual({
      path: "junk.txt",
      root,
      trashed: true,
    });
    expect(trashItem).toHaveBeenCalledTimes(1);
    expect(trashItem).toHaveBeenCalledWith(join(root, "junk.txt"));
  });

  it("rejects trashing paths that escape the root without touching the trash", async () => {
    await writeFile(join(outsideRoot, "secret.txt"), "outside\n");
    await symlink(
      join(outsideRoot, "secret.txt"),
      join(root, "secret-link.txt")
    );

    const trashItem = vi.fn(() => Promise.resolve());
    const service = createFileService({ trashItem });

    await expect(
      service.trash({ path: "../secret.txt", root })
    ).rejects.toThrow();
    await expect(
      service.trash({ path: "secret-link.txt", root })
    ).rejects.toThrow();
    expect(trashItem).not.toHaveBeenCalled();
  });
});
