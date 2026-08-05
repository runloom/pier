import { GitExecError } from "@main/services/git/exec.ts";
import {
  classifyRemoteGitError,
  REMOTE_WRITE_TIMEOUT_MS,
  remoteUnavailable,
} from "@main/services/git/remote-operation-error.ts";
import { describe, expect, it } from "vitest";

function execError(
  partial: Partial<ConstructorParameters<typeof GitExecError>[0]> & {
    message: string;
  }
): GitExecError {
  return new GitExecError({
    args: partial.args ?? ["push"],
    causeKind: partial.causeKind ?? "exit",
    cwd: partial.cwd ?? "/repo",
    exitCode: partial.exitCode ?? 1,
    hookSignal: partial.hookSignal ?? null,
    message: partial.message,
    signal: partial.signal ?? null,
    stderr: partial.stderr ?? "",
    stdout: partial.stdout ?? "",
  });
}

describe("REMOTE_WRITE_TIMEOUT_MS", () => {
  it("allows multi-minute pre-push gates without matching plain write 60s", () => {
    expect(REMOTE_WRITE_TIMEOUT_MS).toBe(20 * 60 * 1000);
    expect(REMOTE_WRITE_TIMEOUT_MS).toBeGreaterThan(60_000);
  });
});

describe("classifyRemoteGitError", () => {
  it("classifies host timeout separately from generic exit", () => {
    const result = classifyRemoteGitError(
      execError({
        causeKind: "timeout",
        message: "git 执行期限已到",
        stderr: "$ pnpm typecheck\n$ ultracite check\n",
      })
    );
    expect(result.reason).toBe("timeout");
    expect(result.message).toMatch(/timed out/i);
    expect(result.message).toContain("ultracite");
  });

  it("classifies husky / pre-push style hook failures", () => {
    const result = classifyRemoteGitError(
      execError({
        message: "pre-push hook failed",
        stderr: [
          "husky - pre-push script failed (code 1)",
          "preflight-ci [push] finished in 12s (exit 1)",
        ].join("\n"),
      })
    );
    expect(result.reason).toBe("hook");
    expect(result.message).toMatch(/local Git hook/i);
    expect(result.message).toMatch(/husky|preflight/i);
  });

  it("classifies structured hookSignal from git exec using stderr tail", () => {
    const result = classifyRemoteGitError(
      execError({
        hookSignal: { hookPath: ".husky/pre-push", signal: 1 },
        message: "hook failed",
        stderr: "some detail from pre-push",
      })
    );
    expect(result.reason).toBe("hook");
    expect(result.message).toContain("some detail from pre-push");
    expect(result.message).not.toMatch(/signal/i);
  });

  it("uses hook path only when hookSignal has empty diagnostic output", () => {
    const result = classifyRemoteGitError(
      execError({
        hookSignal: { hookPath: ".husky/pre-push", signal: 1 },
        message: "git 退出码 1",
        stderr: "",
        stdout: "",
      })
    );
    expect(result.reason).toBe("hook");
    expect(result.message).toContain(".husky/pre-push");
  });

  it("does not label remote pre-receive rejections as local hooks", () => {
    const result = classifyRemoteGitError(
      execError({
        message: "git 退出码 1",
        stderr: [
          "To github.com:org/repo.git",
          " ! [remote rejected]   main -> main (pre-receive hook declined)",
          "error: failed to push some refs to 'github.com:org/repo.git'",
        ].join("\n"),
      })
    );
    expect(result.reason).toBe("generic");
    expect(result.message).toMatch(/remote rejected|pre-receive/i);
  });

  it("classifies missing upstream", () => {
    const result = classifyRemoteGitError(
      execError({
        message: "fatal: The current branch feat/x has no upstream branch.",
        stderr:
          "fatal: The current branch feat/x has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream origin feat/x\n",
      })
    );
    expect(result.reason).toBe("no_upstream");
  });

  it("prefers the tail of long hook noise over the head", () => {
    const head = "$ bash scripts/preflight-ci.sh push\n".repeat(80);
    const tail = "Error: typecheck failed in packages/ui\n";
    const result = classifyRemoteGitError(
      execError({
        message: "exit 1",
        stderr: `${head}${tail}`,
      })
    );
    expect(result.reason).toBe("hook");
    expect(result.message).toContain("typecheck failed");
    expect(result.message).toMatch(/…/);
  });

  it("remoteUnavailable returns message only (no contract reason field)", () => {
    expect(
      remoteUnavailable(
        execError({
          causeKind: "timeout",
          message: "git 执行期限已到",
          stderr: "",
          stdout: "",
        })
      )
    ).toEqual({
      kind: "unavailable",
      message: expect.stringMatching(/timed out/i),
    });
  });
});
