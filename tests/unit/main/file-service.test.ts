import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_IMAGE_PREVIEW_FILE_BYTES } from "@main/files/image-preview-file.ts";
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
  it("reads supported text formats into a revisioned canonical document", async () => {
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("第一行\r\n第二行\r\n", "utf16le"),
    ]);
    await writeFile(join(root, "target.txt"), utf16);
    await symlink("target.txt", join(root, "alias.txt"));
    const service = createFileService();

    const opened = await service.readDocument({ path: "alias.txt", root });
    expect(opened).toMatchObject({
      canonicalPath: "target.txt",
      contents: "第一行\n第二行\n",
      eol: "crlf",
      format: { bom: true, encoding: "utf16le" },
      kind: "text",
      path: "alias.txt",
      root,
      writable: true,
    });
    if (opened.kind !== "text") {
      throw new Error("expected text document");
    }
    await expect(
      service.writeDocument({
        contents: opened.contents,
        eol: "crlf",
        expected: { kind: "revision", revision: opened.revision },
        format: opened.format,
        path: "alias.txt",
        root,
      })
    ).resolves.toMatchObject({ kind: "written" });
    await expect(readFile(join(root, "target.txt"))).resolves.toEqual(utf16);
  });

  it("classifies binary, unsupported encoding, oversized, and directory targets", async () => {
    await writeFile(join(root, "image.png"), Buffer.from([0x89, 0x50, 0, 1]));
    await writeFile(
      join(root, "legacy.txt"),
      Buffer.from([0x63, 0x61, 0x66, 0xe9])
    );
    await writeFile(join(root, "large.txt"), "");
    await truncate(join(root, "large.txt"), 10 * 1024 * 1024 + 1);
    await mkdir(join(root, "folder"));
    const service = createFileService();

    await expect(
      service.readDocument({ path: "image.png", root })
    ).resolves.toMatchObject({
      kind: "binary",
      mime: "image/png",
    });
    await expect(
      service.readDocument({ path: "legacy.txt", root })
    ).resolves.toMatchObject({ kind: "unsupported-encoding" });
    await expect(
      service.readDocument({ path: "large.txt", root })
    ).resolves.toMatchObject({
      kind: "too-large",
      limit: 10 * 1024 * 1024,
      size: 10 * 1024 * 1024 + 1,
    });
    await expect(
      service.readDocument({ path: "folder", root })
    ).resolves.toMatchObject({
      fileType: "directory",
      kind: "unsupported-file",
    });
  });

  it.each([
    [
      "png",
      "image/png",
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
    ["jpg", "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ["gif", "image/gif", Buffer.from("GIF89a", "ascii")],
    [
      "webp",
      "image/webp",
      Buffer.concat([
        Buffer.from("RIFF", "ascii"),
        Buffer.alloc(4),
        Buffer.from("WEBP", "ascii"),
      ]),
    ],
  ])("classifies oversized %s bytes as a previewable image by signature", async (extension, mime, signature) => {
    const path = `large.${extension}`;
    const target = join(root, path);
    await writeFile(target, signature);
    await truncate(target, 10 * 1024 * 1024 + 1);

    const result = await createFileService().readDocument({ path, root });

    expect(result).toMatchObject({
      canonicalPath: path,
      kind: "image",
      mime,
      path,
      root,
      size: 10 * 1024 * 1024 + 1,
    });
    expect(result).toHaveProperty("mtimeMs");
    expect(result).toHaveProperty("revision");
  });

  it("rejects a signature-classified image above the bounded preview limit", async () => {
    const path = "oversized-preview.png";
    const target = join(root, path);
    await writeFile(
      target,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    await truncate(target, MAX_IMAGE_PREVIEW_FILE_BYTES + 1);

    await expect(
      createFileService().readDocument({ path, root })
    ).resolves.toMatchObject({
      kind: "too-large",
      limit: MAX_IMAGE_PREVIEW_FILE_BYTES,
      path,
      root,
      size: MAX_IMAGE_PREVIEW_FILE_BYTES + 1,
    });
  });

  it("does not trust image extensions or classify SVG as a previewable image", async () => {
    await writeFile(join(root, "spoofed.png"), Buffer.from([0, 1, 2, 3]));
    await writeFile(
      join(root, "vector.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    );

    await expect(
      createFileService().readDocument({ path: "spoofed.png", root })
    ).resolves.toMatchObject({ kind: "binary", mime: "image/png" });
    await expect(
      createFileService().readDocument({ path: "vector.svg", root })
    ).resolves.toMatchObject({ kind: "text" });
  });

  it("detects same-mtime content changes through opaque revisions", async () => {
    const target = join(root, "notes.txt");
    await writeFile(target, "one\n");
    const service = createFileService();
    const original = await service.readDocument({ path: "notes.txt", root });
    if (original.kind !== "text") {
      throw new Error("expected text document");
    }
    const baseline = await stat(target);
    await writeFile(target, "two\n");
    await utimes(target, baseline.atime, baseline.mtime);

    await expect(
      service.writeDocument({
        contents: "pier\n",
        eol: "lf",
        expected: { kind: "revision", revision: original.revision },
        format: { bom: false, encoding: "utf8" },
        path: "notes.txt",
        root,
      })
    ).resolves.toEqual({
      kind: "conflict",
      reason: "revision-mismatch",
    });
    await expect(readFile(target, "utf8")).resolves.toBe("two\n");
  });

  it("detects a symlink repoint even when both targets have equal contents", async () => {
    await writeFile(join(root, "first.txt"), "same\n");
    await writeFile(join(root, "second.txt"), "same\n");
    await symlink("first.txt", join(root, "alias.txt"));
    const service = createFileService();
    const original = await service.readDocument({ path: "alias.txt", root });
    if (original.kind !== "text") {
      throw new Error("expected text document");
    }
    await rm(join(root, "alias.txt"));
    await symlink("second.txt", join(root, "alias.txt"));

    await expect(
      service.writeDocument({
        contents: "changed\n",
        eol: "lf",
        expected: { kind: "revision", revision: original.revision },
        format: { bom: false, encoding: "utf8" },
        path: "alias.txt",
        root,
      })
    ).resolves.toEqual({
      kind: "conflict",
      reason: "revision-mismatch",
    });
  });

  it("distinguishes a symlink entry from its canonical path impact", async () => {
    await mkdir(join(root, "real"));
    await writeFile(join(root, "real", "notes.md"), "notes\n");
    await symlink("real", join(root, "linked"));
    const service = createFileService();

    await expect(
      service.inspectPathImpact({ path: "linked", root })
    ).resolves.toEqual({
      kind: "symlink-entry",
      locatorPrefix: "linked",
      root,
    });
    await expect(
      service.inspectPathImpact({ path: "linked/notes.md", root })
    ).resolves.toEqual({
      canonicalBackingPrefix: "real/notes.md",
      kind: "regular",
      locatorPrefix: "linked/notes.md",
      root,
    });
  });

  it("inspects arbitrary overwrite targets without returning their contents", async () => {
    await writeFile(join(root, "binary.dat"), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(root, "large.dat"), "");
    await truncate(join(root, "large.dat"), 10 * 1024 * 1024 + 1);
    await mkdir(join(root, "folder"));
    const service = createFileService();

    await expect(
      service.inspectWriteTarget({ path: "missing.txt", root })
    ).resolves.toEqual({ kind: "absent" });
    await expect(
      service.inspectWriteTarget({ path: "binary.dat", root })
    ).resolves.toMatchObject({
      fileType: "binary",
      kind: "existing",
      size: 4,
    });
    await expect(
      service.inspectWriteTarget({ path: "large.dat", root })
    ).resolves.toMatchObject({
      fileType: "too-large",
      kind: "existing",
    });
    await expect(
      service.inspectWriteTarget({ path: "folder", root })
    ).resolves.toEqual({
      fileType: "directory",
      kind: "unsupported-file",
    });
  });

  it("rejects listing a symlinked directory that resolves outside the declared root", async () => {
    const outsideDir = join(outsideRoot, "external-dir");
    await mkdir(outsideDir);
    await writeFile(join(outsideDir, "secret.txt"), "outside\n");
    await symlink(outsideDir, join(root, "linked-dir"));

    const service = createFileService();

    await expect(service.list({ path: "linked-dir", root })).rejects.toThrow();
  });

  it("lists in-root symlinks by resolved target kind and omits broken or escaping links", async () => {
    await mkdir(join(root, "real-dir"));
    await writeFile(join(root, "real.txt"), "hello\n");
    await symlink("real-dir", join(root, "link-dir"));
    await symlink("real.txt", join(root, "link-file.txt"));
    await symlink("missing-target", join(root, "broken-link"));
    await symlink(join(outsideRoot, "escape"), join(root, "escape-link"));

    const service = createFileService();
    const entries = await service.list({ path: "", root });

    expect(entries).toEqual(
      expect.arrayContaining([
        { kind: "directory", path: "link-dir", root },
        { kind: "directory", path: "real-dir", root },
        { kind: "file", path: "link-file.txt", root },
        { kind: "file", path: "real.txt", root },
      ])
    );
    expect(entries.map((entry) => entry.path)).not.toContain("broken-link");
    expect(entries.map((entry) => entry.path)).not.toContain("escape-link");
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
    const moveLinkFile = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error("EXDEV: cross-device link not permitted"), {
          code: "EXDEV",
        })
      )
    );
    const service = createFileService({ moveLinkFile });

    await expect(
      service.move({ newPath: "dest/main.ts", path: "src/index.ts", root })
    ).resolves.toEqual({
      moved: true,
      newPath: "dest/main.ts",
      oldPath: "src/index.ts",
      root,
    });
    expect(moveLinkFile).toHaveBeenCalledWith(
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

  it("does not overwrite a move target that appears concurrently", async () => {
    await mkdir(join(root, "src"));
    const source = join(root, "src", "index.ts");
    const target = join(root, "dest", "main.ts");
    await writeFile(source, "source\n");
    const moveLinkFile = vi.fn(async () => {
      await writeFile(target, "external\n");
      throw Object.assign(new Error("EEXIST: target exists"), {
        code: "EEXIST",
      });
    });
    const service = createFileService({ moveLinkFile });

    await expect(
      service.move({ newPath: "dest/main.ts", path: "src/index.ts", root })
    ).rejects.toThrow("target exists");
    await expect(readFile(source, "utf8")).resolves.toBe("source\n");
    await expect(readFile(target, "utf8")).resolves.toBe("external\n");
  });

  it("rethrows non-EXDEV rename errors without the copy fallback", async () => {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "index.ts"), "export {};\n");

    const service = createFileService({
      moveLinkFile: () =>
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
