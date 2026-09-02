import {
  panelGitIdentityDigest,
  panelGitIdentityUnchanged,
} from "@main/services/panel-context-identity.ts";
import { describe, expect, it } from "vitest";

const identity = {
  branch: "main",
  cwd: "/repo",
  gitRoot: "/repo",
  head: "abc",
  worktreeRoot: "/repo",
};

describe("panelGitIdentityDigest", () => {
  it("changes when cwd, gitRoot, worktreeRoot, branch, or head change", () => {
    const baseline = panelGitIdentityDigest(identity);
    expect(panelGitIdentityDigest({ ...identity, cwd: "/other" })).not.toBe(
      baseline
    );
    expect(panelGitIdentityDigest({ ...identity, gitRoot: "/other" })).not.toBe(
      baseline
    );
    expect(
      panelGitIdentityDigest({ ...identity, worktreeRoot: "/other" })
    ).not.toBe(baseline);
    expect(panelGitIdentityDigest({ ...identity, branch: "dev" })).not.toBe(
      baseline
    );
    expect(panelGitIdentityDigest({ ...identity, head: "def" })).not.toBe(
      baseline
    );
  });

  it("treats missing gitRoot as a different identity from a present one", () => {
    expect(
      panelGitIdentityUnchanged(
        { cwd: "/repo" },
        { cwd: "/repo", gitRoot: "/repo" }
      )
    ).toBe(false);
  });
});
