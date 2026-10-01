import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit, execGitRaw } from "@main/services/git/exec.ts";
import { afterEach, expect, it } from "vitest";
import { TestGitReviewIndexReader } from "./test-fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

it("reads 5,000 long unmerged paths without oversized argv or reading their worktrees", async () => {
  const root = await mkdtemp(join(tmpdir(), "pier-bounded-numstat-"));
  roots.push(root);
  await execGit(["init"], { cwd: root });
  await execGit(["config", "user.name", "Pier Test"], { cwd: root });
  await execGit(["config", "user.email", "pier@example.invalid"], {
    cwd: root,
  });
  await writeFile(join(root, "ordinary.ts"), "base\n");
  await writeFile(join(root, "old.ts"), "rename\n");
  await execGit(["add", "-A"], { cwd: root });
  await execGit(["commit", "-m", "base"], { cwd: root });
  const oid = (
    await execGit(["rev-parse", "HEAD:ordinary.ts"], { cwd: root })
  ).trim();
  const conflicts = Array.from(
    { length: 5000 },
    (_, index) => `conflict-${index}-${"x".repeat(220)}.ts`
  );
  await execGitRaw(["update-index", "-z", "--index-info"], {
    cwd: root,
    mode: "collect",
    stdin: Buffer.from(
      conflicts
        .flatMap((path) =>
          [1, 2, 3].map((stage) => `100644 ${oid} ${stage}\t${path}\0`)
        )
        .join("")
    ),
  });
  await writeFile(join(root, "ordinary.ts"), "staged\n");
  await rename(join(root, "old.ts"), join(root, ":(glob)renamed.ts"));
  await execGit(
    [
      "--literal-pathspecs",
      "add",
      "-A",
      "--",
      "ordinary.ts",
      "old.ts",
      ":(glob)renamed.ts",
    ],
    { cwd: root }
  );
  await writeFile(join(root, "ordinary.ts"), "staged\nworktree\n");

  const result = await new TestGitReviewIndexReader().read({
    scope: {
      contextId: "worktree:bounded",
      gitRootPath: root,
      target: { kind: "uncommitted" },
    },
  });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(
    result.entries
      .filter((entry) => entry.status === "conflicted")
      .map((entry) => entry.path)
  ).toEqual([...conflicts].sort());
  expect(
    result.entries.find((entry) => entry.path === "ordinary.ts")?.renderSlots
  ).toEqual([
    expect.objectContaining({ group: "unstaged", additions: 1, deletions: 0 }),
    expect.objectContaining({ group: "staged", additions: 1, deletions: 1 }),
  ]);
  expect(
    result.entries.find((entry) => entry.path === ":(glob)renamed.ts")
  ).toMatchObject({
    oldPaths: ["old.ts"],
    renderSlots: [
      expect.objectContaining({
        group: "staged",
        oldPath: "old.ts",
        additions: 0,
        deletions: 0,
      }),
    ],
  });
  expect(result.groupSummaries).toMatchObject({
    conflict: { changedFiles: 5000, excludedFiles: 5000 },
    staged: { changedFiles: 2, insertions: 1, deletions: 1 },
    unstaged: { changedFiles: 1, insertions: 1, deletions: 0 },
  });
});

it("keeps real rename and shared-source copy identities across ordinary batch boundaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "pier-numstat-movements-"));
  roots.push(root);
  await execGit(["init"], { cwd: root });
  await execGit(["config", "user.name", "Pier Test"], { cwd: root });
  await execGit(["config", "user.email", "pier@example.invalid"], {
    cwd: root,
  });
  const movements = Array.from({ length: 140 }, (_, index) => {
    if (index === 0) {
      return { source: "stem.ts", target: "stem.tsx" };
    }
    return {
      source: index < 70 ? `source-${index}.ts` : "shared-source.ts",
      target: `target-${String(index).padStart(3, "0")}${index < 70 ? "" : `-${"x".repeat(220)}`}.ts`,
    };
  });
  const sharedContents = Array.from(
    { length: 30 },
    (_, index) => `shared uniquely named source line ${index}\n`
  ).join("");
  await writeFile(join(root, "shared-source.ts"), sharedContents);
  for (const [index, { source }] of movements.entries()) {
    if (index >= 70) {
      break;
    }
    await writeFile(join(root, source), `unique rename ${index}\n`);
  }
  await execGit(["add", "-A"], { cwd: root });
  await execGit(["commit", "-m", "base"], { cwd: root });
  const oid = (
    await execGit(["rev-parse", "HEAD:shared-source.ts"], { cwd: root })
  ).trim();
  for (const [index, { source, target }] of movements.entries()) {
    if (index < 70) {
      await rename(join(root, source), join(root, target));
    } else {
      await writeFile(join(root, target), sharedContents);
    }
  }
  await writeFile(
    join(root, "shared-source.ts"),
    `${sharedContents}new line\n`
  );
  await execGit(["add", "-A"], { cwd: root });
  await execGitRaw(["update-index", "--index-info"], {
    cwd: root,
    mode: "collect",
    stdin: Buffer.from(
      [1, 2, 3].map((stage) => `100644 ${oid} ${stage}\tconflict.ts\n`).join("")
    ),
  });
  const result = await new TestGitReviewIndexReader().read({
    scope: {
      contextId: "worktree:batches",
      gitRootPath: root,
      target: { kind: "uncommitted" },
    },
  });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  for (const { target, source } of movements) {
    expect(result.entries.find((entry) => entry.path === target)).toMatchObject(
      {
        oldPaths: [source],
        status: "renamed",
        renderSlots: [
          expect.objectContaining({
            group: "staged",
            oldPath: source,
            targetPath: target,
            additions: 0,
            deletions: 0,
          }),
        ],
      }
    );
  }
  expect(
    result.entries.find((entry) => entry.path === "shared-source.ts")
      ?.renderSlots
  ).toEqual([
    expect.objectContaining({ group: "staged", additions: 1, deletions: 0 }),
  ]);
  expect(result.groupSummaries.staged).toMatchObject({
    changedFiles: 141,
    insertions: 1,
    deletions: 0,
  });
});

it("keeps ancestor renames exact without reading conflicted descendants or prefix siblings", async () => {
  const root = await mkdtemp(join(tmpdir(), "pier-numstat-ancestor-"));
  roots.push(root);
  await execGit(["init"], { cwd: root });
  await execGit(["config", "user.name", "Pier Test"], { cwd: root });
  await execGit(["config", "user.email", "pier@example.invalid"], {
    cwd: root,
  });
  const siblings = [
    "ab",
    "界",
    "界外",
    "*literal",
    "[literal]",
    "\\literal",
    ":(glob)literal",
  ];
  await writeFile(join(root, "a"), "body\n");
  for (const path of siblings) {
    await writeFile(join(root, path), `base ${path}\n`);
  }
  await execGit(["add", "-A"], { cwd: root });
  await execGit(["commit", "-m", "base"], { cwd: root });
  const oid = (await execGit(["rev-parse", "HEAD:a"], { cwd: root })).trim();
  await rename(join(root, "a"), join(root, ".git", "rename-source"));
  await mkdir(join(root, "a"));
  await rename(join(root, ".git", "rename-source"), join(root, "a", "b"));
  await execGit(["add", "-A"], { cwd: root });
  await writeFile(join(root, "a", "b"), "body\nmore\n");
  await writeFile(join(root, "a", "c"), "unreadable conflict\n");
  await chmod(join(root, "a", "c"), 0o000);
  await execGitRaw(["update-index", "--index-info"], {
    cwd: root,
    mode: "collect",
    stdin: Buffer.from(
      [1, 2, 3].map((stage) => `100644 ${oid} ${stage}\ta/c\n`).join("")
    ),
  });
  for (const path of siblings) {
    await writeFile(join(root, path), `base ${path}\nchanged\n`);
  }
  const reader = new TestGitReviewIndexReader();
  const scope = {
    contextId: "worktree:ancestor",
    gitRootPath: root,
    target: { kind: "uncommitted" as const },
  };
  const full = await reader.read({ scope });
  expect(full.kind).toBe("ok");
  if (full.kind !== "ok") return;
  expect(full.entries.find((entry) => entry.path === "a/b")).toMatchObject({
    oldPaths: ["a"],
    renderSlots: [
      expect.objectContaining({
        group: "unstaged",
        additions: 1,
        deletions: 0,
      }),
      expect.objectContaining({
        group: "staged",
        oldPath: "a",
        additions: 0,
        deletions: 0,
      }),
    ],
  });
  const scoped = await reader.read({ paths: ["a", "a/b"], scope });
  expect(scoped.kind).toBe("ok");
  if (scoped.kind !== "ok") return;
  expect(scoped.entries.map((entry) => entry.path)).toEqual(["a/b"]);
  expect(scoped.entries[0]?.renderSlots).toEqual(
    full.entries.find((entry) => entry.path === "a/b")?.renderSlots
  );
  for (const path of siblings) {
    const selected = await reader.read({ paths: [path], scope });
    expect(selected.kind).toBe("ok");
    if (selected.kind !== "ok") return;
    expect(selected.entries.map((entry) => entry.path)).toEqual([path]);
    expect(selected.entries[0]?.renderSlots).toEqual([
      expect.objectContaining({
        group: "unstaged",
        additions: 1,
        deletions: 0,
      }),
    ]);
  }
});
