import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@main/services/git-exec.ts";
import type { GitReviewDocumentReader } from "@main/services/git-review/git-review-document-reader.ts";
import type { GitReviewIndexResolution } from "@main/services/git-review/git-review-index.ts";
import {
  applyGitReviewMutation,
  type GitReviewMutationWriter,
} from "@main/services/git-review/git-review-mutation.ts";
import { GitReviewService } from "@main/services/git-review/git-review-service.ts";
import { createGitService } from "@main/services/git-service.ts";
import type {
  GitReviewFileDocumentOk,
  GitReviewFileSource,
  GitReviewIndexEntry,
  GitReviewMutationRequest,
} from "@shared/contracts/git-review.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gitReviewRequestOptions } from "./git-review-test-fixtures.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pier-review-mutation-"));
  roots.push(root);
  await execGit(["init"], { cwd: root });
  await execGit(["config", "user.name", "Pier Test"], { cwd: root });
  await execGit(["config", "user.email", "pier@example.invalid"], {
    cwd: root,
  });
  return root;
}

function source(root: string, path = "file.txt"): GitReviewFileSource {
  return {
    contextId: "worktree:mutation",
    gitRootPath: root,
    oldPaths: [],
    path,
    target: { kind: "uncommitted" },
  };
}

async function readDocument(
  service: GitReviewService,
  documentSource: GitReviewFileSource
): Promise<GitReviewFileDocumentOk> {
  const result = await service.getFileDocument(
    { operationId: randomUUID(), source: documentSource },
    gitReviewRequestOptions()
  );
  if (result.kind !== "ok") {
    throw new Error(`expected document, received ${result.kind}`);
  }
  return result;
}

async function mutate(
  service: GitReviewService,
  request: GitReviewMutationRequest,
  writer: GitReviewMutationWriter = createGitService()
) {
  return service.applyMutation(request, {
    ...gitReviewRequestOptions(),
    writer,
  });
}

describe("GitReviewService semantic mutation", () => {
  it("在 Head 阅读面把未暂存变更块映射到 Index 并暂存", async () => {
    const root = await createRepository();
    const path = join(root, "file.txt");
    const baseLines = Array.from({ length: 80 }, (_, index) => `line-${index}`);
    await writeFile(path, `${baseLines.join("\n")}\n`, "utf8");
    await execGit(["add", "--", "file.txt"], { cwd: root });
    await execGit(["commit", "-m", "base"], { cwd: root });

    const stagedLines = [...baseLines];
    stagedLines[5] = "staged-change";
    await writeFile(path, `${stagedLines.join("\n")}\n`, "utf8");
    await execGit(["add", "--", "file.txt"], { cwd: root });
    const workingLines = [...stagedLines];
    workingLines[65] = "working-change";
    await writeFile(path, `${workingLines.join("\n")}\n`, "utf8");

    const service = new GitReviewService();
    const documentSource = source(root);
    const before = await readDocument(service, documentSource);
    const head = before.sections.find(
      (section) => section.sectionKey === before.surfaceSections.head
    );
    if (head?.kind !== "patch") {
      throw new Error("missing Head surface patch");
    }
    const working = head.changeBlocks.find(
      (block) => block.stageState === "unstaged"
    );
    if (working === undefined) {
      throw new Error("missing Head unstaged block");
    }
    const staged = head.changeBlocks.find(
      (block) => block.stageState === "staged"
    );
    if (staged === undefined) {
      throw new Error("missing Head staged block");
    }
    const unsafeRevert = await mutate(service, {
      action: "revert",
      expectedRevision: before.revision,
      operationId: randomUUID(),
      source: documentSource,
      target: {
        changeKey: staged.changeKey,
        kind: "change",
        sectionKey: head.sectionKey,
      },
    });
    expect(unsafeRevert).toMatchObject({
      kind: "error",
      reason: "staleRevision",
    });

    const result = await mutate(service, {
      action: "stage",
      expectedRevision: before.revision,
      operationId: randomUUID(),
      source: documentSource,
      target: {
        changeKey: working.changeKey,
        kind: "change",
        sectionKey: head.sectionKey,
      },
    });

    expect(result.kind).toBe("ok");
    expect(await execGit(["diff", "--", "file.txt"], { cwd: root })).toBe("");
    expect(
      await execGit(["diff", "--cached", "--", "file.txt"], { cwd: root })
    ).toContain("working-change");
  });

  it("Head 混合变更块的多个候选通过一次原子补丁完成暂存", async () => {
    const root = await createRepository();
    const path = join(root, "file.txt");
    const baseLines = Array.from({ length: 30 }, (_, index) => `line-${index}`);
    await writeFile(path, `${baseLines.join("\n")}\n`, "utf8");
    await execGit(["add", "--", "file.txt"], { cwd: root });
    await execGit(["commit", "-m", "base"], { cwd: root });

    const stagedLines = [...baseLines];
    stagedLines[10] = "staged-middle";
    await writeFile(path, `${stagedLines.join("\n")}\n`, "utf8");
    await execGit(["add", "--", "file.txt"], { cwd: root });
    const workingLines = [...stagedLines];
    workingLines[9] = "unstaged-before";
    workingLines[11] = "unstaged-after";
    await writeFile(path, `${workingLines.join("\n")}\n`, "utf8");

    const service = new GitReviewService();
    const documentSource = source(root);
    const before = await readDocument(service, documentSource);
    const head = before.sections.find(
      (section) => section.sectionKey === before.surfaceSections.head
    );
    if (head?.kind !== "patch") {
      throw new Error("missing Head surface patch");
    }
    const partial = head.changeBlocks.find(
      (block) => block.stageState === "partial"
    );
    if (partial === undefined) {
      throw new Error("missing partial Head change block");
    }
    const unstagedBlocks = before.sections.flatMap((section) =>
      section.kind === "patch"
        ? section.changeBlocks.filter(
            (block) => block.stageState === "unstaged"
          )
        : []
    );
    expect(unstagedBlocks).toHaveLength(2);

    const baseWriter = createGitService();
    const applyPatch = vi.fn(baseWriter.applyPatch);
    const result = await mutate(
      service,
      {
        action: "stage",
        expectedRevision: before.revision,
        operationId: randomUUID(),
        source: documentSource,
        target: {
          changeKey: partial.changeKey,
          kind: "change",
          sectionKey: head.sectionKey,
        },
      },
      {
        applyPatch,
        discardChanges: baseWriter.discardChanges,
        stage: baseWriter.stage,
        unstage: baseWriter.unstage,
      }
    );

    expect(result.kind).toBe("ok");
    expect(applyPatch).toHaveBeenCalledOnce();
    expect(applyPatch).toHaveBeenCalledWith(
      root,
      expect.objectContaining({
        atomic: true,
        target: "staged",
      })
    );
    expect(await execGit(["diff", "--", "file.txt"], { cwd: root })).toBe("");
  });

  it("在独立 staged/unstaged section 间按 changeKey 暂存与取消暂存", async () => {
    const root = await createRepository();
    const path = join(root, "file.txt");
    const baseLines = Array.from({ length: 80 }, (_, index) => `line-${index}`);
    await writeFile(path, `${baseLines.join("\n")}\n`, "utf8");
    await execGit(["add", "--", "file.txt"], { cwd: root });
    await execGit(["commit", "-m", "base"], { cwd: root });

    const stagedLines = [...baseLines];
    stagedLines[5] = "staged-change";
    await writeFile(path, `${stagedLines.join("\n")}\n`, "utf8");
    await execGit(["add", "--", "file.txt"], { cwd: root });
    const workingLines = [...stagedLines];
    workingLines[65] = "working-change";
    await writeFile(path, `${workingLines.join("\n")}\n`, "utf8");

    const service = new GitReviewService();
    const documentSource = source(root);
    const before = await readDocument(service, documentSource);
    const stagedBefore = before.sections.find(
      (section) =>
        section.kind === "patch" &&
        section.changeBlocks[0]?.stageState === "staged"
    );
    const unstagedBefore = before.sections.find(
      (section) =>
        section.kind === "patch" &&
        section.changeBlocks[0]?.stageState === "unstaged"
    );
    if (stagedBefore?.kind !== "patch" || unstagedBefore?.kind !== "patch") {
      throw new Error("missing separated staged/unstaged sections");
    }
    expect(stagedBefore.patch).toContain("staged-change");
    expect(unstagedBefore.patch).toContain("working-change");
    const unstaged = unstagedBefore.changeBlocks[0];
    if (unstaged === undefined) throw new Error("missing unstaged change");

    const stageRequest: GitReviewMutationRequest = {
      action: "stage",
      expectedRevision: before.revision,
      operationId: randomUUID(),
      source: documentSource,
      target: {
        changeKey: unstaged.changeKey,
        kind: "change",
        sectionKey: unstagedBefore.sectionKey,
      },
    };
    const stagedResult = await mutate(service, stageRequest);
    expect(stagedResult.kind).toBe("ok");
    if (stagedResult.kind !== "ok") {
      return;
    }
    expect(stagedResult).toMatchObject({
      kind: "ok",
      operationId: stageRequest.operationId,
      stateSequence: expect.any(Number),
    });
    const authoritativeIndex = await service.getIndex(
      {
        operationId: randomUUID(),
        source: {
          contextId: documentSource.contextId,
          gitRootPath: documentSource.gitRootPath,
          target: documentSource.target,
        },
      },
      gitReviewRequestOptions()
    );
    expect(authoritativeIndex).toMatchObject({
      kind: "ok",
      stateSequence: stagedResult.stateSequence,
    });
    const stagedDocument = await readDocument(service, documentSource);
    expect(stagedDocument.entryKey).toBe(before.entryKey);
    const stagedAfter = stagedDocument.sections.find(
      (section) =>
        section.kind === "patch" &&
        section.changeBlocks.some((block) => block.stageState === "staged")
    );
    if (stagedAfter?.kind !== "patch") throw new Error("missing staged patch");
    expect(stagedAfter.changeBlocks.map((block) => block.stageState)).toEqual([
      "staged",
      "staged",
    ]);
    expect(await execGit(["diff", "--", "file.txt"], { cwd: root })).toBe("");
    expect(await mutate(service, stageRequest)).toBe(stagedResult);

    const first = stagedAfter.changeBlocks[0];
    if (first === undefined) {
      throw new Error("missing staged change");
    }
    const unstagedResult = await mutate(service, {
      action: "unstage",
      expectedRevision: stagedDocument.revision,
      operationId: randomUUID(),
      source: documentSource,
      target: {
        changeKey: first.changeKey,
        kind: "change",
        sectionKey: stagedAfter.sectionKey,
      },
    });
    expect(unstagedResult.kind).toBe("ok");
    if (unstagedResult.kind !== "ok") {
      return;
    }
    const unstagedDocument = await readDocument(service, documentSource);
    expect(
      unstagedDocument.sections.flatMap((section) =>
        section.kind === "patch"
          ? section.changeBlocks.map((block) => block.stageState)
          : []
      )
    ).toEqual(expect.arrayContaining(["staged", "unstaged"]));
  });

  it("rejects a stale revision before writing", async () => {
    const root = await createRepository();
    await writeFile(join(root, "file.txt"), "base\n", "utf8");
    await execGit(["add", "--", "file.txt"], { cwd: root });
    await execGit(["commit", "-m", "base"], { cwd: root });
    await writeFile(join(root, "file.txt"), "changed\n", "utf8");
    const service = new GitReviewService();
    const documentSource = source(root);
    const document = await readDocument(service, documentSource);
    const section = document.sections[0];
    if (section === undefined) throw new Error("missing section");
    const result = await mutate(service, {
      action: "stage",
      expectedRevision: `sha256:${"0".repeat(64)}`,
      operationId: randomUUID(),
      source: documentSource,
      target: { kind: "file", sectionKey: section.sectionKey },
    });
    expect(result).toMatchObject({ kind: "error", reason: "staleRevision" });
    expect(
      await execGit(["diff", "--cached", "--", "file.txt"], { cwd: root })
    ).toBe("");
    expect(section.kind).toBe("patch");
  });

  it("还原 unstaged section 时保留 index 中已暂存内容", async () => {
    const root = await createRepository();
    const path = join(root, "file.txt");
    await writeFile(path, "base\n", "utf8");
    await execGit(["add", "--", "file.txt"], { cwd: root });
    await execGit(["commit", "-m", "base"], { cwd: root });
    await writeFile(path, "staged\n", "utf8");
    await execGit(["add", "--", "file.txt"], { cwd: root });
    await writeFile(path, "working\n", "utf8");

    const service = new GitReviewService();
    const documentSource = source(root);
    const document = await readDocument(service, documentSource);
    const unstagedSection = document.sections.find(
      (section) =>
        section.kind === "patch" &&
        section.changeBlocks[0]?.stageState === "unstaged"
    );
    if (unstagedSection?.kind !== "patch")
      throw new Error("expected unstaged patch");
    const result = await mutate(service, {
      action: "revert",
      expectedRevision: document.revision,
      operationId: randomUUID(),
      source: documentSource,
      target: {
        changeKey: unstagedSection.changeBlocks[0]?.changeKey ?? "missing",
        kind: "change",
        sectionKey: unstagedSection.sectionKey,
      },
    });
    expect(result.kind).toBe("ok");
    expect(await readFile(path, "utf8")).toBe("staged\n");
    expect(
      await execGit(["diff", "--cached", "--", "file.txt"], { cwd: root })
    ).toContain("+staged");
  });

  it("stages an untracked file before the repository has a HEAD", async () => {
    const root = await createRepository();
    await writeFile(join(root, "new.txt"), "new\n", "utf8");
    const service = new GitReviewService();
    const documentSource = source(root, "new.txt");
    const document = await readDocument(service, documentSource);
    const section = document.sections[0];
    if (section === undefined) throw new Error("missing untracked section");
    const result = await mutate(service, {
      action: "stage",
      expectedRevision: document.revision,
      operationId: randomUUID(),
      source: documentSource,
      target: { kind: "file", sectionKey: section.sectionKey },
    });
    expect(result.kind).toBe("ok");
    expect(
      await execGit(["diff", "--cached", "--name-only"], { cwd: root })
    ).toBe("new.txt\n");
  });

  it("丢弃未跟踪整文件时走废纸篓写入而不是反向补丁", async () => {
    const root = await createRepository();
    const path = join(root, "new.txt");
    await writeFile(path, "new\n", "utf8");
    const service = new GitReviewService();
    const documentSource = source(root, "new.txt");
    const document = await readDocument(service, documentSource);
    const section = document.sections[0];
    if (section === undefined) throw new Error("missing untracked section");

    const trashItem = vi.fn(async () => undefined);
    const baseWriter = createGitService({ trashItem });
    const applyPatch = vi.fn(baseWriter.applyPatch);
    const discardChanges = vi.fn(baseWriter.discardChanges);
    const result = await mutate(
      service,
      {
        action: "revert",
        expectedRevision: document.revision,
        operationId: randomUUID(),
        source: documentSource,
        target: { kind: "file", sectionKey: section.sectionKey },
      },
      {
        applyPatch,
        discardChanges,
        stage: baseWriter.stage,
        unstage: baseWriter.unstage,
      }
    );

    expect(result.kind).toBe("ok");
    expect(discardChanges).toHaveBeenCalledWith(root, {
      paths: ["new.txt"],
    });
    expect(trashItem).toHaveBeenCalledWith(path);
    expect(applyPatch).not.toHaveBeenCalled();
  });

  it.each([
    "stage",
    "unstage",
    "revert",
  ] as const)("仅有状态信息的二进制文件支持整文件 %s", async (action) => {
    const root = await createRepository();
    const path = join(root, "binary.dat");
    const base = Buffer.from([0, 1, 2, 3]);
    const changed = Buffer.from([0, 4, 2, 3]);
    await writeFile(path, base);
    await execGit(["add", "--", "binary.dat"], { cwd: root });
    await execGit(["commit", "-m", "base"], { cwd: root });
    await writeFile(path, changed);
    if (action === "unstage") {
      await execGit(["add", "--", "binary.dat"], { cwd: root });
    }

    const service = new GitReviewService();
    const documentSource = source(root, "binary.dat");
    const document = await readDocument(service, documentSource);
    const sectionKey =
      action === "unstage"
        ? document.surfaceSections.staged
        : document.surfaceSections.index;
    const section = document.sections.find(
      (candidate) => candidate.sectionKey === sectionKey
    );
    expect(section).toMatchObject({ kind: "state", reason: "binary" });
    if (section === undefined) throw new Error("missing binary section");

    const result = await mutate(service, {
      action,
      expectedRevision: document.revision,
      operationId: randomUUID(),
      source: documentSource,
      target: { kind: "file", sectionKey: section.sectionKey },
    });

    expect(result.kind).toBe("ok");
    if (action === "stage") {
      expect(
        await execGit(["diff", "--name-only", "--", "binary.dat"], {
          cwd: root,
        })
      ).toBe("");
      expect(
        await execGit(["diff", "--cached", "--name-only", "--", "binary.dat"], {
          cwd: root,
        })
      ).toBe("binary.dat\n");
    } else if (action === "unstage") {
      expect(
        await execGit(["diff", "--cached", "--name-only", "--", "binary.dat"], {
          cwd: root,
        })
      ).toBe("");
      expect(
        await execGit(["diff", "--name-only", "--", "binary.dat"], {
          cwd: root,
        })
      ).toBe("binary.dat\n");
    } else {
      expect(await readFile(path)).toEqual(base);
    }
  });

  it("整文件写入只使用活动 slot 的路径而不是聚合旧路径", async () => {
    const unstagedSectionKey = "section:unstaged:new.txt";
    const stagedSectionKey = "section:staged:new.txt";
    const indexEntry = {
      entryKey: "entry:rename",
      oldPaths: ["old.txt"],
      path: "new.txt",
      renderSlots: [
        {
          group: "unstaged",
          oldPath: null,
          sectionKey: unstagedSectionKey,
          status: "modified",
          targetPath: "new.txt",
        },
        {
          group: "staged",
          oldPath: "old.txt",
          sectionKey: stagedSectionKey,
          status: "renamed",
          targetPath: "new.txt",
        },
      ],
      status: "renamed",
    } satisfies GitReviewIndexEntry;
    const document = {
      entryKey: indexEntry.entryKey,
      kind: "ok",
      revision: "revision:rename",
      sections: [
        {
          kind: "state",
          oldPath: null,
          reason: "binary",
          sectionKey: unstagedSectionKey,
          status: "modified",
          targetPath: "new.txt",
        },
        {
          kind: "state",
          oldPath: "old.txt",
          reason: "binary",
          sectionKey: stagedSectionKey,
          status: "renamed",
          targetPath: "new.txt",
        },
      ],
      surfaceSections: {
        committed: null,
        head: null,
        index: unstagedSectionKey,
        staged: stagedSectionKey,
      },
    } satisfies GitReviewFileDocumentOk;
    const discardChanges = vi.fn(async () => undefined);
    const requestOptions = gitReviewRequestOptions();
    const indexResolution = {
      kind: "ok",
      metadata: {
        canonicalRoot: "/repo",
        headOid: null,
        indexRevision: "index:rename",
        rangeBounds: null,
      },
      resolvedEntries: [
        {
          groupFacts: {
            staged: {
              movement: "rename",
              oldPath: "old.txt",
              origin: "tracked",
              sourceOid: "a".repeat(40),
              statsExpected: true,
              status: "renamed",
              targetOid: "b".repeat(40),
              targetPath: "new.txt",
            },
            unstaged: {
              movement: null,
              oldPath: null,
              origin: "tracked",
              sourceOid: "b".repeat(40),
              statsExpected: true,
              status: "modified",
              targetOid: null,
              targetPath: "new.txt",
            },
          },
          path: "new.txt",
        },
      ],
      result: {
        entries: [indexEntry],
        groupSummaries: {},
        indexRevision: "index:rename",
        kind: "ok",
        warnings: [],
      },
    } satisfies GitReviewIndexResolution;
    const result = await applyGitReviewMutation({
      budget: requestOptions.budget,
      documentReader: {
        execute: vi.fn(async () => document),
        getEvidence: vi.fn(() => null),
      } as unknown as GitReviewDocumentReader,
      indexReader: {
        read: vi.fn(),
        resolve: vi.fn(async () => indexResolution),
      },
      request: {
        action: "revert",
        expectedRevision: document.revision,
        operationId: randomUUID(),
        source: {
          ...source("/repo", "new.txt"),
          oldPaths: ["old.txt"],
        },
        target: { kind: "file", sectionKey: unstagedSectionKey },
      },
      signal: new AbortController().signal,
      writer: {
        applyPatch: vi.fn(),
        discardChanges,
        stage: vi.fn(),
        unstage: vi.fn(),
      },
    });

    expect(result.kind).toBe("ok");
    expect(discardChanges).toHaveBeenCalledWith("/repo", {
      paths: ["new.txt"],
    });
  });

  it("整文件 copy 操作不写入副本来源路径", async () => {
    const sectionKey = "section:unstaged:copy.txt";
    const indexEntry = {
      entryKey: "entry:copy",
      oldPaths: ["source.txt"],
      path: "copy.txt",
      renderSlots: [
        {
          group: "unstaged",
          oldPath: "source.txt",
          sectionKey,
          status: "added",
          targetPath: "copy.txt",
        },
      ],
      status: "added",
    } satisfies GitReviewIndexEntry;
    const document = {
      entryKey: indexEntry.entryKey,
      kind: "ok",
      revision: "revision:copy",
      sections: [
        {
          changeBlocks: [],
          kind: "patch",
          patch:
            "diff --git a/source.txt b/copy.txt\nsimilarity index 100%\ncopy from source.txt\ncopy to copy.txt\n",
          sectionKey,
        },
      ],
      surfaceSections: {
        committed: null,
        head: null,
        index: sectionKey,
        staged: null,
      },
    } satisfies GitReviewFileDocumentOk;
    const indexResolution = {
      kind: "ok",
      metadata: {
        canonicalRoot: "/repo",
        headOid: null,
        indexRevision: "index:copy",
        rangeBounds: null,
      },
      resolvedEntries: [
        {
          groupFacts: {
            unstaged: {
              movement: "copy",
              oldPath: "source.txt",
              origin: "tracked",
              sourceOid: "a".repeat(40),
              statsExpected: true,
              status: "added",
              targetOid: null,
              targetPath: "copy.txt",
            },
          },
          path: "copy.txt",
        },
      ],
      result: {
        entries: [indexEntry],
        groupSummaries: {},
        indexRevision: "index:copy",
        kind: "ok",
        warnings: [],
      },
    } satisfies GitReviewIndexResolution;
    const discardChanges = vi.fn(async () => undefined);
    const requestOptions = gitReviewRequestOptions();

    const result = await applyGitReviewMutation({
      budget: requestOptions.budget,
      documentReader: {
        execute: vi.fn(async () => document),
        getEvidence: vi.fn(() => null),
      } as unknown as GitReviewDocumentReader,
      indexReader: {
        read: vi.fn(),
        resolve: vi.fn(async () => indexResolution),
      },
      request: {
        action: "revert",
        expectedRevision: document.revision,
        operationId: randomUUID(),
        source: {
          ...source("/repo", "copy.txt"),
          oldPaths: ["source.txt"],
        },
        target: { kind: "file", sectionKey },
      },
      signal: new AbortController().signal,
      writer: {
        applyPatch: vi.fn(),
        discardChanges,
        stage: vi.fn(),
        unstage: vi.fn(),
      },
    });

    expect(result.kind).toBe("ok");
    expect(discardChanges).toHaveBeenCalledWith("/repo", {
      paths: ["copy.txt"],
    });
  });
});
