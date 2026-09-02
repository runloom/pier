import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@main/services/git/exec.ts";
import { createGitService } from "@main/services/git/service.ts";
import { afterEach, describe, expect, it } from "vitest";
import {
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
  const root = await mkdtemp(join(tmpdir(), "pier-review-conflict-resolve-"));
  roots.push(root);
  await execGit(["init"], { cwd: root });
  await execGit(["config", "user.name", "Pier Test"], { cwd: root });
  await execGit(["config", "user.email", "pier@example.invalid"], {
    cwd: root,
  });
  return root;
}

async function commitAll(root: string, message: string): Promise<void> {
  await execGit(["add", "-A", "--"], { cwd: root });
  await execGit(["commit", "-m", message], { cwd: root });
}

async function createUuConflict(root: string): Promise<void> {
  await writeFile(join(root, "conflict.ts"), "base\n", "utf8");
  await commitAll(root, "base");
  const mainBranch = (
    await execGit(["branch", "--show-current"], { cwd: root })
  ).trim();
  await execGit(["switch", "-c", "other"], { cwd: root });
  await writeFile(join(root, "conflict.ts"), "other\n", "utf8");
  await commitAll(root, "other");
  await execGit(["switch", mainBranch], { cwd: root });
  await writeFile(join(root, "conflict.ts"), "main\n", "utf8");
  await commitAll(root, "main");
  await execGit(["merge", "other"], { cwd: root }).catch(() => undefined);
}

async function createDuConflict(root: string): Promise<void> {
  await writeFile(join(root, "gone.ts"), "base\n", "utf8");
  await commitAll(root, "base");
  const mainBranch = (
    await execGit(["branch", "--show-current"], { cwd: root })
  ).trim();
  await execGit(["switch", "-c", "other"], { cwd: root });
  await writeFile(join(root, "gone.ts"), "other\n", "utf8");
  await commitAll(root, "other");
  await execGit(["switch", mainBranch], { cwd: root });
  await execGit(["rm", "--", "gone.ts"], { cwd: root });
  await commitAll(root, "delete on main");
  await execGit(["merge", "other"], { cwd: root }).catch(() => undefined);
}

function fileSource(root: string, path = "conflict.ts") {
  return {
    contextId: "worktree:test",
    gitRootPath: root,
    oldPaths: [] as string[],
    path,
    target: { kind: "uncommitted" as const },
  };
}

async function conflictSection(root: string, path = "conflict.ts") {
  const service = new GitReviewService();
  const document = await service.getFileDocument({
    operationId: randomUUID(),
    source: fileSource(root, path),
  });
  expect(document.kind).toBe("ok");
  if (document.kind !== "ok") {
    throw new Error("expected ok document");
  }
  const section = document.sections.find((item) => item.kind === "conflict");
  expect(section?.kind).toBe("conflict");
  if (section?.kind !== "conflict") {
    throw new Error("expected conflict section");
  }
  return { service, section };
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
    const service = new GitReviewService();
    const result = await service.resolveConflict(
      {
        action: "theirs",
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
  });

  it("keeps ours for a UU conflict via checkout", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    const service = new GitReviewService();
    const result = await service.resolveConflict(
      {
        action: "ours",
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
    const service = new GitReviewService();
    const result = await service.resolveConflict(
      {
        action: "theirs",
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
  });

  it("keeps deletion for a DU conflict", async () => {
    const root = await createRepository();
    await createDuConflict(root);
    const service = new GitReviewService();
    const result = await service.resolveConflict(
      {
        action: "ours",
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
  });

  it("stages an already-resolved UU worktree without rewriting it", async () => {
    const root = await createRepository();
    await createUuConflict(root);
    await writeFile(join(root, "conflict.ts"), "resolved\n", "utf8");
    const service = new GitReviewService();
    const result = await service.resolveConflict(
      {
        action: "stage",
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
    const status = await execGit(
      ["status", "--porcelain=v1", "--", "conflict.ts"],
      { cwd: root }
    );
    expect(status).not.toMatch(/^UU /mu);
  });
});
