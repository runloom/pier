import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit, execGitRaw } from "@main/services/git/exec.ts";
import { GitReviewBudget } from "@main/services/git-review/budget.ts";
import {
  GitReviewIndexReader,
  type ReadGitReviewIndexOptions,
  type ReadGitReviewIndexRequest,
} from "@main/services/git-review/index/index.ts";
import {
  type GitReviewRequestOptions,
  GitReviewService,
} from "@main/services/git-review/service.ts";
import type {
  GitReviewFileDocumentRequest,
  GitReviewFileDocumentResult,
  GitReviewIndexResult,
  GitReviewScope,
} from "@shared/contracts/git/review.ts";

export const TEST_GIT_REVIEW_OWNER = Object.freeze({
  clientId: "test",
  generation: 0,
  windowRecordId: "test-window",
});

export function gitReviewRequestOptions(
  budget = new GitReviewBudget()
): GitReviewRequestOptions {
  return {
    budget,
    owner: TEST_GIT_REVIEW_OWNER,
    resolveSource: async <T extends GitReviewScope>(source: T) => ({
      kind: "ok" as const,
      value: source,
    }),
  };
}

/** 仅供底层单测显式补齐生产入口负责提供的 owner、预算与授权器。 */
export class TestGitReviewService extends GitReviewService {
  override getIndex(
    input: Parameters<GitReviewService["getIndex"]>[0],
    options?: Partial<GitReviewRequestOptions>
  ): Promise<GitReviewIndexResult> {
    const defaults = gitReviewRequestOptions(options?.budget);
    return super.getIndex(input, { ...defaults, ...options });
  }

  override getFileDocument(
    input: GitReviewFileDocumentRequest,
    options?: Partial<GitReviewRequestOptions>
  ): Promise<GitReviewFileDocumentResult> {
    const defaults = gitReviewRequestOptions(options?.budget);
    return super.getFileDocument(input, { ...defaults, ...options });
  }

  override getExcerptBatch(
    input: Parameters<GitReviewService["getExcerptBatch"]>[0],
    options?: Partial<GitReviewRequestOptions>
  ): ReturnType<GitReviewService["getExcerptBatch"]> {
    const defaults = gitReviewRequestOptions(options?.budget);
    return super.getExcerptBatch(input, { ...defaults, ...options });
  }

  override resolveConflict(
    input: Parameters<GitReviewService["resolveConflict"]>[0],
    options: Parameters<GitReviewService["resolveConflict"]>[1]
  ): ReturnType<GitReviewService["resolveConflict"]> {
    const defaults = gitReviewRequestOptions(options.budget);
    return super.resolveConflict(input, { ...defaults, ...options });
  }
}

/** IndexReader 是 main 内部层；单测在这里显式创建独立请求预算。 */
export class TestGitReviewIndexReader extends GitReviewIndexReader {
  override read(
    request: ReadGitReviewIndexRequest,
    options?: Partial<ReadGitReviewIndexOptions>
  ): Promise<GitReviewIndexResult> {
    const budget = options?.budget ?? new GitReviewBudget();
    return super.read(request, {
      budget,
      signal: options?.signal ?? budget.signal,
    });
  }

  override resolve(
    request: ReadGitReviewIndexRequest,
    options?: Partial<ReadGitReviewIndexOptions>
  ): ReturnType<GitReviewIndexReader["resolve"]> {
    const budget = options?.budget ?? new GitReviewBudget();
    return super.resolve(request, {
      budget,
      signal: options?.signal ?? budget.signal,
    });
  }
}

export async function createConflictRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pier-review-conflict-"));
  await execGit(["init"], { cwd: root });
  await execGit(["config", "user.name", "Pier Test"], { cwd: root });
  await execGit(["config", "user.email", "pier@example.invalid"], {
    cwd: root,
  });
  return root;
}

async function commitConflictFixture(
  root: string,
  message: string
): Promise<void> {
  await execGit(["add", "-A", "--"], { cwd: root });
  await execGit(["commit", "-m", message], { cwd: root });
}

export async function createUuConflict(root: string): Promise<void> {
  await writeFile(join(root, "conflict.ts"), "base\n", "utf8");
  await commitConflictFixture(root, "base");
  const mainBranch = (
    await execGit(["branch", "--show-current"], { cwd: root })
  ).trim();
  await execGit(["switch", "-c", "other"], { cwd: root });
  await writeFile(join(root, "conflict.ts"), "other\n", "utf8");
  await commitConflictFixture(root, "other");
  await execGit(["switch", mainBranch], { cwd: root });
  await writeFile(join(root, "conflict.ts"), "main\n", "utf8");
  await commitConflictFixture(root, "main");
  await execGit(["merge", "other"], { cwd: root }).catch(() => undefined);
}

export async function createDuConflict(root: string): Promise<void> {
  await writeFile(join(root, "gone.ts"), "base\n", "utf8");
  await commitConflictFixture(root, "base");
  const mainBranch = (
    await execGit(["branch", "--show-current"], { cwd: root })
  ).trim();
  await execGit(["switch", "-c", "other"], { cwd: root });
  await writeFile(join(root, "gone.ts"), "other\n", "utf8");
  await commitConflictFixture(root, "other");
  await execGit(["switch", mainBranch], { cwd: root });
  await execGit(["rm", "--", "gone.ts"], { cwd: root });
  await commitConflictFixture(root, "delete on main");
  await execGit(["merge", "other"], { cwd: root }).catch(() => undefined);
}

export async function createGitlinkConflict(root: string): Promise<{
  readonly baseOid: string;
  readonly oursOid: string;
  readonly theirsOid: string;
}> {
  const source = join(root, ".git", "submodule-source");
  await execGit(["init", "--initial-branch=main", source], { cwd: root });
  await execGit(["config", "user.name", "Pier Test"], { cwd: source });
  await execGit(["config", "user.email", "pier@example.invalid"], {
    cwd: source,
  });
  await writeFile(join(source, "child.txt"), "base\n");
  await commitConflictFixture(source, "child base");
  const baseOid = (
    await execGit(["rev-parse", "HEAD"], { cwd: source })
  ).trim();
  await writeFile(join(source, "child.txt"), "ours\n");
  await commitConflictFixture(source, "child ours");
  const oursOid = (
    await execGit(["rev-parse", "HEAD"], { cwd: source })
  ).trim();
  await execGit(["switch", "-c", "incoming", baseOid], { cwd: source });
  await writeFile(join(source, "child.txt"), "theirs\n");
  await commitConflictFixture(source, "child theirs");
  const theirsOid = (
    await execGit(["rev-parse", "HEAD"], { cwd: source })
  ).trim();
  await execGit(["switch", "main"], { cwd: source });
  await execGit(
    ["-c", "protocol.file.allow=always", "submodule", "add", source, "child"],
    { cwd: root }
  );
  await commitConflictFixture(root, "superproject base");
  await execGitRaw(["update-index", "--index-info"], {
    cwd: root,
    mode: "collect",
    stdin: Buffer.from(
      `0 ${"0".repeat(40)}\tchild\n160000 ${baseOid} 1\tchild\n160000 ${oursOid} 2\tchild\n160000 ${theirsOid} 3\tchild\n`
    ),
  });
  return { baseOid, oursOid, theirsOid };
}

export function fileSource(root: string, path = "conflict.ts") {
  return {
    contextId: "worktree:test",
    gitRootPath: root,
    oldPaths: [] as string[],
    path,
    target: { kind: "uncommitted" as const },
  };
}

export async function conflictSection(root: string, path = "conflict.ts") {
  const service = new TestGitReviewService();
  const document = await service.getFileDocument({
    operationId: randomUUID(),
    source: fileSource(root, path),
  });
  if (document.kind !== "ok") {
    throw new Error("expected ok conflict document");
  }
  const section = document.sections.find((item) => item.kind === "conflict");
  if (section?.kind !== "conflict") {
    throw new Error("expected conflict section");
  }
  return { service, section };
}
