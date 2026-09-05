import { mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGitService } from "@main/services/git/service.ts";
import { describe, expect, it } from "vitest";
import {
  commitFile,
  git,
  makeBaselineRepo,
} from "../../../../support/git-file-baseline.ts";

describe("Git HEAD file baseline in real repositories", () => {
  it("keeps a copied file new when status reports a copy source", async () => {
    const root = await makeBaselineRepo();
    await commitFile(root);
    await writeFile(join(root, "copy.txt"), "at HEAD\n");
    await writeFile(join(root, "file.txt"), "replacement\n");
    await git(root, "add", "file.txt", "copy.txt");
    const service = createGitService();
    expect(
      (await service.getStatus(root)).files.find(
        (file) => file.path === "copy.txt"
      )
    ).toMatchObject({ index: "C", origPath: "file.txt" });
    expect(
      await service.getFileBaseline({ root, path: "copy.txt" })
    ).toMatchObject({
      status: "ready",
      basePath: "copy.txt",
      contents: "",
      existsAtHead: false,
    });
  });
  it("keeps the HEAD side independent of disk edits and staged content", async () => {
    const root = await makeBaselineRepo();
    const headOid = await commitFile(root);
    const service = createGitService();
    await writeFile(join(root, "file.txt"), "in index\n");
    await git(root, "add", "file.txt");
    await writeFile(join(root, "file.txt"), "on disk\n");

    expect(await service.getFileBaseline({ root, path: "file.txt" })).toEqual({
      status: "ready",
      gitRoot: root,
      path: "file.txt",
      basePath: "file.txt",
      headOid,
      contents: "at HEAD\n",
      existsAtHead: true,
    });
    await git(root, "add", "file.txt");
    expect(
      await service.getFileBaseline({ root, path: "file.txt" })
    ).toMatchObject({
      headOid,
      contents: "at HEAD\n",
      existsAtHead: true,
    });
  });

  it("returns an empty baseline only for proven new paths and an unborn branch", async () => {
    const root = await makeBaselineRepo();
    const service = createGitService();
    await writeFile(join(root, "new.txt"), "new\n");
    expect(await service.getFileBaseline({ root, path: "new.txt" })).toEqual({
      status: "ready",
      gitRoot: root,
      path: "new.txt",
      basePath: "new.txt",
      headOid: null,
      contents: "",
      existsAtHead: false,
    });
    const headOid = await commitFile(root);
    await git(root, "add", "new.txt");
    expect(
      await service.getFileBaseline({ root, path: "new.txt" })
    ).toMatchObject({
      status: "ready",
      headOid,
      contents: "",
      existsAtHead: false,
    });
  });

  it("uses the original path supplied by status for a staged rename", async () => {
    const root = await makeBaselineRepo();
    const headOid = await commitFile(root, "old name.txt");
    await git(root, "mv", "old name.txt", "new name.txt");
    await writeFile(join(root, "new name.txt"), "edited after rename\n");
    expect(
      await createGitService().getFileBaseline({ root, path: "new name.txt" })
    ).toEqual({
      status: "ready",
      gitRoot: root,
      path: "new name.txt",
      basePath: "old name.txt",
      headOid,
      contents: "at HEAD\n",
      existsAtHead: true,
    });
  });

  it("does not infer an unstaged rename when status has no original path", async () => {
    const root = await makeBaselineRepo();
    await commitFile(root);
    await rename(join(root, "file.txt"), join(root, "moved.txt"));
    expect(
      await createGitService().getFileBaseline({ root, path: "moved.txt" })
    ).toMatchObject({
      status: "ready",
      basePath: "moved.txt",
      contents: "",
      existsAtHead: false,
    });
  });

  it("reads HEAD for unstaged and staged deletions", async () => {
    const root = await makeBaselineRepo();
    await commitFile(root);
    const service = createGitService();
    await rm(join(root, "file.txt"));
    expect(
      await service.getFileBaseline({ root, path: "file.txt" })
    ).toMatchObject({
      status: "ready",
      contents: "at HEAD\n",
      existsAtHead: true,
    });
    await git(root, "add", "-u");
    expect(
      await service.getFileBaseline({ root, path: "file.txt" })
    ).toMatchObject({
      status: "ready",
      contents: "at HEAD\n",
      existsAtHead: true,
    });
  });

  it("normalizes paths from a subdirectory, preserving literal Unicode and pathspec characters", async () => {
    const root = await makeBaselineRepo();
    await mkdir(join(root, "nested"));
    const path = "nested/文 [*]\n.txt";
    await commitFile(root, path, "\uFEFF你好\r\nnext\rlast\n");
    const service = createGitService();
    const result = await service.getFileBaseline({
      root: join(root, "nested"),
      path: "./文 [*]\n.txt",
    });
    expect(result).toMatchObject({
      status: "ready",
      gitRoot: root,
      path,
      basePath: path,
      contents: "你好\nnext\nlast\n",
      existsAtHead: true,
    });
    expect(
      await service.getFileBaseline({ root, path: join(root, path) })
    ).toEqual(result);
  });

  it("resolves a linked worktree and a symlink alias of the supplied root", async () => {
    const root = await makeBaselineRepo();
    const headOid = await commitFile(root);
    const worktree = join(root, "linked");
    await git(root, "worktree", "add", "--detach", worktree, "HEAD");
    const alias = join(root, "alias");
    await symlink(worktree, alias, "dir");
    expect(
      await createGitService().getFileBaseline({
        root: alias,
        path: "file.txt",
      })
    ).toEqual({
      status: "ready",
      gitRoot: worktree,
      path: "file.txt",
      basePath: "file.txt",
      headOid,
      contents: "at HEAD\n",
      existsAtHead: true,
    });
  });
});
