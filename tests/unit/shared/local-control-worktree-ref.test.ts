import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildWorktreeRef,
  worktreeRefSchema,
  worktreeRefsEqual,
} from "@shared/contracts/local-control/worktree-ref.ts";
import { describe, expect, it } from "vitest";

const CONTRACTS_ROOT = join(process.cwd(), "src/shared/contracts");

function listContractSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...listContractSources(path));
      continue;
    }
    if (name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

describe("WorktreeRef", () => {
  it("builds absolute worktreeKey/rootPath and keeps incarnation", () => {
    const ref = buildWorktreeRef({
      path: "/tmp/repo.worktree/feature-a",
      gitRoot: "/tmp/repo",
      branch: "feature/a",
      incarnationId: "inc-1",
    });
    expect(ref.worktreeKey).toBe(ref.rootPath);
    expect(ref.gitRoot).toContain("repo");
    expect(ref.branch).toBe("feature/a");
    expect(ref.incarnationId).toBe("inc-1");
    expect(worktreeRefSchema.parse(ref)).toEqual(ref);
  });

  it("equality requires same incarnation", () => {
    const a = buildWorktreeRef({
      path: "/tmp/wt",
      incarnationId: "a",
    });
    const b = buildWorktreeRef({
      path: "/tmp/wt",
      incarnationId: "b",
    });
    expect(worktreeRefsEqual(a, a)).toBe(true);
    expect(worktreeRefsEqual(a, b)).toBe(false);
  });

  it("keeps shared contracts free of Node builtins (renderer-safe)", () => {
    const nodeImport = /from ["']node:/;
    for (const file of listContractSources(CONTRACTS_ROOT)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(nodeImport);
    }
  });
});
