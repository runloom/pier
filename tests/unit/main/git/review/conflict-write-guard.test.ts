import {
  chmod,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGitReviewFileSnapshot } from "@main/services/git-review/path/guard.ts";
import { writeGitReviewFileContents } from "@main/services/git-review/path/write.ts";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pier-conflict-write-guard-"));
  roots.push(root);
  const path = join(root, "conflict.ts");
  await writeFile(path, "original contents\n");
  const snapshot = await readGitReviewFileSnapshot({
    gitRootPath: root,
    path: "conflict.ts",
  });
  return { root, path, snapshot };
}

describe("conflict file publication guard", () => {
  it("rejects an edited file before truncation or overwrite", async () => {
    const { root, path, snapshot } = await fixture();
    await writeFile(path, "external contents\n");
    await expect(
      writeGitReviewFileContents({
        contents: "resolved\n",
        expectedSnapshot: snapshot,
        gitRootPath: root,
        path: "conflict.ts",
      })
    ).rejects.toMatchObject({ reason: "changed" });
    expect(await readFile(path, "utf8")).toBe("external contents\n");
  });

  it("rejects a replaced file even when its bytes match the observed file", async () => {
    const { root, path, snapshot } = await fixture();
    const replacement = join(root, "replacement.ts");
    await writeFile(replacement, "original contents\n");
    await rename(replacement, path);
    await expect(
      writeGitReviewFileContents({
        contents: "resolved\n",
        expectedSnapshot: snapshot,
        gitRootPath: root,
        path: "conflict.ts",
      })
    ).rejects.toMatchObject({ reason: "changed" });
    expect(await readFile(path, "utf8")).toBe("original contents\n");
  });

  it("preserves the original contents when same-directory publication is denied", async () => {
    const { root, path, snapshot } = await fixture();
    await chmod(root, 0o500);
    try {
      await expect(
        writeGitReviewFileContents({
          contents: "must not replace the original\n",
          expectedSnapshot: snapshot,
          gitRootPath: root,
          path: "conflict.ts",
        })
      ).rejects.toMatchObject({ reason: "readFailed" });
      expect(await readFile(path, "utf8")).toBe("original contents\n");
    } finally {
      await chmod(root, 0o700);
    }
  });

  it("leaves existing readers on the original complete file when publishing a replacement", async () => {
    const { root, path, snapshot } = await fixture();
    const reader = await open(path, "r");
    try {
      await writeGitReviewFileContents({
        contents: "resolved contents\n",
        expectedSnapshot: snapshot,
        gitRootPath: root,
        path: "conflict.ts",
      });
      expect(await readFile(path, "utf8")).toBe("resolved contents\n");
      expect(await reader.readFile("utf8")).toBe("original contents\n");
    } finally {
      await reader.close();
    }
  });

  it("publishes shorter contents completely while preserving the executable mode", async () => {
    const { root, path } = await fixture();
    await chmod(path, 0o755);
    const original = await stat(path);
    const snapshot = await readGitReviewFileSnapshot({
      gitRootPath: root,
      path: "conflict.ts",
    });
    await writeGitReviewFileContents({
      contents: "ok\n",
      expectedSnapshot: snapshot,
      gitRootPath: root,
      path: "conflict.ts",
    });
    expect(await readFile(path, "utf8")).toBe("ok\n");
    const published = await stat(path);
    expect(published.mode % 0o1_0000).toBe(original.mode % 0o1_0000);
    expect(published.uid).toBe(original.uid);
    expect(published.gid).toBe(original.gid);
  });
});
