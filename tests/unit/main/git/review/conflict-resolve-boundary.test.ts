import { randomUUID } from "node:crypto";
import { readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execGit, execGitRaw } from "@main/services/git/exec.ts";
import { createGitService } from "@main/services/git/service.ts";
import { GIT_REVIEW_SNAPSHOT_MAX_BYTES } from "@main/services/git-review/path/guard.ts";
import { afterEach, describe, expect, it } from "vitest";
import {
  conflictSection,
  createConflictRepository,
  createDuConflict,
  createGitlinkConflict,
  createUuConflict,
  fileSource,
  gitReviewRequestOptions,
} from "./test-fixtures.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function createRepository(): Promise<string> {
  const root = await createConflictRepository();
  roots.push(root);
  return root;
}
async function replaceStage(
  root: string,
  stage: 2 | 3,
  contents: string | Buffer,
  mode = "100644"
): Promise<string> {
  const fixturePath = join(root, ".git", "stage-fixture");
  await writeFile(fixturePath, contents, "utf8");
  const oid = (
    await execGit(["hash-object", "-w", fixturePath], { cwd: root })
  ).trim();
  await execGitRaw(["update-index", "--index-info"], {
    cwd: root,
    mode: "collect",
    stdin: Buffer.from(`${mode} ${oid} ${stage}\tconflict.ts\n`),
  });
  return oid;
}

describe("git.resolveReviewConflict stale and marker boundaries", () => {
  it.each([
    "write",
    "ours",
    "theirs",
    "stage",
  ] as const)("rejects externally edited worktrees for %s without writing or staging", async (action) => {
    const root = await createRepository();
    await createUuConflict(root);
    const { service, section } = await conflictSection(root);
    const externalContents = "external editor contents\n";
    await writeFile(join(root, "conflict.ts"), externalContents);
    const beforeIndex = await execGit(["ls-files", "-u", "--", "conflict.ts"], {
      cwd: root,
    });
    const result = await service.resolveConflict(
      {
        action,
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        ...(action === "write"
          ? { resolvedContents: "would overwrite\n" }
          : {}),
        source: fileSource(root),
      },
      { ...gitReviewRequestOptions(), writer: createGitService() }
    );
    expect(result).toMatchObject({ kind: "error", reason: "staleRevision" });
    expect(await readFile(join(root, "conflict.ts"), "utf8")).toBe(
      externalContents
    );
    expect(
      await execGit(["ls-files", "-u", "--", "conflict.ts"], { cwd: root })
    ).toBe(beforeIndex);
  });

  it("rejects changed stage identity even when the worktree contents are unchanged", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    const { service, section } = await conflictSection(root);
    const beforeBody = await readFile(join(root, "conflict.ts"), "utf8");
    await replaceStage(root, 2, "new current-side version\n");
    const beforeIndex = await execGit(["ls-files", "-u", "--", "conflict.ts"], {
      cwd: root,
    });
    const current = await conflictSection(root);
    expect(current.section.contentsDigest).not.toBe(section.contentsDigest);
    const result = await service.resolveConflict(
      {
        action: "ours",
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        source: fileSource(root),
      },
      { ...gitReviewRequestOptions(), writer: createGitService() }
    );
    expect(result).toMatchObject({ kind: "error", reason: "staleRevision" });
    expect(await readFile(join(root, "conflict.ts"), "utf8")).toBe(beforeBody);
    expect(
      await execGit(["ls-files", "-u", "--", "conflict.ts"], { cwd: root })
    ).toBe(beforeIndex);
  });

  it.each([
    ["ours", 2, false],
    ["theirs", 3, false],
    ["write", 1, false],
    ["stage", 3, false],
    ["ours", 2, true],
  ] as const)("rejects %s after mode-only stage %s changes (missing=%s)", async (action, stage, missing) => {
    const root = await createRepository();
    await createUuConflict(root);
    if (missing) {
      await rm(join(root, "conflict.ts"));
    }
    const { service, section } = await conflictSection(root);
    const stageOid = {
      1: section.stages.baseOid,
      2: section.stages.oursOid,
      3: section.stages.theirsOid,
    }[stage];
    if (stageOid === null) {
      throw new Error("expected an existing stage");
    }
    const beforeBody = missing
      ? null
      : await readFile(join(root, "conflict.ts"));
    const beforeMode = missing
      ? null
      : (await stat(join(root, "conflict.ts"))).mode;
    await execGitRaw(["update-index", "--index-info"], {
      cwd: root,
      mode: "collect",
      stdin: Buffer.from(`100755 ${stageOid} ${stage}\tconflict.ts\n`),
    });
    const beforeIndex = await execGit(["ls-files", "-u", "--", "conflict.ts"], {
      cwd: root,
    });
    const current = await conflictSection(root);
    expect(current.section.stages).toEqual(section.stages);
    expect(current.section.contentsDigest).not.toBe(section.contentsDigest);
    const result = await service.resolveConflict(
      {
        action,
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        ...(action === "write"
          ? { resolvedContents: "would overwrite\n" }
          : {}),
        source: fileSource(root),
      },
      { ...gitReviewRequestOptions(), writer: createGitService() }
    );
    expect(result).toMatchObject({ kind: "error", reason: "staleRevision" });
    expect(
      await execGit(["ls-files", "-u", "--", "conflict.ts"], { cwd: root })
    ).toBe(beforeIndex);
    if (missing) {
      await expect(readFile(join(root, "conflict.ts"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } else {
      expect(await readFile(join(root, "conflict.ts"))).toEqual(beforeBody);
      expect((await stat(join(root, "conflict.ts"))).mode).toBe(beforeMode);
    }
  });

  it.each([
    "ours",
    "theirs",
  ] as const)("resolves a real gitlink with %s using the selected child commit, not superproject blob reads", async (action) => {
    const root = await createRepository();
    const { oursOid, theirsOid } = await createGitlinkConflict(root);
    const chosenOid = action === "ours" ? oursOid : theirsOid;
    await expect(
      execGit(["cat-file", "-e", chosenOid], { cwd: root })
    ).rejects.toThrow();
    expect(
      (
        await execGit(["rev-parse", "HEAD"], { cwd: join(root, "child") })
      ).trim()
    ).toBe(oursOid);
    const { service, section } = await conflictSection(root, "child");
    expect(section.presentation).toBe("file-level");
    expect(section.stages.oursOid).toBe(oursOid);
    const result = await service.resolveConflict(
      {
        action,
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        source: fileSource(root, "child"),
      },
      { ...gitReviewRequestOptions(), writer: createGitService() }
    );
    expect(result.kind).toBe("ok");
    expect(
      await execGit(["ls-files", "--stage", "--", "child"], { cwd: root })
    ).toBe(`160000 ${chosenOid} 0\tchild\n`);
    expect(
      (
        await execGit(["rev-parse", "HEAD"], { cwd: join(root, "child") })
      ).trim()
    ).toBe(chosenOid);
    expect(await readFile(join(root, "child", "child.txt"), "utf8")).toBe(
      `${action}\n`
    );
  });

  it("chooses a 65MiB binary incoming version containing marker-like bytes within the normal output budget", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    const bytes = Buffer.alloc(65 * 1024 * 1024);
    bytes.write("<<<<<<< binary prefix\n");
    bytes.write("\n>>>>>>> binary suffix\n", bytes.length - 32);
    const oid = await replaceStage(root, 3, bytes);
    const { service, section } = await conflictSection(root);
    const result = await service.resolveConflict(
      {
        action: "theirs",
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        source: fileSource(root),
      },
      { ...gitReviewRequestOptions(), writer: createGitService() }
    );
    expect(result.kind).toBe("ok");
    expect(
      await execGit(["ls-files", "--stage", "--", "conflict.ts"], { cwd: root })
    ).toBe(`100644 ${oid} 0\tconflict.ts\n`);
    expect((await stat(join(root, "conflict.ts"))).size).toBe(bytes.length);
    expect(
      (await execGit(["hash-object", "conflict.ts"], { cwd: root })).trim()
    ).toBe(oid);
  });

  it("rejects unfinished markers late in a selected text larger than the snapshot cap", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    const text = Buffer.alloc(GIT_REVIEW_SNAPSHOT_MAX_BYTES + 1024, 65);
    text.write("\n<<<<<<< late unfinished conflict\n", text.length - 64);
    await replaceStage(root, 3, text);
    const { service, section } = await conflictSection(root);
    const beforeBody = await readFile(join(root, "conflict.ts"));
    const beforeIndex = await execGit(["ls-files", "-u", "--", "conflict.ts"], {
      cwd: root,
    });
    const result = await service.resolveConflict(
      {
        action: "theirs",
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        source: fileSource(root),
      },
      { ...gitReviewRequestOptions(), writer: createGitService() }
    );
    expect(result).toMatchObject({ kind: "error", reason: "invalidSource" });
    expect(await readFile(join(root, "conflict.ts"))).toEqual(beforeBody);
    expect(
      await execGit(["ls-files", "-u", "--", "conflict.ts"], { cwd: root })
    ).toBe(beforeIndex);
  });

  it("propagates selected-object lookup errors instead of treating them as clean text", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    const oid = await replaceStage(root, 3, "unique incoming object\n");
    const { service, section } = await conflictSection(root);
    const beforeBody = await readFile(join(root, "conflict.ts"));
    const beforeIndex = await execGit(["ls-files", "-u", "--", "conflict.ts"], {
      cwd: root,
    });
    await rm(join(root, ".git", "objects", oid.slice(0, 2), oid.slice(2)));
    const result = await service.resolveConflict(
      {
        action: "theirs",
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        source: fileSource(root),
      },
      { ...gitReviewRequestOptions(), writer: createGitService() }
    );
    expect(result).toMatchObject({ kind: "error", reason: "commandFailed" });
    expect(await readFile(join(root, "conflict.ts"))).toEqual(beforeBody);
    expect(
      await execGit(["ls-files", "-u", "--", "conflict.ts"], { cwd: root })
    ).toBe(beforeIndex);
  });

  it("does not treat a selected symlink target as conflict-marker file contents", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    const target = "<<<<<<< symlink target";
    const oid = await replaceStage(root, 2, target, "120000");
    await rm(join(root, "conflict.ts"));
    await symlink(target, join(root, "conflict.ts"));
    const { service, section } = await conflictSection(root);
    expect(section.presentation).toBe("file-level");
    const result = await service.resolveConflict(
      {
        action: "ours",
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        source: fileSource(root),
      },
      { ...gitReviewRequestOptions(), writer: createGitService() }
    );
    expect(result.kind).toBe("ok");
    expect(
      await execGit(["ls-files", "--stage", "--", "conflict.ts"], { cwd: root })
    ).toBe(`120000 ${oid} 0\tconflict.ts\n`);
  });

  it.each([
    ["write", "<<<<<<< HEAD\nunfinished\n"],
    ["write", "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n"],
    ["stage", "<<<<<<< HEAD\nunfinished\n"],
    ["stage", "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n"],
  ] as const)("rejects remaining markers for %s without writing or staging (%s)", async (action, contents) => {
    const root = await createRepository();
    await createUuConflict(root);
    if (action === "stage") {
      await writeFile(join(root, "conflict.ts"), contents);
    }
    const { service, section } = await conflictSection(root);
    const beforeBody = await readFile(join(root, "conflict.ts"), "utf8");
    const beforeIndex = await execGit(["ls-files", "-u", "--", "conflict.ts"], {
      cwd: root,
    });
    const result = await service.resolveConflict(
      {
        action,
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        ...(action === "write" ? { resolvedContents: contents } : {}),
        source: fileSource(root),
      },
      { ...gitReviewRequestOptions(), writer: createGitService() }
    );
    expect(result).toMatchObject({ kind: "error", reason: "invalidSource" });
    expect(await readFile(join(root, "conflict.ts"), "utf8")).toBe(beforeBody);
    expect(
      await execGit(["ls-files", "-u", "--", "conflict.ts"], { cwd: root })
    ).toBe(beforeIndex);
  });

  it.each([
    ["ours", 2, "<<<<<<<", "100644"],
    ["theirs", 3, "|||||||", "100644"],
    ["ours", 2, "=======", "100755"],
    ["theirs", 3, ">>>>>>>", "100755"],
  ] as const)("does not checkout or stage %s when stage %s contains %s markers (mode %s)", async (action, stage, marker, mode) => {
    const root = await createRepository();
    await createUuConflict(root);
    await replaceStage(
      root,
      stage,
      `${marker} committed unfinished conflict\n`,
      mode
    );
    const { service, section } = await conflictSection(root);
    const beforeBody = await readFile(join(root, "conflict.ts"), "utf8");
    const beforeIndex = await execGit(["ls-files", "-u", "--", "conflict.ts"], {
      cwd: root,
    });
    const result = await service.resolveConflict(
      {
        action,
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        source: fileSource(root),
      },
      { ...gitReviewRequestOptions(), writer: createGitService() }
    );
    expect(result).toMatchObject({ kind: "error", reason: "invalidSource" });
    expect(await readFile(join(root, "conflict.ts"), "utf8")).toBe(beforeBody);
    expect(
      await execGit(["ls-files", "-u", "--", "conflict.ts"], { cwd: root })
    ).toBe(beforeIndex);
  });

  it.each([
    "ours",
    "theirs",
  ] as const)("resolves an incoming-side deletion with %s using actual missing-stage identity", async (action) => {
    const root = await createRepository();
    await createDuConflict(root);
    const initial = await conflictSection(root, "gone.ts");
    const baseOid = initial.section.stages.baseOid;
    const oursOid = initial.section.stages.theirsOid;
    if (baseOid === null || oursOid === null) {
      throw new Error("expected base and surviving side in DU fixture");
    }
    await execGitRaw(["update-index", "--index-info"], {
      cwd: root,
      mode: "collect",
      stdin: Buffer.from(
        `0 ${"0".repeat(40)}\tgone.ts\n100644 ${baseOid} 1\tgone.ts\n100644 ${oursOid} 2\tgone.ts\n`
      ),
    });
    const { service, section } = await conflictSection(root, "gone.ts");
    expect(section.xy).toBe("UD");
    expect(section.stages.theirsOid).toBeNull();
    const result = await service.resolveConflict(
      {
        action,
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        source: fileSource(root, "gone.ts"),
      },
      { ...gitReviewRequestOptions(), writer: createGitService() }
    );
    expect(result.kind).toBe("ok");
    expect(
      await execGit(["ls-files", "-u", "--", "gone.ts"], { cwd: root })
    ).toBe("");
    if (action === "ours") {
      expect(await readFile(join(root, "gone.ts"), "utf8")).toBe("other\n");
      expect(await execGit(["show", ":gone.ts"], { cwd: root })).toBe(
        "other\n"
      );
    } else {
      await expect(readFile(join(root, "gone.ts"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(
        await execGit(["ls-files", "--stage", "--", "gone.ts"], { cwd: root })
      ).toBe("");
    }
  });

  it("rejects resolved UTF-8 contents over 8MiB even when the character count is smaller", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    const { service, section } = await conflictSection(root);
    const beforeBody = await readFile(join(root, "conflict.ts"), "utf8");
    const beforeIndex = await execGit(["ls-files", "-u", "--", "conflict.ts"], {
      cwd: root,
    });
    const result = await service.resolveConflict(
      {
        action: "write",
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        resolvedContents: "界".repeat(
          Math.floor(GIT_REVIEW_SNAPSHOT_MAX_BYTES / 3) + 1
        ),
        source: fileSource(root),
      },
      { ...gitReviewRequestOptions(), writer: createGitService() }
    );
    expect(result).toMatchObject({ kind: "error", reason: "invalidSource" });
    expect(await readFile(join(root, "conflict.ts"), "utf8")).toBe(beforeBody);
    expect(
      await execGit(["ls-files", "-u", "--", "conflict.ts"], { cwd: root })
    ).toBe(beforeIndex);
  });
});
