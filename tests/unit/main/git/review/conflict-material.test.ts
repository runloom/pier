import { chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execGit, execGitRaw } from "@main/services/git/exec.ts";
import {
  classifyConflictWorktreePresentation,
  hasCompleteMergeConflictMarkers,
} from "@main/services/git-review/document/conflict.ts";
import { GIT_REVIEW_SNAPSHOT_MAX_BYTES } from "@main/services/git-review/path/guard.ts";
import { afterEach, describe, expect, it } from "vitest";
import {
  conflictSection,
  createConflictRepository,
  createDuConflict,
  createUuConflict,
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

describe("classifyConflictWorktreePresentation", () => {
  it("keeps complete marker stacks on UnresolvedFile", () => {
    expect(
      classifyConflictWorktreePresentation(
        ["<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> other"].join(
          "\n"
        )
      )
    ).toBe("markers-text");
  });

  it("does not feed marker-free text to UnresolvedFile", () => {
    expect(classifyConflictWorktreePresentation("resolved\n")).toBe(
      "file-level"
    );
    expect(classifyConflictWorktreePresentation("")).toBe("file-level");
  });

  it("downgrades incomplete marker stacks to file-level", () => {
    expect(
      classifyConflictWorktreePresentation(
        ["<<<<<<< HEAD", "ours", "=======", "theirs"].join("\n")
      )
    ).toBe("file-level");
  });
});

describe("hasCompleteMergeConflictMarkers", () => {
  it("accepts a standard two-way conflict", () => {
    expect(
      hasCompleteMergeConflictMarkers(
        [
          "line",
          "<<<<<<< HEAD",
          "ours",
          "=======",
          "theirs",
          ">>>>>>> other",
          "",
        ].join("\n")
      )
    ).toBe(true);
  });

  it("accepts diff3 base markers", () => {
    expect(
      hasCompleteMergeConflictMarkers(
        [
          "<<<<<<< HEAD",
          "ours",
          "||||||| base",
          "base",
          "=======",
          "theirs",
          ">>>>>>> other",
          "",
        ].join("\n")
      )
    ).toBe(true);
  });

  it("rejects unfinished marker stacks", () => {
    expect(
      hasCompleteMergeConflictMarkers(
        ["<<<<<<< HEAD", "ours", "=======", "theirs"].join("\n")
      )
    ).toBe(false);
  });

  it("rejects text without markers", () => {
    expect(hasCompleteMergeConflictMarkers("just text\n")).toBe(false);
  });

  it("accepts multiple sequential regions", () => {
    const text = [
      "<<<<<<< HEAD",
      "a1",
      "=======",
      "b1",
      ">>>>>>> one",
      "middle",
      "<<<<<<< HEAD",
      "a2",
      "=======",
      "b2",
      ">>>>>>> two",
      "",
    ].join("\n");
    expect(hasCompleteMergeConflictMarkers(text)).toBe(true);
  });

  it("downgrades a completed region followed by an orphan marker", () => {
    const text =
      "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n=======\n";
    expect(classifyConflictWorktreePresentation(text)).toBe("file-level");
  });
});

describe("conflict material with a real unmerged Git index", () => {
  it("materializes Git diff3 markers and downgrades an unfinished stack without losing text", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    await execGit(["checkout", "--conflict=diff3", "--", "conflict.ts"], {
      cwd: root,
    });
    const complete = await conflictSection(root);
    expect(complete.section.xy).toBe("UU");
    expect(complete.section.presentation).toBe("markers-text");
    expect(complete.section.contents).toContain("||||||| base");
    const unfinished = "<<<<<<< HEAD\nours\n=======\ntheirs\n";
    await writeFile(join(root, "conflict.ts"), unfinished);
    const partial = await conflictSection(root);
    expect(partial.section.presentation).toBe("file-level");
    expect(partial.section.contents).toBe(unfinished);
  });

  it.each([
    ["binary", Buffer.from([65, 0, 66])],
    ["invalidEncoding", Buffer.from([0xc3, 0x28])],
  ] as const)("classifies %s without sending unreadable contents", async (presentation, bytes) => {
    const root = await createRepository();
    await createUuConflict(root);
    await writeFile(join(root, "conflict.ts"), bytes);
    const { section } = await conflictSection(root);
    expect(section.presentation).toBe(presentation);
    expect(section.contents).toBeNull();
  });

  it("changes the conflict index revision when only its worktree contents change", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    const { service } = await conflictSection(root);
    const source = {
      contextId: "worktree:test",
      gitRootPath: root,
      target: { kind: "uncommitted" as const },
    };
    const before = await service.getIndex({
      operationId: crypto.randomUUID(),
      source,
    });
    await writeFile(join(root, "conflict.ts"), "external editor result\n");
    const after = await service.getIndex({
      operationId: crypto.randomUUID(),
      source,
    });
    if (before.kind !== "ok" || after.kind !== "ok") {
      throw new Error(JSON.stringify({ before, after }));
    }
    expect(after.entries).toEqual(before.entries);
    expect(after.indexRevision).not.toBe(before.indexRevision);
  });

  it("accepts exactly 8MiB and fingerprints a too-large worktree instead of transmitting its contents", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    await writeFile(
      join(root, "conflict.ts"),
      Buffer.alloc(GIT_REVIEW_SNAPSHOT_MAX_BYTES, 65)
    );
    const atLimit = await conflictSection(root);
    expect(atLimit.section.presentation).toBe("file-level");
    expect(atLimit.section.contents).toBe(
      "A".repeat(GIT_REVIEW_SNAPSHOT_MAX_BYTES)
    );
    await writeFile(
      join(root, "conflict.ts"),
      Buffer.alloc(GIT_REVIEW_SNAPSHOT_MAX_BYTES + 1, 65)
    );
    const overLimit = await conflictSection(root);
    expect(overLimit.section.presentation).toBe("tooLarge");
    expect(overLimit.section.contents).toBeNull();
    const unchanged = await conflictSection(root);
    expect(unchanged.section.contentsDigest).toBe(
      overLimit.section.contentsDigest
    );
    await writeFile(
      join(root, "conflict.ts"),
      Buffer.alloc(GIT_REVIEW_SNAPSHOT_MAX_BYTES + 2, 66)
    );
    const changed = await conflictSection(root);
    expect(changed.section.contentsDigest).not.toBe(
      overLimit.section.contentsDigest
    );
  });

  it("classifies a denied worktree read without failing the whole document", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    const path = join(root, "conflict.ts");
    await chmod(path, 0);
    try {
      const { service, section } = await conflictSection(root);
      expect(section.presentation).toBe("readError");
      expect(section.contents).toBeNull();
      const index = await service.getIndex({
        operationId: crypto.randomUUID(),
        source: {
          contextId: "worktree:test",
          gitRootPath: root,
          target: { kind: "uncommitted" },
        },
      });
      expect(index).toMatchObject({
        entries: [
          {
            path: "conflict.ts",
            renderSlots: [{ group: "conflict", xy: "UU" }],
          },
        ],
        kind: "ok",
      });
    } finally {
      await chmod(path, 0o644);
    }
  });

  it("materializes an absent worktree with a missing side as a file-level stage comparison", async () => {
    const root = await createRepository();
    await createDuConflict(root);
    await rm(join(root, "gone.ts"));
    const { section } = await conflictSection(root, "gone.ts");
    expect(section.xy).toBe("DU");
    expect(section.presentation).toBe("file-level");
    expect(section.contents).toBeNull();
    expect(section.stages.oursOid).toBeNull();
    expect(section.oursContents).toBeNull();
    expect(section.theirsContents).toBe("other\n");
  });

  it("materializes DD with both side OIDs absent as an empty file-level comparison", async () => {
    const root = await createRepository();
    await createDuConflict(root);
    const { section } = await conflictSection(root, "gone.ts");
    await rm(join(root, "gone.ts"));
    await execGitRaw(["update-index", "--index-info"], {
      cwd: root,
      mode: "collect",
      stdin: Buffer.from(
        `0 ${"0".repeat(40)}\tgone.ts\n100644 ${section.stages.baseOid} 1\tgone.ts\n`
      ),
    });
    const missing = await conflictSection(root, "gone.ts");
    expect(missing.section.xy).toBe("DD");
    expect(missing.section.presentation).toBe("file-level");
    expect(missing.section.contents).toBeNull();
    expect(missing.section.oursContents).toBeNull();
    expect(missing.section.theirsContents).toBeNull();
  });
});
