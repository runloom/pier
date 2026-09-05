import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGitService } from "@main/services/git/service.ts";
import { describe, expect, it } from "vitest";
import {
  commitFile,
  git,
  makeBaselineRepo,
} from "../../../../support/git-file-baseline.ts";

describe("Git baseline pathname and owning repository", () => {
  it.runIf(process.platform === "darwin")(
    "uses Git's composed spelling for a decomposed filename, including renames",
    async () => {
      const root = await makeBaselineRepo();
      await git(root, "config", "core.precomposeunicode", "true");
      await commitFile(root, "café.txt", "committed accent\n");
      const service = createGitService();
      const composed = await service.getFileBaseline({
        root,
        path: "café.txt",
      });
      expect(
        await service.getFileBaseline({
          root,
          path: "café.txt".normalize("NFD"),
        })
      ).toEqual(composed);
      await git(root, "mv", "café.txt", "résumé.txt");
      expect(
        await service.getFileBaseline({
          root,
          path: "résumé.txt".normalize("NFD"),
        })
      ).toMatchObject({
        status: "ready",
        path: "résumé.txt",
        basePath: "café.txt",
        contents: "committed accent\n",
        existsAtHead: true,
      });
    }
  );

  it("respects core.ignorecase when matching Git's pathname", async () => {
    const root = await makeBaselineRepo();
    await commitFile(root, "Mixed.txt");
    await git(root, "config", "core.ignorecase", "true");
    expect(
      await createGitService().getFileBaseline({ root, path: "mixed.txt" })
    ).toMatchObject({
      status: "ready",
      path: "Mixed.txt",
      basePath: "Mixed.txt",
      contents: "at HEAD\n",
      existsAtHead: true,
    });
    await git(root, "config", "core.ignorecase", "false");
    expect(
      await createGitService().getFileBaseline({ root, path: "mixed.txt" })
    ).toMatchObject({ status: "ready", existsAtHead: false });
  });

  it("uses the index spelling for a case-only rename and HEAD for a staged deletion", async () => {
    const root = await makeBaselineRepo();
    await commitFile(root, "Mixed.txt");
    await git(root, "config", "core.ignorecase", "true");
    await git(root, "mv", "Mixed.txt", "temporary.txt");
    await git(root, "mv", "temporary.txt", "mixed.txt");
    const service = createGitService();
    expect(
      await service.getFileBaseline({ root, path: "MIXED.txt" })
    ).toMatchObject({
      status: "ready",
      path: "mixed.txt",
      basePath: "Mixed.txt",
      contents: "at HEAD\n",
      existsAtHead: true,
    });
    await git(root, "rm", "-f", "mixed.txt");
    expect(
      await service.getFileBaseline({ root, path: "mixed.txt" })
    ).toMatchObject({
      status: "ready",
      path: "Mixed.txt",
      contents: "at HEAD\n",
      existsAtHead: true,
    });
  });

  it("reads the submodule's own HEAD when opened through an enclosing root", async () => {
    const root = await makeBaselineRepo();
    const childSource = await makeBaselineRepo();
    const headOid = await commitFile(childSource);
    await git(
      root,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      childSource,
      "child"
    );
    await git(root, "commit", "-m", "submodule fixture");
    await writeFile(join(root, "child/file.txt"), "current child\n");
    expect(
      await createGitService().getFileBaseline({ root, path: "child/file.txt" })
    ).toMatchObject({
      status: "ready",
      gitRoot: join(root, "child"),
      path: "file.txt",
      headOid,
      contents: "at HEAD\n",
      existsAtHead: true,
    });
    await rm(join(root, "child/file.txt"));
    expect(
      await createGitService().getFileBaseline({ root, path: "child/file.txt" })
    ).toMatchObject({
      status: "ready",
      contents: "at HEAD\n",
      existsAtHead: true,
    });
  });

  it("does not invent an empty baseline below an uninitialized gitlink", async () => {
    const root = await makeBaselineRepo();
    const oid = await commitFile(root);
    await git(
      root,
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${oid},child`
    );
    await git(root, "commit", "-m", "gitlink fixture");
    await mkdir(join(root, "child"));
    expect(
      await createGitService().getFileBaseline({ root, path: "child/file.txt" })
    ).toEqual({ status: "unavailable", reason: "unsupported-file" });
  });

  it("ignores non-UTF-8 bytes in unrelated changed and renamed index paths", async () => {
    const root = await makeBaselineRepo();
    await commitFile(root);
    const oid = (await git(root, "rev-parse", "HEAD:file.txt")).trim();
    const input = Buffer.concat([
      Buffer.from(`100644 ${oid}\t`),
      Buffer.from([0xff]),
      Buffer.from(".txt\0"),
    ]);
    execFileSync("git", ["update-index", "-z", "--index-info"], {
      cwd: root,
      input,
    });
    expect(
      await createGitService().getFileBaseline({ root, path: "file.txt" })
    ).toMatchObject({
      status: "ready",
      contents: "at HEAD\n",
      existsAtHead: true,
    });
    await git(root, "commit", "-m", "non-UTF-8 path fixture");
    await git(root, "mv", "file.txt", "renamed.txt");
    expect(
      await createGitService().getFileBaseline({ root, path: "renamed.txt" })
    ).toMatchObject({
      status: "ready",
      basePath: "file.txt",
      contents: "at HEAD\n",
    });
  });
});
