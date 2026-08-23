import { afterEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() =>
  vi.fn(
    (
      _file: string,
      _args: readonly string[],
      options:
        | ((err: Error | null, stdout: string, stderr: string) => void)
        | object,
      callback?: (err: Error | null, stdout: string, stderr: string) => void
    ) => {
      const cb = typeof options === "function" ? options : callback;
      cb?.(new Error("execFile mock not configured"), "", "");
    }
  )
);

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    default: { ...actual, execFile: execFileMock },
    execFile: execFileMock,
  };
});

import {
  isMissingRuntimeError,
  readVersionAtPath,
} from "../../../../../src/main/services/agents/lifecycle/sources/version-probe.ts";

afterEach(() => {
  execFileMock.mockReset();
});

function execErr(
  partial: {
    code?: string | number;
    message?: string;
    stderr?: string;
    stdout?: string;
  } = {}
): Error {
  const err = new Error(partial.message ?? "spawn failed") as Error & {
    code?: string | number;
    stderr?: string;
    stdout?: string;
  };
  if (partial.code !== undefined) {
    err.code = partial.code;
  }
  if (partial.stderr !== undefined) {
    err.stderr = partial.stderr;
  }
  if (partial.stdout !== undefined) {
    err.stdout = partial.stdout;
  }
  return err;
}

describe("isMissingRuntimeError", () => {
  it("matches missing interpreter, not Gatekeeper kills or --version exit 1", () => {
    expect(isMissingRuntimeError(execErr({ code: "ENOENT" }))).toBe(true);
    expect(isMissingRuntimeError(execErr({ code: 127 }))).toBe(true);
    expect(
      isMissingRuntimeError(
        execErr({
          stderr: "/usr/bin/env: node: No such file or directory",
        })
      )
    ).toBe(true);
    expect(
      isMissingRuntimeError(
        Object.assign(execErr({ message: "killed" }), {
          killed: true,
          signal: "SIGKILL",
        })
      )
    ).toBe(false);
    expect(isMissingRuntimeError(execErr({ code: 1, message: "exit 1" }))).toBe(
      false
    );
  });
});

describe("readVersionAtPath", () => {
  it("keeps the install when --version is killed; version stays unknown", async () => {
    execFileMock.mockImplementation((_file, _args, options, callback) => {
      const cb = typeof options === "function" ? options : callback;
      const err = execErr({ message: "killed" });
      (err as Error & { killed: boolean; signal: string }).killed = true;
      (err as Error & { killed: boolean; signal: string }).signal = "SIGKILL";
      cb?.(err, "", "");
    });

    const result = await readVersionAtPath("/opt/homebrew/bin/claude", [
      "--version",
    ]);
    expect(result).toEqual({ runnable: true, version: null });
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("marks missing Node interpreter as not runnable", async () => {
    execFileMock.mockImplementation((_file, _args, options, callback) => {
      const cb = typeof options === "function" ? options : callback;
      cb?.(
        execErr({
          code: 127,
          message: "Command failed: claude --version",
        }),
        "",
        "/usr/bin/env: node: No such file or directory"
      );
    });

    const result = await readVersionAtPath("/tmp/claude", ["--version"]);
    expect(result.runnable).toBe(false);
    expect(result.version).toBeNull();
  });

  it("reads version even when --version exits non-zero", async () => {
    execFileMock.mockImplementation((_file, _args, options, callback) => {
      const cb = typeof options === "function" ? options : callback;
      cb?.(execErr({ code: 1, message: "Command failed" }), "2.1.235\n", "");
    });

    const result = await readVersionAtPath("/tmp/claude", ["--version"]);
    expect(result).toEqual({ runnable: true, version: "2.1.235" });
  });
});
