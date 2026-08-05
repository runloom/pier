import { classifyRemoteGitError } from "@plugins/builtin/git/renderer/remote-error.ts";
import { describe, expect, it } from "vitest";

describe("classifyRemoteGitError", () => {
  it("detects missing upstream from git pull wording", () => {
    expect(
      classifyRemoteGitError(
        new Error(
          "There is no tracking information for the current branch.\nSee git-pull(1) for details."
        )
      )
    ).toBe("noUpstream");
  });

  it("detects auth and network failures", () => {
    expect(
      classifyRemoteGitError(new Error("Permission denied (publickey)"))
    ).toBe("auth");
    expect(
      classifyRemoteGitError(new Error("Could not resolve host: github.com"))
    ).toBe("network");
  });

  it("detects non-fast-forward rejection", () => {
    expect(
      classifyRemoteGitError(
        new Error("! [rejected] main -> main (non-fast-forward)")
      )
    ).toBe("rejected");
  });

  it("detects host timeout and local hook prefixes", () => {
    expect(
      classifyRemoteGitError(
        new Error(
          "Git operation timed out (local checks or remote transfer may still be running)"
        )
      )
    ).toBe("timeout");
    expect(
      classifyRemoteGitError(
        new Error("A local Git hook rejected or stopped this operation")
      )
    ).toBe("hook");
  });
});
