import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildLoginShellDumpCommand,
  loginShellFlagArgs,
} from "@main/services/process-environment/login-shell-spawn.ts";
import { isLaunchedFromCli } from "@main/services/process-environment/shell-env-cli.ts";
import {
  createShellEnvJsonMark,
  formatShellSpawnError,
  parseShellEnvironmentJsonOutput,
  parseShellEnvironmentOutput,
  remainingTimeoutMs,
  resolveShellDumpCwd,
  SHELL_DUMP_ARTIFACT_KEYS,
  SHELL_ENV_END,
  SHELL_ENV_START,
  shellEnvJsonCommand,
  stripShellDumpArtifacts,
  tryParseShellEnvironmentOutput,
} from "@main/services/process-environment/shell-env-loader.ts";
import { describe, expect, it } from "vitest";

describe("remainingTimeoutMs", () => {
  it("returns remaining budget until shared deadline", () => {
    const deadline = 1_000_000;
    expect(remainingTimeoutMs(deadline, 999_000)).toBe(1000);
    expect(remainingTimeoutMs(deadline, 1_000_000)).toBe(1);
    expect(remainingTimeoutMs(deadline, 1_000_500)).toBe(1);
  });
});

describe("login-interactive dump command", () => {
  it("uses login flags and cds into the dump directory", () => {
    expect(loginShellFlagArgs("/bin/zsh")).toEqual(["-lic"]);
    expect(loginShellFlagArgs("/bin/zsh", "command")).toEqual(["-c"]);
    const jsonCommand = shellEnvJsonCommand("/path/to/Electron", "mark");
    const dumpCommand = buildLoginShellDumpCommand(jsonCommand, "/tmp/proj");
    expect(dumpCommand.startsWith("cd /tmp/proj; ")).toBe(true);
    expect(dumpCommand).toContain("JSON.stringify(process.env)");
  });
});

describe("stripShellDumpArtifacts", () => {
  it("removes dump-only ELECTRON_*, PIER_RESOLVING_ENVIRONMENT, and SHELL_SESSIONS_DISABLE", () => {
    const cleaned = stripShellDumpArtifacts({
      ELECTRON_NO_ATTACH_CONSOLE: "1",
      ELECTRON_RUN_AS_NODE: "1",
      HOME: "/tmp",
      PATH: "/bin",
      PIER_RESOLVING_ENVIRONMENT: "1",
      SHELL_SESSIONS_DISABLE: "1",
    });
    expect(cleaned).toEqual({ HOME: "/tmp", PATH: "/bin" });
    for (const key of SHELL_DUMP_ARTIFACT_KEYS) {
      expect(cleaned).not.toHaveProperty(key);
    }
  });

  it("keeps dump TERM=dumb for non-interactive consumers", () => {
    const env = { HOME: "/tmp", PATH: "/bin", TERM: "dumb" };
    expect(stripShellDumpArtifacts(env)).toEqual(env);
  });

  it("returns the same object when nothing needs stripping", () => {
    const env = { HOME: "/tmp", PATH: "/bin" };
    expect(stripShellDumpArtifacts(env)).toBe(env);
  });
});

describe("JSON-mark dump (VS Code style)", () => {
  it("builds a node -p command with the mark", () => {
    const cmd = shellEnvJsonCommand("/path/to/Electron", "abc123def456");
    expect(cmd).toContain("/path/to/Electron");
    expect(cmd).toContain("-p");
    expect(cmd).toContain("JSON.stringify(process.env)");
    expect(cmd).toContain("abc123def456");
  });

  it("parses mark-wrapped JSON env", () => {
    const mark = "deadbeefcaf0";
    const payload = { HOME: "/tmp", PATH: "/bin:/usr/bin", NVM_DIR: "/n" };
    const buf = Buffer.from(
      `noise\n${mark}${JSON.stringify(payload)}${mark}\n`
    );
    expect(parseShellEnvironmentJsonOutput(buf, mark)).toEqual(payload);
  });

  it("tryParse prefers JSON mark then falls back to env -0 markers", () => {
    const mark = createShellEnvJsonMark();
    const jsonBuf = Buffer.from(
      `${mark}${JSON.stringify({ PATH: "/json" })}${mark}`
    );
    expect(tryParseShellEnvironmentOutput(jsonBuf, mark)).toEqual({
      PATH: "/json",
    });

    const legacy = Buffer.from(
      `${SHELL_ENV_START}\nPATH=/legacy\0HOME=/tmp\n${SHELL_ENV_END}\n`
    );
    expect(tryParseShellEnvironmentOutput(legacy, mark)).toEqual({
      HOME: "/tmp",
      PATH: "/legacy",
    });
  });
});

describe("tryParseShellEnvironmentOutput", () => {
  it("parses a valid dump buffer", () => {
    const buf = Buffer.from(
      `${SHELL_ENV_START}\nPATH=/bin\0HOME=/tmp\n${SHELL_ENV_END}\n`
    );
    expect(tryParseShellEnvironmentOutput(buf)).toEqual({
      HOME: "/tmp",
      PATH: "/bin",
    });
    expect(parseShellEnvironmentOutput(buf)).toEqual({
      HOME: "/tmp",
      PATH: "/bin",
    });
  });

  it("returns null when markers are missing (does not throw)", () => {
    expect(
      tryParseShellEnvironmentOutput(Buffer.from("no markers"))
    ).toBeNull();
  });
});

describe("isLaunchedFromCli", () => {
  it("detects pier CLI launch markers", () => {
    expect(isLaunchedFromCli({ PIER_CLI: "1" })).toBe(true);
    expect(isLaunchedFromCli({ PIER_LAUNCHED_FROM_CLI: "1" })).toBe(true);
    expect(isLaunchedFromCli({})).toBe(false);
  });

  it("allows force dump even when CLI markers are set", () => {
    expect(isLaunchedFromCli({ PIER_CLI: "1", PIER_FORCE_USER_ENV: "1" })).toBe(
      false
    );
  });
});

describe("resolveShellDumpCwd", () => {
  it("keeps an existing directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "pier-shell-cwd-"));
    try {
      expect(resolveShellDumpCwd(dir)).toBe(dir);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("falls back to HOME when cwd is missing", () => {
    const home = mkdtempSync(join(tmpdir(), "pier-shell-home-"));
    try {
      expect(resolveShellDumpCwd("/nonexistent/pier-shell-cwd-xyz", home)).toBe(
        home
      );
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("returns undefined when neither path exists", () => {
    expect(
      resolveShellDumpCwd(
        "/nonexistent/pier-shell-cwd-xyz",
        "/nonexistent/pier-shell-home-xyz"
      )
    ).toBeUndefined();
  });
});

describe("formatShellSpawnError", () => {
  it("explains missing cwd when Node reports spawn shell ENOENT", () => {
    const err = Object.assign(new Error("spawn /bin/zsh ENOENT"), {
      code: "ENOENT",
    });
    const formatted = formatShellSpawnError(
      err,
      process.execPath,
      "/nonexistent/pier-shell-cwd-xyz"
    );
    expect(formatted.message).toContain("working directory not found");
    expect(formatted.message).toContain("/nonexistent/pier-shell-cwd-xyz");
  });

  it("explains missing shell binary", () => {
    const err = Object.assign(new Error("spawn /no/such/shell ENOENT"), {
      code: "ENOENT",
    });
    const formatted = formatShellSpawnError(
      err,
      "/no/such/shell-pier-test",
      undefined
    );
    expect(formatted.message).toContain("shell not found");
  });
});
