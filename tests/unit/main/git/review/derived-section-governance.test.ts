import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { execGit } from "@main/services/git/exec.ts";
import { workingSectionBacking } from "@main/services/git-review/document/working-section.ts";
import type { GitReviewIndexGroupFact } from "@main/services/git-review/index/contract.ts";
import type { GitReviewFileStatus } from "@shared/contracts/git/review.ts";
import { afterEach, describe, expect, it } from "vitest";
import { TestGitReviewService as GitReviewService } from "./test-fixtures.ts";

const GIT_REVIEW_MAIN_DIR = join(process.cwd(), "src/main/services/git-review");
const DOCUMENT_DIR = join(GIT_REVIEW_MAIN_DIR, "document");
const SOURCE_FILE_RE = /\.ts$/;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pier-review-derived-"));
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

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return await collectSourceFiles(path);
      }
      return SOURCE_FILE_RE.test(entry.name) ? [path] : [];
    })
  );
  return files.flat();
}

function fact(status: GitReviewFileStatus): GitReviewIndexGroupFact {
  return {
    conflict: null,
    movement: null,
    oldPath: null,
    origin: "tracked",
    sourceOid: null,
    statsExpected: true,
    status,
    targetOid: null,
    targetPath: "file.ts",
  };
}

function backingFor(groupFacts: {
  readonly staged?: GitReviewIndexGroupFact;
  readonly unstaged?: GitReviewIndexGroupFact;
}): "absent" | "present" {
  return workingSectionBacking({
    entry: { status: "modified" },
    resolvedEntry: { groupFacts },
    source: {
      contextId: "worktree:governance",
      gitRootPath: "/repo",
      oldPaths: [],
      path: "file.ts",
      target: { kind: "uncommitted" },
    },
  }).worktreeSide;
}

describe("派生组合阅读面（working）治理", () => {
  // 暂存改名（a → b）后磁盘删掉 b：HEAD 与工作区都没有 b，派生面给不出与事实
  // 匹配的单一记录。它必须缺席，而不是把整份文档降级成失败。“文件不存在”
  //（工作区侧缺失）同样不能当作陈旧事实。
  it("暂存改名后删除改名目标的文件仍返回文档，且不产出 Head 段", async () => {
    const root = await createRepository();
    await writeFile(join(root, "a.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await execGit(["mv", "a.ts", "b.ts"], { cwd: root });
    await rm(join(root, "b.ts"));

    const result = await new GitReviewService().getFileDocument({
      operationId: randomUUID(),
      source: {
        contextId: "worktree:governance",
        gitRootPath: root,
        oldPaths: ["a.ts"],
        path: "b.ts",
        target: { kind: "uncommitted" },
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.surfaceSections.head).toBeNull();
    expect(result.surfaceSections.index).not.toBeNull();
    expect(result.surfaceSections.staged).not.toBeNull();
  });

  it.each([
    [
      "工作区文件已删除",
      { staged: fact("added"), unstaged: fact("deleted") },
      "absent",
    ],
    [
      "工作区文件仍在",
      { staged: fact("added"), unstaged: fact("modified") },
      "present",
    ],
    ["仅暂存删除", { staged: fact("deleted") }, "absent"],
    ["仅暂存新增", { staged: fact("added") }, "present"],
    ["仅暂存改写", { staged: fact("modified") }, "present"],
  ] as const)("工作区侧判定：%s → %s", (_name, groupFacts, expected) => {
    expect(backingFor(groupFacts)).toBe(expected);
  });

  it("派生规则单点：working 事实只在 working-section.ts，空输出分类只在选择器", async () => {
    const files = await collectSourceFiles(GIT_REVIEW_MAIN_DIR);
    const sources = await Promise.all(
      files.map(async (file) => ({
        file: relative(process.cwd(), file),
        source: await readFile(file, "utf8"),
      }))
    );
    expect(sources.length).toBeGreaterThan(0);

    const sitesOf = (needle: string): string[] =>
      sources
        .filter(({ source }) => source.includes(needle))
        .map(({ file }) => file);

    expect(sitesOf("function createWorkingFact")).toEqual([
      relative(process.cwd(), join(DOCUMENT_DIR, "working-section.ts")),
    ]);
    expect(sitesOf("无 diff 输出")).toEqual([
      relative(process.cwd(), join(DOCUMENT_DIR, "envelope-selector.ts")),
    ]);
  });
});
