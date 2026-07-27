import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execGit } from "../../../src/main/services/git-exec.ts";
import { createGitService } from "../../../src/main/services/git-service.ts";
import {
  extractChangeBlockPatch,
  extractHunkPatch,
} from "../../../src/shared/git-patch-hunk.ts";

async function initRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pier-apply-patch-"));
  await execGit(["init"], { cwd: root });
  await execGit(["config", "user.email", "test@example.com"], { cwd: root });
  await execGit(["config", "user.name", "Test"], { cwd: root });
  await writeFile(
    join(root, "file.txt"),
    `${["line1", "line2", "line3", ...Array.from({ length: 40 }, () => "pad")].join("\n")}\n`,
    "utf8"
  );
  await execGit(["add", "file.txt"], { cwd: root });
  await execGit(["commit", "-m", "init"], { cwd: root });
  return root;
}

describe("git.applyPatch (Codex-style)", () => {
  const temps: string[] = [];
  afterEach(async () => {
    await Promise.all(
      temps.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
    );
  });

  it("stages one hunk then unstages it via apply --cached", async () => {
    const root = await initRepo();
    temps.push(root);
    await writeFile(
      join(root, "file.txt"),
      `${[
        "LINE1",
        "line2",
        "line3",
        ...Array.from({ length: 40 }, () => "pad"),
        "TAIL",
      ].join("\n")}\n`,
      "utf8"
    );
    const patch = await execGit(["diff", "--", "file.txt"], { cwd: root });
    expect(patch).toContain("@@");
    // Prefer first hunk only when multi-hunk; sample may be one hunk.
    const hunk0 = extractHunkPatch(patch, [0]);

    const git = createGitService();
    const staged = await git.applyPatch(root, {
      atomic: true,
      diff: hunk0,
      revert: false,
      target: "staged",
    });
    expect(staged.status).toBe("success");

    const stagedNames = (
      await execGit(["diff", "--cached", "--name-only"], { cwd: root })
    ).trim();
    expect(stagedNames).toBe("file.txt");

    const stagedPatch = await execGit(["diff", "--cached", "--", "file.txt"], {
      cwd: root,
    });
    const unstaged = await git.applyPatch(root, {
      atomic: true,
      diff: extractHunkPatch(stagedPatch, [0]),
      revert: true,
      target: "staged",
    });
    expect(unstaged.status).toBe("success");

    const stillStaged = (
      await execGit(["diff", "--cached", "--name-only"], { cwd: root })
    ).trim();
    expect(stillStaged).toBe("");

    const worktree = await readFile(join(root, "file.txt"), "utf8");
    expect(worktree.startsWith("LINE1")).toBe(true);
  });

  it("reverts an unstaged hunk with apply -R", async () => {
    const root = await initRepo();
    temps.push(root);
    await writeFile(
      join(root, "file.txt"),
      `${[
        "LINE1",
        "line2",
        "line3",
        ...Array.from({ length: 40 }, () => "pad"),
      ].join("\n")}\n`,
      "utf8"
    );
    const patch = await execGit(["diff", "--", "file.txt"], { cwd: root });
    const hunk0 = extractHunkPatch(patch, [0]);
    const git = createGitService();
    const result = await git.applyPatch(root, {
      atomic: true,
      diff: hunk0,
      revert: true,
      target: "unstaged",
    });
    expect(result.status).toBe("success");
    const worktree = await readFile(join(root, "file.txt"), "utf8");
    expect(worktree.startsWith("line1")).toBe(true);
  });

  it("stages then unstages one pure-add island in a multi-island @@", async () => {
    const root = await initRepo();
    temps.push(root);
    // Two pure-addition islands separated by context (like import list inserts).
    await writeFile(
      join(root, "file.txt"),
      `${[
        "line1",
        "INSERT_A",
        "line2",
        "line3",
        "INSERT_B",
        ...Array.from({ length: 40 }, () => "pad"),
      ].join("\n")}\n`,
      "utf8"
    );
    const patch = await execGit(["diff", "--", "file.txt"], { cwd: root });
    expect(patch).toContain("+INSERT_A");
    expect(patch).toContain("+INSERT_B");

    const lower = extractChangeBlockPatch(patch, 0, 1);
    expect(lower).toContain("+INSERT_B");
    expect(lower).not.toContain("+INSERT_A");

    const git = createGitService();
    const staged = await git.applyPatch(root, {
      atomic: true,
      diff: lower,
      revert: false,
      target: "staged",
    });
    expect(staged.status).toBe("success");

    const cached = await execGit(["diff", "--cached", "--", "file.txt"], {
      cwd: root,
    });
    expect(cached).toContain("+INSERT_B");
    expect(cached).not.toContain("+INSERT_A");

    const unstageDiff = extractChangeBlockPatch(cached, 0, 0);
    const unstaged = await git.applyPatch(root, {
      atomic: true,
      diff: unstageDiff,
      revert: true,
      target: "staged",
    });
    expect(unstaged.status).toBe("success");
    const stillStaged = (
      await execGit(["diff", "--cached", "--name-only"], { cwd: root })
    ).trim();
    expect(stillStaged).toBe("");

    // Worktree still has both inserts (we only unstaged index).
    const worktree = await readFile(join(root, "file.txt"), "utf8");
    expect(worktree).toContain("INSERT_A");
    expect(worktree).toContain("INSERT_B");
  });

  it("stages upper then lower pure-add islands via real git apply", async () => {
    const root = await initRepo();
    temps.push(root);
    await writeFile(
      join(root, "file.txt"),
      `${[
        "line1",
        "INSERT_A",
        "line2",
        "line3",
        "INSERT_B",
        ...Array.from({ length: 40 }, () => "pad"),
      ].join("\n")}\n`,
      "utf8"
    );
    const patch = await execGit(["diff", "--", "file.txt"], { cwd: root });
    const upper = extractChangeBlockPatch(patch, 0, 0);
    const lower = extractChangeBlockPatch(patch, 0, 1);
    expect(upper).toContain("+INSERT_A");
    expect(upper).not.toContain("+INSERT_B");
    expect(lower).toContain("+INSERT_B");
    expect(lower).not.toContain("+INSERT_A");

    const git = createGitService();
    expect(
      (
        await git.applyPatch(root, {
          atomic: true,
          diff: upper,
          revert: false,
          target: "staged",
        })
      ).status
    ).toBe("success");
    // Second island apply uses the original worktree-based extract (line numbers
    // still match the unstaged working tree / base index for pure adds).
    expect(
      (
        await git.applyPatch(root, {
          atomic: true,
          diff: lower,
          revert: false,
          target: "staged",
        })
      ).status
    ).toBe("success");
    const cached = await execGit(["diff", "--cached", "--", "file.txt"], {
      cwd: root,
    });
    expect(cached).toContain("+INSERT_A");
    expect(cached).toContain("+INSERT_B");
  });
});
