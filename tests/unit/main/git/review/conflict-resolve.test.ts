import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execGit } from "@main/services/git/exec.ts";
import { createGitService } from "@main/services/git/service.ts";
import { afterEach, describe, expect, it } from "vitest";
import {
  conflictSection,
  createConflictRepository,
  createDuConflict,
  createUuConflict,
  fileSource,
  TestGitReviewService as GitReviewService,
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

describe("git.resolveReviewConflict", () => {
  it("writes resolved markers-text contents and stages the path", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    const { service, section } = await conflictSection(root);
    expect(section.presentation).toBe("markers-text");
    expect(section.contents).not.toBeNull();

    const resolvedBody = "resolved\n";
    const result = await service.resolveConflict(
      {
        action: "write",
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        resolvedContents: resolvedBody,
        source: fileSource(root),
      },
      {
        ...gitReviewRequestOptions(),
        writer: createGitService(),
      }
    );

    expect(result.kind).toBe("ok");
    expect(await readFile(join(root, "conflict.ts"), "utf8")).toBe(
      resolvedBody
    );
    expect(await execGit(["show", ":conflict.ts"], { cwd: root })).toBe(
      resolvedBody
    );
    const status = await execGit(
      ["status", "--porcelain=v1", "--", "conflict.ts"],
      { cwd: root }
    );
    expect(status).not.toMatch(/^UU /mu);

    const after = await service.getFileDocument({
      operationId: randomUUID(),
      source: fileSource(root),
    });
    expect(after.kind).toBe("ok");
    if (after.kind !== "ok") {
      throw new Error("expected ok document");
    }
    expect(after.sections.some((section) => section.kind === "conflict")).toBe(
      false
    );
  });

  it("classifies accepted UU worktree as file-level until staged", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    await writeFile(join(root, "conflict.ts"), "resolved\n", "utf8");
    const status = await execGit(
      ["status", "--porcelain=v1", "--", "conflict.ts"],
      { cwd: root }
    );
    expect(status).toMatch(/^UU /mu);

    const { section } = await conflictSection(root);
    expect(section.presentation).toBe("file-level");
    expect(section.contents).toBe("resolved\n");
  });

  it("materializes DU conflict as file-level without failing the document schema", async () => {
    const root = await createRepository();
    await createDuConflict(root);
    const { section } = await conflictSection(root, "gone.ts");
    expect(section.presentation).toBe("file-level");
    expect(section.xy).toBe("DU");
    expect(section.contents).not.toBeNull();
  });

  it("keeps theirs for a UU conflict via checkout", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    const { service, section } = await conflictSection(root);
    const result = await service.resolveConflict(
      {
        action: "theirs",
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        source: fileSource(root),
      },
      {
        ...gitReviewRequestOptions(),
        writer: createGitService(),
      }
    );
    expect(result.kind).toBe("ok");
    const body = await readFile(join(root, "conflict.ts"), "utf8");
    expect(body).toBe("other\n");
    expect(
      await execGit(["ls-files", "-u", "--", "conflict.ts"], { cwd: root })
    ).toBe("");
    expect(await execGit(["show", ":conflict.ts"], { cwd: root })).toBe(
      "other\n"
    );
  });

  it("keeps ours for a UU conflict via checkout", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    const { service, section } = await conflictSection(root);
    const result = await service.resolveConflict(
      {
        action: "ours",
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        source: fileSource(root),
      },
      {
        ...gitReviewRequestOptions(),
        writer: createGitService(),
      }
    );
    expect(result.kind).toBe("ok");
    const body = await readFile(join(root, "conflict.ts"), "utf8");
    expect(body).toBe("main\n");
    expect(
      await execGit(["ls-files", "-u", "--", "conflict.ts"], { cwd: root })
    ).toBe("");
    expect(await execGit(["show", ":conflict.ts"], { cwd: root })).toBe(
      "main\n"
    );
  });

  it("rejects stale expectedContentsDigest on write", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    const { service } = await conflictSection(root);
    const result = await service.resolveConflict(
      {
        action: "write",
        expectedContentsDigest: "sha256:deadbeef",
        operationId: randomUUID(),
        resolvedContents: "stale-write\n",
        source: fileSource(root),
      },
      {
        ...gitReviewRequestOptions(),
        writer: createGitService(),
      }
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toBe("staleRevision");
    }
    const body = await readFile(join(root, "conflict.ts"), "utf8");
    expect(body).toContain("<<<<<<<");
  });

  it("rejects non-uncommitted sources", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    const service = new GitReviewService();
    const result = await service.resolveConflict(
      {
        action: "ours",
        expectedContentsDigest: "sha256:uncommitted",
        operationId: randomUUID(),
        source: {
          ...fileSource(root),
          target: { kind: "branch", ref: "HEAD" },
        },
      },
      {
        ...gitReviewRequestOptions(),
        writer: createGitService(),
      }
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toBe("invalidSource");
    }
  });

  it("restores theirs for a DU conflict", async () => {
    const root = await createRepository();
    await createDuConflict(root);
    const { service, section } = await conflictSection(root, "gone.ts");
    const result = await service.resolveConflict(
      {
        action: "theirs",
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        source: fileSource(root, "gone.ts"),
      },
      {
        ...gitReviewRequestOptions(),
        writer: createGitService(),
      }
    );
    expect(result.kind).toBe("ok");
    expect(await readFile(join(root, "gone.ts"), "utf8")).toBe("other\n");
    expect(
      await execGit(["ls-files", "-u", "--", "gone.ts"], { cwd: root })
    ).toBe("");
    expect(await execGit(["show", ":gone.ts"], { cwd: root })).toBe("other\n");
  });

  it("keeps deletion for a DU conflict", async () => {
    const root = await createRepository();
    await createDuConflict(root);
    const { service, section } = await conflictSection(root, "gone.ts");
    const result = await service.resolveConflict(
      {
        action: "ours",
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        source: fileSource(root, "gone.ts"),
      },
      {
        ...gitReviewRequestOptions(),
        writer: createGitService(),
      }
    );
    expect(result.kind).toBe("ok");
    await expect(readFile(join(root, "gone.ts"), "utf8")).rejects.toThrow();
    const status = await execGit(
      ["status", "--porcelain=v1", "--", "gone.ts"],
      { cwd: root }
    );
    expect(status).not.toMatch(/^(?:DU|UU) /mu);
    expect(
      await execGit(["ls-files", "--stage", "--", "gone.ts"], { cwd: root })
    ).toBe("");
  });

  it("stages an already-resolved UU worktree without rewriting it", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    await writeFile(join(root, "conflict.ts"), "resolved\n", "utf8");
    const { service, section } = await conflictSection(root);
    const result = await service.resolveConflict(
      {
        action: "stage",
        expectedContentsDigest: section.contentsDigest,
        operationId: randomUUID(),
        source: fileSource(root),
      },
      {
        ...gitReviewRequestOptions(),
        writer: createGitService(),
      }
    );
    expect(result.kind).toBe("ok");
    expect(await readFile(join(root, "conflict.ts"), "utf8")).toBe(
      "resolved\n"
    );
    expect(
      await execGit(["ls-files", "-u", "--", "conflict.ts"], { cwd: root })
    ).toBe("");
    expect(await execGit(["show", ":conflict.ts"], { cwd: root })).toBe(
      "resolved\n"
    );
    const status = await execGit(
      ["status", "--porcelain=v1", "--", "conflict.ts"],
      { cwd: root }
    );
    expect(status).not.toMatch(/^UU /mu);
  });
});
