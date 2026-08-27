import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnBackgroundTask } from "@main/services/tasks/background-runner.ts";
import { describe, expect, it } from "vitest";

describe("task background runner", () => {
  it("forwards stdout and stderr with terminal control sequences intact", async () => {
    const output: Array<{ stream: "stdout" | "stderr"; text: string }> = [];
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      spawnBackgroundTask({
        command: "printf '\\033[31mout\\033[0m\\n'; printf 'err\\n' >&2",
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH ?? "",
          SHELL: "/bin/sh",
        },
        onError: reject,
        onExit: resolve,
        onOutput: (stream, text) => output.push({ stream, text }),
      });
    });

    expect(exitCode).toBe(0);
    expect(output).toContainEqual({
      stream: "stdout",
      text: "\u001B[31mout\u001B[0m\n",
    });
    expect(
      output.some(
        (chunk) => chunk.stream === "stderr" && chunk.text.includes("err\n")
      )
    ).toBe(true);
    expect(output.map((chunk) => chunk.text).join("")).toContain("\u001B");
  });

  it.skipIf(process.platform === "win32" || !existsSync("/bin/zsh"))(
    "keeps dump PATH ahead of login rc that would prepend",
    async () => {
      const zdot = mkdtempSync(join(tmpdir(), "pier-task-dump-path-"));
      const dumpDir = join(zdot, "dump");
      const trapDir = join(zdot, "trap");
      try {
        writeFileSync(join(zdot, ".zshenv"), "unsetopt GLOBAL_RCS\n");
        writeFileSync(
          join(zdot, ".zprofile"),
          'export PATH="$ZDOTDIR/trap:$PATH"\n'
        );
        writeFileSync(join(zdot, ".zshrc"), "");
        mkdirSync(dumpDir);
        mkdirSync(trapDir);
        writeFileSync(join(dumpDir, "pnpm"), "#!/bin/sh\necho dump\n");
        writeFileSync(join(trapDir, "pnpm"), "#!/bin/sh\necho trap\n");
        chmodSync(join(dumpDir, "pnpm"), 0o755);
        chmodSync(join(trapDir, "pnpm"), 0o755);

        const stdout = await new Promise<string>((resolve, reject) => {
          let text = "";
          spawnBackgroundTask({
            command: "command -v pnpm",
            cwd: zdot,
            env: {
              HOME: zdot,
              PATH: `${dumpDir}:/usr/bin:/bin`,
              SHELL: "/bin/zsh",
              TERM: "dumb",
              ZDOTDIR: zdot,
            },
            onError: reject,
            onExit: (code) => {
              if (code === 0) {
                resolve(text);
                return;
              }
              reject(
                new Error(`dump PATH spawn exited ${String(code)}: ${text}`)
              );
            },
            onOutput: (stream, chunk) => {
              if (stream === "stdout") {
                text += chunk;
              }
            },
          });
        });

        expect(stdout.trim()).toBe(join(dumpDir, "pnpm"));
      } finally {
        rmSync(zdot, { force: true, recursive: true });
      }
    }
  );

  it.skipIf(process.platform === "win32" || !existsSync("/bin/zsh"))(
    "does not source interactive rc that cannot enable zle",
    async () => {
      const zdot = mkdtempSync(join(tmpdir(), "pier-task-zle-"));
      try {
        writeFileSync(join(zdot, ".zshenv"), "unsetopt GLOBAL_RCS\n");
        writeFileSync(join(zdot, ".zprofile"), "");
        writeFileSync(
          join(zdot, ".zshrc"),
          'setopt zle\necho "Restored session: fake"\n'
        );
        const output = await new Promise<string>((resolve, reject) => {
          let text = "";
          spawnBackgroundTask({
            command: "printf ok\\n",
            cwd: zdot,
            env: {
              HOME: zdot,
              PATH: "/usr/bin:/bin",
              SHELL: "/bin/zsh",
              TERM: "dumb",
              TERM_PROGRAM: "Apple_Terminal",
              TERM_SESSION_ID: "w0t0p0:fake",
              ZDOTDIR: zdot,
            },
            onError: reject,
            onExit: (code) => {
              if (code === 0) {
                resolve(text);
                return;
              }
              reject(new Error(`zle spawn exited ${String(code)}: ${text}`));
            },
            onOutput: (_stream, chunk) => {
              text += chunk;
            },
          });
        });
        expect(output).toContain("ok");
        expect(output).not.toMatch(/can't change option: zle/);
        expect(output).not.toContain("Restored session");
      } finally {
        rmSync(zdot, { force: true, recursive: true });
      }
    }
  );
});
