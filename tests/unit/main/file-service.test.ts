import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
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

  it("rejects exists checks for symlinked files outside the declared root", async () => {
    const outsideFile = join(outsideRoot, "secret.txt");
    await writeFile(outsideFile, "outside\n");
    await symlink(outsideFile, join(root, "secret-link.txt"));
    const service = createFileService();

    await expect(
      service.exists({ path: "secret-link.txt", root })
    ).rejects.toThrow();
  });

  it("rejects stat checks for symlinked files outside the declared root", async () => {
    const outsideFile = join(outsideRoot, "secret.txt");
    await writeFile(outsideFile, "outside\n");
    await symlink(outsideFile, join(root, "secret-link.txt"));
    const service = createFileService();

    await expect(
      service.stat({ path: "secret-link.txt", root })
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

  it("mkdir creates a nested directory under the root", async () => {
    const service = createFileService();

    const result = await service.mkdir({
      path: "a/b/c",
      root,
    });

    expect(result).toEqual({ created: true, path: "a/b/c", root });
    const check = await service.exists({ path: "a/b/c", root });
    expect(check.exists).toBe(true);
  });
  it("mkdir is idempotent when the target already exists", async () => {
    await mkdir(join(root, "existing"));
    const service = createFileService();

    const result = await service.mkdir({
      path: "existing",
      root,
    });

    expect(result.created).toBe(true);
  });

  it("mkdir rejects paths escaping the root", async () => {
    const service = createFileService();

    await expect(service.mkdir({ path: "../escape", root })).rejects.toThrow();
  });

  it("exists returns false for missing paths", async () => {
    const service = createFileService();

    const result = await service.exists({ path: "nope", root });

    expect(result.exists).toBe(false);
  });

  it("exists returns true for present files", async () => {
    await writeFile(join(root, "here.txt"), "");
    const service = createFileService();

    const result = await service.exists({ path: "here.txt", root });

    expect(result.exists).toBe(true);
  });

  it("mkdir rejects target inside a symlink that escapes the root", async () => {
    // outsideRoot/target 是逃逸目录;linked-dir → outsideRoot 让 lexical 校验
    // (只看 "../") 无法拦截,必须靠 resolveWritableScopedPath 的 realpath。
    await mkdir(outsideRoot, { recursive: true });
    await symlink(outsideRoot, join(root, "linked-dir"));
    const service = createFileService();

    await expect(
      service.mkdir({ path: "linked-dir/deeper", root })
    ).rejects.toThrow();
  });

  it("mkdir supports concurrent same-target creation without EEXIST races", async () => {
    const service = createFileService();

    // 10 个并发 mkdir 同一深层 path。recursive:true 让 fs 忽略 EEXIST,
    // 保证:所有 Promise resolve、目标最终存在、无一 throw。
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        service.mkdir({ path: "concurrent/nested/leaf", root })
      )
    );

    expect(results.every((r) => r.created)).toBe(true);
    const check = await service.exists({
      path: "concurrent/nested/leaf",
      root,
    });
    expect(check.exists).toBe(true);
  });

  it("mkdir creates intermediate directories atomically for nested paths", async () => {
    const service = createFileService();

    await service.mkdir({ path: "level-1/level-2/level-3", root });

    for (const step of [
      "level-1",
      "level-1/level-2",
      "level-1/level-2/level-3",
    ]) {
      const check = await service.exists({ path: step, root });
      expect(check.exists).toBe(true);
    }
  });

  it("exists reports true for directories, not only files", async () => {
    await mkdir(join(root, "dir"));
    const service = createFileService();

    const result = await service.exists({ path: "dir", root });

    expect(result.exists).toBe(true);
  });

  it("exists resolves symlinks and reports the target's existence", async () => {
    await writeFile(join(root, "real.txt"), "");
    await symlink(join(root, "real.txt"), join(root, "alias.txt"));
    const service = createFileService();

    const result = await service.exists({ path: "alias.txt", root });

    expect(result.exists).toBe(true);
  });

  it("exists rejects paths escaping the root", async () => {
    const service = createFileService();

    await expect(service.exists({ path: "../escape", root })).rejects.toThrow();
  });

  it("stats an existing file and reports missing paths", async () => {
    await writeFile(join(root, "notes.txt"), "hello\n");
    const service = createFileService();

    await expect(service.stat({ path: "notes.txt", root })).resolves.toEqual(
      expect.objectContaining({
        exists: true,
        isDirectory: false,
        path: "notes.txt",
        root,
        size: 6,
      })
    );
    await expect(service.stat({ path: "missing.txt", root })).resolves.toEqual({
      exists: false,
      isDirectory: false,
      mtimeMs: null,
      path: "missing.txt",
      root,
      size: null,
    });
  });

  it("rejects writes that fail expectedMtimeMs conflict checks", async () => {
    await writeFile(join(root, "notes.txt"), "v1\n");
    const service = createFileService();
    await writeFile(join(root, "notes.txt"), "external\n");

    await expect(
      service.writeText({
        contents: "v2\n",
        // Force a stale baseline: filesystem mtime granularity can otherwise
        // make two rapid writes look identical within the conflict epsilon.
        expectedMtimeMs: 1,
        path: "notes.txt",
        root,
      })
    ).rejects.toMatchObject({ code: "file_conflict" });
    await expect(readFile(join(root, "notes.txt"), "utf8")).resolves.toBe(
      "external\n"
    );
  });

  it("treats a missing file during expectedMtimeMs writes as a conflict", async () => {
    await writeFile(join(root, "notes.txt"), "v1\n");
    const service = createFileService();
    const baseline = await service.stat({ path: "notes.txt", root });
    if (baseline.mtimeMs === null) {
      throw new Error("expected baseline mtime");
    }
    await rm(join(root, "notes.txt"));

    await expect(
      service.writeText({
        contents: "v2\n",
        expectedMtimeMs: baseline.mtimeMs,
        path: "notes.txt",
        root,
      })
    ).rejects.toMatchObject({ code: "file_conflict" });
    await expect(readFile(join(root, "notes.txt"), "utf8")).rejects.toThrow();
  });

  it("copies files and directories without overwriting existing targets", async () => {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "a.ts"), "export {};\n");
    const service = createFileService();

    await expect(
      service.copy({ newPath: "src/a copy.ts", path: "src/a.ts", root })
    ).resolves.toEqual({
      copied: true,
      newPath: "src/a copy.ts",
      oldPath: "src/a.ts",
      root,
    });
    await expect(
      readFile(join(root, "src", "a copy.ts"), "utf8")
    ).resolves.toBe("export {};\n");
    await expect(
      service.copy({ newPath: "src/a copy.ts", path: "src/a.ts", root })
    ).rejects.toThrow();
  });

  it("reveals items through the injected shell opener", async () => {
    await writeFile(join(root, "notes.txt"), "x\n");
    const revealItem = vi.fn();
    const service = createFileService({ revealItem });

    await expect(service.reveal({ path: "notes.txt", root })).resolves.toEqual({
      path: "notes.txt",
      revealed: true,
      root,
    });
    expect(revealItem).toHaveBeenCalledWith(join(root, "notes.txt"));
    await expect(
      service.reveal({ path: "missing.txt", root })
    ).rejects.toThrow();
  });

  it("writes through a temporary file and exposes the new mtime", async () => {
    const service = createFileService();
    const result = await service.writeText({
      contents: "atomic\n",
      path: "out/file.txt",
      root,
    });
    expect(result).toEqual(
      expect.objectContaining({
        path: "out/file.txt",
        root,
        written: true,
      })
    );
    expect(typeof result.mtimeMs).toBe("number");
    await expect(readFile(join(root, "out", "file.txt"), "utf8")).resolves.toBe(
      "atomic\n"
    );
  });

  it("uses unique temporary files for concurrent writes to the same path", async () => {
    let renameCalls = 0;
    let releaseRenames!: () => void;
    const renamesReady = new Promise<void>((resolve) => {
      releaseRenames = resolve;
    });
    const renameFile = vi.fn(async (source: string, target: string) => {
      renameCalls += 1;
      if (renameCalls === 2) {
        releaseRenames();
      }
      await renamesReady;
      await rename(source, target);
    });
    const service = createFileService({ renameFile });

    const writes = Promise.allSettled([
      service.writeText({ contents: "first\n", path: "notes.txt", root }),
      service.writeText({ contents: "second\n", path: "notes.txt", root }),
    ]);
    while (renameCalls < 2) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    releaseRenames();
    const results = await writes;

    expect(results).toEqual([
      expect.objectContaining({ status: "fulfilled" }),
      expect.objectContaining({ status: "fulfilled" }),
    ]);
    expect(new Set(renameFile.mock.calls.map(([source]) => source)).size).toBe(
      2
    );
  });
});
