import { createGitService } from "@main/services/git/service.ts";
import { describe, expect, it } from "vitest";
import {
  commitFile,
  git,
  makeBaselineRepo,
} from "../../../../support/git-file-baseline.ts";

describe("Git baseline immutable objects with replacement refs", () => {
  // Real repository setup and repeated cold reads spawn many Git processes;
  // this verifies immutable identity, not a wall-clock performance threshold.
  it.each([
    ["commit", ""],
    ["tree", "^{tree}"],
    ["blob", ":file.txt"],
  ])(
    "keeps cold and warm reads identical while a %s replacement changes",
    async (_kind, suffix) => {
      const root = await makeBaselineRepo();
      const headOid = await commitFile(root);
      const firstCommit = await commitFile(root, "file.txt", "replacement A\n");
      const nextCommit = await commitFile(root, "file.txt", "replacement B\n");
      await git(root, "switch", "--detach", headOid);
      const target = (
        await git(root, "rev-parse", `${headOid}${suffix}`)
      ).trim();
      const firstReplacement = (
        await git(root, "rev-parse", `${firstCommit}${suffix}`)
      ).trim();
      const nextReplacement = (
        await git(root, "rev-parse", `${nextCommit}${suffix}`)
      ).trim();
      const input = { root, path: "file.txt" };
      const expected = {
        status: "ready",
        gitRoot: root,
        path: "file.txt",
        basePath: "file.txt",
        headOid,
        contents: "at HEAD\n",
        existsAtHead: true,
      };
      const warm = createGitService();
      expect(await warm.getFileBaseline(input)).toEqual(expected);

      await git(root, "replace", target, firstReplacement);
      expect(await git(root, "show", "HEAD:file.txt")).toBe("replacement A\n");
      const replaced = createGitService();
      expect(await warm.getFileBaseline(input)).toEqual(expected);
      expect(await replaced.getFileBaseline(input)).toEqual(expected);

      await git(root, "replace", "-f", target, nextReplacement);
      expect(await git(root, "show", "HEAD:file.txt")).toBe("replacement B\n");
      expect(await warm.getFileBaseline(input)).toEqual(expected);
      expect(await replaced.getFileBaseline(input)).toEqual(expected);
      expect(await createGitService().getFileBaseline(input)).toEqual(expected);

      await git(root, "replace", "-d", target);
      expect(await replaced.getFileBaseline(input)).toEqual(expected);
      expect(await createGitService().getFileBaseline(input)).toEqual(expected);
    },
    30_000
  );

  it("resolves rename metadata against the original HEAD tree", async () => {
    const root = await makeBaselineRepo();
    const headOid = await commitFile(root, "old.txt");
    await git(root, "mv", "old.txt", "new.txt");
    await git(root, "commit", "-m", "renamed replacement fixture");
    const replacement = (await git(root, "rev-parse", "HEAD")).trim();
    await git(root, "switch", "--detach", headOid);
    await git(root, "mv", "old.txt", "new.txt");
    const input = { root, path: "new.txt" };
    const expected = {
      status: "ready",
      gitRoot: root,
      path: "new.txt",
      basePath: "old.txt",
      headOid,
      contents: "at HEAD\n",
      existsAtHead: true,
    };
    const warm = createGitService();
    expect(await warm.getFileBaseline(input)).toEqual(expected);
    await git(root, "replace", headOid, replacement);
    expect(await git(root, "status", "--porcelain")).toBe("");
    expect(await warm.getFileBaseline(input)).toEqual(expected);
    expect(await createGitService().getFileBaseline(input)).toEqual(expected);
  });
});
