import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildLoginShellDumpCommand,
  loginShellFlagArgs,
  loginShellSpawnSpec,
  wrapLoginShellCommandLine,
} from "@main/services/process-environment/login-shell-spawn.ts";
import { quoteShellArg } from "@main/services/process-environment/resolve-user-command-types.ts";
import { describe, expect, it } from "vitest";

describe("login shell spawn", () => {
  it("dump/agent flags stay interactive; one-shot spawn is -c without login", () => {
    expect(loginShellFlagArgs("/bin/zsh")).toEqual(["-lic"]);
    expect(loginShellFlagArgs("/opt/homebrew/bin/fish")).toEqual([
      "-l",
      "-i",
      "-c",
    ]);
    expect(loginShellFlagArgs("/opt/homebrew/bin/nu")).toEqual([
      "-i",
      "-l",
      "-c",
    ]);
    expect(loginShellFlagArgs("/bin/zsh", "command")).toEqual(["-c"]);
    expect(loginShellFlagArgs("/opt/homebrew/bin/fish", "command")).toEqual([
      "-c",
    ]);
    expect(loginShellFlagArgs("/opt/homebrew/bin/nu", "command")).toEqual([
      "-c",
    ]);
  });

  it("builds spawn argv with the script as the last argument", () => {
    expect(loginShellSpawnSpec("pnpm check", { SHELL: "/bin/zsh" })).toEqual({
      args: ["-c", "pnpm check"],
      command: "/bin/zsh",
    });
  });

  it("wraps a Ghostty command line with command flags", () => {
    expect(wrapLoginShellCommandLine("pnpm check", { SHELL: "/bin/zsh" })).toBe(
      "/bin/zsh -c 'pnpm check'"
    );
  });

  it("cds into the dump directory before printenv", () => {
    expect(buildLoginShellDumpCommand("printenv", "/tmp/proj")).toBe(
      "cd /tmp/proj; printenv"
    );
    expect(buildLoginShellDumpCommand("printenv", "/tmp/my proj")).toBe(
      "cd '/tmp/my proj'; printenv"
    );
    expect(buildLoginShellDumpCommand("printenv", "-odd")).toBe(
      "cd ./-odd; printenv"
    );
    expect(buildLoginShellDumpCommand("printenv")).toBe("printenv");
  });

  it("passes the script as argv so quoted literals cannot inject", () => {
    const dir = mkdtempSync(join(tmpdir(), "pier-login-quote-"));
    const marker = join(dir, "pwn");
    try {
      const label = `x'; touch ${marker}; #`;
      const script = `printf '%s\\n' ${quoteShellArg(label)}`;
      const spec = loginShellSpawnSpec(script, { SHELL: "/bin/sh" });
      const run = spawnSync(spec.command, spec.args, { encoding: "utf8" });
      expect(run.status).toBe(0);
      expect(run.stdout).toContain(label);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
