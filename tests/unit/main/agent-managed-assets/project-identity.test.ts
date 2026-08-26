import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProjectIdentity } from "@main/services/agent-managed-assets/project-identity.ts";
import { afterEach, describe, expect, it } from "vitest";

const dirs: string[] = [];

afterEach(() => {
  dirs.length = 0;
});

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pier-mem-id-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "init"], {
    cwd: dir,
  });
  return realpathSync(dir);
}

describe("resolveProjectIdentity", () => {
  it("collapses linked worktree onto the main repo identity", async () => {
    const main = initRepo();
    const worktree = mkdtempSync(join(tmpdir(), "pier-mem-wt-"));
    dirs.push(worktree);
    execFileSync(
      "git",
      ["worktree", "add", "-q", "--detach", worktree, "HEAD"],
      { cwd: main }
    );
    const a = await resolveProjectIdentity(main);
    const b = await resolveProjectIdentity(worktree);
    expect(a.key).toBe(b.key);
    expect(a.key).toMatch(/^[0-9a-f]{16}$/);
  });

  it("falls back to directory identity outside a repo", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "pier-mem-nogit-")));
    dirs.push(dir);
    const id = await resolveProjectIdentity(dir);
    expect(id.canonicalRoot).toBe(dir);
    expect(id.key).toMatch(/^[0-9a-f]{16}$/);
  });
});
