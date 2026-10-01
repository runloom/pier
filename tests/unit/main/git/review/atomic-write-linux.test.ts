import type { BigIntStats } from "node:fs";
import type * as FsPromises from "node:fs/promises";
import {
  lstat,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { readGitReviewFileSnapshot } from "@main/services/git-review/path/guard.ts";
import { writeGitReviewFileContents } from "@main/services/git-review/path/write.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

type CandidateHook = (path: string) => Promise<void>;

const hooks = vi.hoisted(() => ({
  afterMetadata: undefined as CandidateHook | undefined,
  afterSync: undefined as CandidateHook | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const candidate = String(args[0]);
      if (!basename(candidate).startsWith(".pier-conflict-")) return handle;
      const chmod = handle.chmod.bind(handle);
      handle.chmod = async (mode) => {
        await chmod(mode);
        await hooks.afterMetadata?.(candidate);
      };
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        await sync();
        await hooks.afterSync?.(candidate);
      };
      return handle;
    },
  };
});

const roots: string[] = [];

afterEach(async () => {
  hooks.afterMetadata = undefined;
  hooks.afterSync = undefined;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pier-linux-publication-"));
  roots.push(root);
  const path = join(root, "conflict.ts");
  await writeFile(path, "original contents\n");
  const original = await stat(path, { bigint: true });
  const snapshot = await readGitReviewFileSnapshot({
    gitRootPath: root,
    path: "conflict.ts",
  });
  return { original, path, root, snapshot };
}

async function expectOriginalUntouched(path: string, original: BigIntStats) {
  expect(await readFile(path, "utf8")).toBe("original contents\n");
  const current = await lstat(path, { bigint: true });
  expect(current.isFile()).toBe(true);
  expect(current.dev).toBe(original.dev);
  expect(current.ino).toBe(original.ino);
}

// The syscall hooks retain real descriptors and perform real directory mutations.
// Native macOS coverage requires an injected-syscall smoke.
describe.runIf(process.platform === "linux")("Linux candidate guard", () => {
  it.each([
    "symlink",
    "regular",
  ] as const)("rejects a %s temporary-name replacement without deleting it", async (kind) => {
    const { original, path, root, snapshot } = await fixture();
    let candidatePath = "";
    let replacementInode = 0n;
    hooks.afterSync = async (candidate) => {
      candidatePath = join(root, basename(candidate));
      await unlink(candidate);
      if (kind === "symlink") {
        await symlink("conflict.ts", candidate);
      } else {
        await writeFile(candidate, "foreign replacement\n");
      }
      replacementInode = (await lstat(candidate, { bigint: true })).ino;
    };
    await expect(
      writeGitReviewFileContents({
        contents: "resolved\n",
        expectedSnapshot: snapshot,
        gitRootPath: root,
        path: "conflict.ts",
      })
    ).rejects.toMatchObject({ reason: "changed" });
    await expectOriginalUntouched(path, original);
    const replacement = await lstat(candidatePath, { bigint: true });
    expect(replacement.ino).toBe(replacementInode);
    if (kind === "symlink") {
      expect(replacement.isSymbolicLink()).toBe(true);
      expect(await readlink(candidatePath)).toBe("conflict.ts");
    } else {
      expect(replacement.isFile()).toBe(true);
      expect(await readFile(candidatePath, "utf8")).toBe(
        "foreign replacement\n"
      );
    }
  });

  it("rejects same-inode, same-size writes during sync and removes only its own candidate", async () => {
    const { original, path, root, snapshot } = await fixture();
    let candidatePath = "";
    hooks.afterSync = async (candidate) => {
      candidatePath = join(root, basename(candidate));
      await writeFile(candidate, "tampered\n");
      await utimes(candidate, new Date(0), new Date(0));
    };
    await expect(
      writeGitReviewFileContents({
        contents: "resolved\n",
        expectedSnapshot: snapshot,
        gitRootPath: root,
        path: "conflict.ts",
      })
    ).rejects.toMatchObject({ reason: "changed" });
    await expectOriginalUntouched(path, original);
    await expect(lstat(candidatePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each([
    9,
    64 * 1024 + 17,
  ])("rejects a %i-byte candidate edited before the stat snapshot, including its final byte", async (length) => {
    const { original, path, root, snapshot } = await fixture();
    const contents = "r".repeat(length);
    let candidatePath = "";
    hooks.afterMetadata = async (candidate) => {
      candidatePath = join(root, basename(candidate));
      await writeFile(candidate, `${contents.slice(0, -1)}x`);
    };
    await expect(
      writeGitReviewFileContents({
        contents,
        expectedSnapshot: snapshot,
        gitRootPath: root,
        path: "conflict.ts",
      })
    ).rejects.toMatchObject({ reason: "changed" });
    await expectOriginalUntouched(path, original);
    await expect(lstat(candidatePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each([
    { name: "empty", contents: "" },
    { name: "multiple chunks", contents: `${"abcde".repeat(14_000)}\n` },
  ])("publishes $name contents completely", async ({ contents }) => {
    const { original, path, root, snapshot } = await fixture();
    await writeGitReviewFileContents({
      contents,
      expectedSnapshot: snapshot,
      gitRootPath: root,
      path: "conflict.ts",
    });
    expect(await readFile(path, "utf8")).toBe(contents);
    const published = await lstat(path, { bigint: true });
    expect(published.isFile()).toBe(true);
    expect(published.ino).not.toBe(original.ino);
  });

  it("reports a removed temporary name as changed without touching the target", async () => {
    const { original, path, root, snapshot } = await fixture();
    hooks.afterSync = async (candidate) => unlink(candidate);
    await expect(
      writeGitReviewFileContents({
        contents: "resolved\n",
        expectedSnapshot: snapshot,
        gitRootPath: root,
        path: "conflict.ts",
      })
    ).rejects.toMatchObject({ reason: "changed" });
    await expectOriginalUntouched(path, original);
  });
});
