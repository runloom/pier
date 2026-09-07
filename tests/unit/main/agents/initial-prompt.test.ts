import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildInteractiveInitialPrompt,
  resolveInteractiveInitialPrompt,
} from "../../../../src/main/services/agents/initial-prompt.ts";
import { AGENT_CATALOG } from "../../../../src/shared/agent-catalog.ts";

describe("native interactive initial prompt", () => {
  it("executes the verified shebang binary as the owned leader with literal multiline argv", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pier-literal-agent-"));
    const binary = join(dir, "claude");
    writeFileSync(
      binary,
      `#!${process.execPath}\nif (process.argv.includes('--help')) console.log('[prompt]'); else console.log(JSON.stringify(process.argv.slice(2)));\n`
    );
    chmodSync(binary, 0o755);
    try {
      const text = "任务 $(literal) 'quoted'\nnext\n";
      const plan = await resolveInteractiveInitialPrompt({
        agentId: "claude",
        command: "claude",
        text,
        env: { PATH: dir, SHELL: "/bin/zsh" },
      });
      if (plan.mode !== "native-launch")
        throw new Error("expected verified argv");
      expect(plan.command).toContain(`exec ${binary}`);
      const output = execFileSync("/bin/sh", ["-c", plan.command], {
        encoding: "utf8",
      });
      expect(JSON.parse(output.trim())).toEqual(["--", text]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("gives every catalog agent an explicit initial-input strategy", () => {
    expect(
      AGENT_CATALOG.filter((entry) => !entry.initialPrompt).map(
        (entry) => entry.id
      )
    ).toEqual([]);
  });

  it("passes the original literal prompt to Codex argv exactly once", () => {
    const text =
      "--任务 'literal' $(touch /tmp/never-pier-input) `ignored`\n第二行\n";
    const result = buildInteractiveInitialPrompt({
      agentId: "codex",
      command: "codex --dangerously-bypass-approvals-and-sandbox",
      text,
      help: "Usage: codex [OPTIONS] [PROMPT]",
    });
    expect(result.mode).toBe("native-launch");
    if (result.mode !== "native-launch")
      throw new Error("expected native argv");
    // Execute a shell function with the real emitted shell syntax; no Codex process.
    const output = execFileSync("/bin/sh", [
      "-c",
      `codex() { printf '%s\\0' "$@"; }; ${result.command}`,
    ]);
    expect(output.toString().split("\0")).toEqual([
      "--dangerously-bypass-approvals-and-sandbox",
      "--",
      text,
      "",
    ]);
  });

  it.each([
    ["aider", "aider", "--message <prompt> send and exit"],
    ["codex", "codex exec", "[PROMPT]"],
    ["codex", "/bin/sh -c 'codex'", "[PROMPT]"],
    ["codex", "codex", "old or unknown help"],
    ["amp", "amp", "echo prompt | amp"],
    ["openclaw", "openclaw", "tui --message <text>"],
  ] as const)("retains a draft for %s when interactive argv is not verified", (agentId, command, help) => {
    expect(
      buildInteractiveInitialPrompt({
        agentId,
        command,
        help,
        text: "original task",
      })
    ).toEqual({ mode: "draft" });
  });

  it("uses Copilot's interactive option, preserving the persistent TUI", () => {
    expect(
      buildInteractiveInitialPrompt({
        agentId: "copilot",
        command: "copilot --yolo",
        help: "-i, --interactive <prompt>",
        text: "hello",
      })
    ).toEqual({
      mode: "native-launch",
      command: "copilot --yolo --interactive hello",
    });
  });

  it("does not let Pi interpret task text as an attachment", () => {
    expect(
      buildInteractiveInitialPrompt({
        agentId: "pi",
        command: "pi",
        help: "[messages...]",
        text: "@secret.txt",
      })
    ).toEqual({ mode: "draft" });
  });
});
