import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildResolvedAgentSurfaceCommand,
  buildStickyExportPrelude,
  buildUserCommandProbeScript,
  clearUserCommandResolveCache,
  extractBareCommandName,
  extractProbeProtocolBody,
  looksLikeShebangScript,
  PIER_CMD_END,
  PIER_CMD_START,
  parseUserCommandProbeOutput,
  resolveAbsoluteOnPath,
  shellFamily,
} from "@main/services/process-environment/resolve-user-command.ts";
import { buildClassAStickyPrelude } from "@pier/plugin-api/resolve-class-a-command";
import { beforeEach, describe, expect, it } from "vitest";

describe("resolve-user-command helpers", () => {
  beforeEach(() => {
    clearUserCommandResolveCache();
  });

  it("parses ABS / VIA_SHELL / MISSING probe output", () => {
    expect(parseUserCommandProbeOutput("ABS\n/usr/bin/codex\n")).toEqual({
      kind: "absolute",
      path: "/usr/bin/codex",
    });
    expect(parseUserCommandProbeOutput("VIA_SHELL\n")).toEqual({
      kind: "via-shell",
    });
    expect(parseUserCommandProbeOutput("MISSING\n").kind).toBe("missing");
  });

  it("ignores interactive rc noise before protocol markers", () => {
    const noisy = [
      "oh-my-zsh loading...",
      "compinit done",
      PIER_CMD_START,
      "ABS",
      "/opt/homebrew/bin/claude",
      PIER_CMD_END,
      "extra",
    ].join("\n");
    expect(parseUserCommandProbeOutput(noisy)).toEqual({
      kind: "absolute",
      path: "/opt/homebrew/bin/claude",
    });
  });

  it("uses last protocol keyword when markers are missing", () => {
    const noisy = "hello\nVIA_SHELL\n";
    expect(parseUserCommandProbeOutput(noisy)).toEqual({ kind: "via-shell" });
  });

  it("extracts framed protocol body", () => {
    const body = extractProbeProtocolBody(
      `noise\n${PIER_CMD_START}\nABS\n/bin/x\n${PIER_CMD_END}\nmore`
    );
    expect(body).toContain("ABS");
    expect(body).toContain("/bin/x");
    expect(body).not.toContain("noise");
  });

  it("extracts bare command names and rejects shell meta", () => {
    expect(extractBareCommandName("codex --yolo")).toBe("codex");
    expect(extractBareCommandName("  claude ")).toBe("claude");
    expect(extractBareCommandName("foo | bar")).toBeNull();
  });

  it("builds sticky export prelude for PATH and tool keys", () => {
    const prelude = buildStickyExportPrelude({
      PATH: "/custom/bin:/usr/bin",
      NVM_DIR: "/home/u/.nvm",
      HOME: "/home/u",
      RANDOM_UI: "nope",
    });
    expect(prelude).toContain("export PATH=/custom/bin:/usr/bin");
    expect(prelude).toContain("export NVM_DIR=/home/u/.nvm");
    expect(prelude).not.toContain("RANDOM_UI");
  });

  it("class A sticky mirrors host-apply keys including NVM", () => {
    const prelude = buildClassAStickyPrelude({
      PATH: "/p",
      NVM_BIN: "/n",
      HOME: "/h",
    });
    expect(prelude).toContain("PATH=");
    expect(prelude).toContain("NVM_BIN=");
    expect(prelude).not.toContain("HOME=");
  });

  it("does not wrap shebang scripts as a PTY command (inject into user shell)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pier-shebang-"));
    const script = join(dir, "omp");
    writeFileSync(script, "#!/usr/bin/env bun\n");
    chmodSync(script, 0o755);
    expect(
      buildResolvedAgentSurfaceCommand({
        commandLine: "omp",
        env: { PATH: dir, SHELL: "/bin/zsh" },
        resolved: { kind: "absolute", path: script },
        shell: "/bin/zsh",
      })
    ).toBeNull();
    expect(looksLikeShebangScript(script)).toBe(true);
  });

  it("builds absolute surface as thin sh -c exec", () => {
    const command = buildResolvedAgentSurfaceCommand({
      commandLine: "codex --yolo",
      env: { PATH: "/a:/b", SHELL: "/bin/zsh" },
      resolved: { kind: "absolute", path: "/nvm/bin/codex" },
      shell: "/bin/zsh",
    });
    expect(command).toBe("/bin/sh -c 'exec /nvm/bin/codex --yolo'");
  });

  it("builds absolute surface for already-absolute command lines", () => {
    const command = buildResolvedAgentSurfaceCommand({
      commandLine: "/opt/homebrew/bin/claude --x",
      env: { PATH: "/a", SHELL: "/bin/zsh" },
      resolved: { kind: "absolute", path: "/opt/homebrew/bin/claude" },
      shell: "/bin/zsh",
    });
    expect(command).toBe("/bin/sh -c 'exec /opt/homebrew/bin/claude --x'");
  });

  it("builds via-shell surface with sticky exports after rc", () => {
    const command = buildResolvedAgentSurfaceCommand({
      commandLine: "codex",
      env: { PATH: "/project/bin:/usr/bin", SHELL: "/bin/zsh" },
      resolved: { kind: "via-shell" },
      shell: "/bin/zsh",
    });
    expect(command).toEqual(expect.stringMatching(/^\/bin\/zsh -lic /));
    expect(command).toEqual(expect.stringContaining("export PATH="));
    expect(command).toEqual(expect.stringContaining("codex"));
  });

  it("probe scripts are shell-family aware and include markers", () => {
    const zsh = buildUserCommandProbeScript("codex", "zsh");
    expect(zsh).toContain(PIER_CMD_START);
    expect(zsh).toContain("VIA_SHELL");
    expect(zsh).toContain("ABS");
    const fish = buildUserCommandProbeScript("codex", "fish");
    expect(fish).toContain("functions -q");
    expect(shellFamily("/opt/homebrew/bin/fish")).toBe("fish");
  });

  it("resolveAbsoluteOnPath finds executables on PATH", () => {
    // /bin/sh is universal on POSIX CI/macOS.
    const hit = resolveAbsoluteOnPath("sh", "/bin:/usr/bin");
    expect(hit === "/bin/sh" || hit === "/usr/bin/sh").toBe(true);
    expect(resolveAbsoluteOnPath("no-such-binary-xyz", "/bin")).toBeNull();
  });
});
