import { describe, expect, it } from "vitest";
import { assertAllowedScriptUrl } from "../../../../../src/main/services/agents/lifecycle/official-script.ts";
import { sourceHasMatchingInstallChannel } from "../../../../../src/main/services/agents/lifecycle/plan/source-policy.ts";
import {
  brewPackageTokenFromBinPath,
  buildGuideCommands,
  buildInstallCommand,
  buildInstallPlan,
  buildUpdatePlan,
  planLifecycle,
} from "../../../../../src/main/services/agents/lifecycle/plan.ts";
import { getAgentLifecycleSpec } from "../../../../../src/main/services/agents/lifecycle/specs/index.ts";
import { wslDistroFromPath } from "../../../../../src/main/services/agents/lifecycle/wsl.ts";

describe("agent lifecycle plan", () => {
  it("builds codex install with official script and npm fallbacks", () => {
    const plan = buildInstallPlan(getAgentLifecycleSpec("codex"), "posix");
    expect(plan?.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan?.preview).toContain("chatgpt.com/codex/install.sh");
    expect(plan?.preview).toContain("npm i -g @openai/codex@latest");
  });

  it("builds Windows codex install with script and npm", () => {
    const plan = buildInstallPlan(getAgentLifecycleSpec("codex"), "win");
    expect(plan?.preview).toContain("chatgpt.com/codex/install.ps1");
    expect(plan?.preview).toContain("npm i -g @openai/codex@latest");
    expect(plan?.preview).not.toContain("call ");
  });

  it("chains claude official script, brew cask, and npm as install fallbacks", () => {
    const plan = buildInstallPlan(getAgentLifecycleSpec("claude"), "posix");
    expect(plan?.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan?.preview).toContain("claude.ai/install.sh");
    expect(plan?.preview).toContain("@anthropic-ai/claude-code");
    const kinds = plan?.steps.map((s) => s.kind) ?? [];
    expect(kinds).toContain("argv");
    expect(kinds).toContain("official-script");
  });

  it("prefers CLI self-update for npm-sourced installs when declared", () => {
    const plan = buildUpdatePlan(getAgentLifecycleSpec("codex"), {
      host: "posix",
      defaultBinPath: "/usr/local/bin/codex",
      installSource: "npm",
    });
    expect(plan?.steps[0]).toMatchObject({
      kind: "argv",
      file: "/usr/local/bin/codex",
      args: ["update"],
    });
    expect(
      plan?.steps.some(
        (s) =>
          s.kind === "argv" &&
          s.file === "npm" &&
          s.args.some((a) => a.includes("@openai/codex"))
      )
    ).toBe(true);
  });

  it("prefers omp update for bun/npm-sourced omp", () => {
    const plan = buildUpdatePlan(getAgentLifecycleSpec("omp"), {
      host: "posix",
      defaultBinPath: "/Users/x/.bun/bin/omp",
      installSource: "bun",
    });
    expect(plan?.steps[0]).toMatchObject({
      kind: "argv",
      file: "/Users/x/.bun/bin/omp",
      args: ["update"],
    });
  });

  it("prefers pi update --self over npm for path/npm installs", () => {
    for (const source of ["path", "npm"] as const) {
      const plan = buildUpdatePlan(getAgentLifecycleSpec("pi"), {
        host: "posix",
        defaultBinPath: "/Users/x/.local/bin/pi",
        installSource: source,
      });
      expect(plan?.steps[0]).toMatchObject({
        kind: "argv",
        file: "/Users/x/.local/bin/pi",
        args: ["update", "--self"],
      });
    }
  });

  it("installs pi npm with official --ignore-scripts", () => {
    const plan = buildInstallPlan(getAgentLifecycleSpec("pi"), "posix", {
      installSource: "npm",
    });
    expect(plan?.preview).toContain("@earendil-works/pi-coding-agent@latest");
    expect(plan?.preview).toContain("--ignore-scripts");
  });

  it("installs kimi via native kimi-code script, not deprecated python installer", () => {
    const plan = buildInstallPlan(getAgentLifecycleSpec("kimi"), "posix");
    expect(plan?.steps[0]).toMatchObject({
      kind: "official-script",
      url: "https://code.kimi.com/kimi-code/install.sh",
    });
    expect(plan?.preview).toContain("@moonshot-ai/kimi-code");
    expect(plan?.preview).not.toContain("https://code.kimi.com/install.sh");
  });

  it("prefers official kimi-code script for path-sourced kimi (not deprecated python installer)", () => {
    const kimi = buildUpdatePlan(getAgentLifecycleSpec("kimi"), {
      host: "posix",
      defaultBinPath: "/Users/x/.kimi-code/bin/kimi",
      installSource: "path",
    });
    expect(kimi?.steps[0]).toMatchObject({
      kind: "official-script",
      url: "https://code.kimi.com/kimi-code/install.sh",
    });
    expect(kimi?.preview).toContain("code.kimi.com/kimi-code/install.sh");
    expect(kimi?.preview).not.toContain("https://code.kimi.com/install.sh");

    const cont = buildUpdatePlan(getAgentLifecycleSpec("continue"), {
      host: "posix",
      installSource: "path",
    });
    expect(cont?.steps[0]?.kind).toBe("official-script");
  });

  it("migrates leftover uv kimi-cli via official kimi-code script, not uv upgrade", () => {
    const plan = buildUpdatePlan(getAgentLifecycleSpec("kimi"), {
      host: "posix",
      defaultBinPath: "/Users/x/.local/share/uv/tools/kimi-cli/bin/kimi",
      installSource: "uv",
    });
    expect(plan?.steps[0]).toMatchObject({
      kind: "official-script",
      url: "https://code.kimi.com/kimi-code/install.sh",
    });
    expect(plan?.preview).not.toContain("uv tool upgrade");
  });

  it("uses npm-latest first for npm-sourced droid (self refuses npm)", () => {
    const plan = buildUpdatePlan(getAgentLifecycleSpec("droid"), {
      host: "posix",
      defaultBinPath: "/Users/x/.nvm/versions/node/v24/bin/droid",
      installSource: "npm",
    });
    expect(plan?.steps[0]).toMatchObject({
      kind: "argv",
      file: "npm",
    });
    expect(plan?.preview).toContain("@factory/cli@latest");
  });

  it("uses reinstall for path-sourced mimo (self curl upgrade unsupported)", () => {
    const plan = buildUpdatePlan(getAgentLifecycleSpec("mimo-code"), {
      host: "posix",
      defaultBinPath: "/Users/x/.mimocode/bin/mimo",
      installSource: "path",
    });
    expect(plan?.steps[0]?.kind).toBe("official-script");
    expect(plan?.preview).toContain("mimo.xiaomi.com");
  });

  it("prefers CLI self-update for path/script installs when declared", () => {
    const plan = buildUpdatePlan(getAgentLifecycleSpec("codex"), {
      host: "posix",
      defaultBinPath: "/opt/home/codex",
      installSource: "path",
    });
    expect(plan?.steps[0]).toMatchObject({
      kind: "argv",
      file: "/opt/home/codex",
      args: ["update"],
    });
    // Fallbacks kept for runner retry (npm / reinstall).
    expect(plan?.steps.length).toBeGreaterThanOrEqual(1);
  });

  it("prefers brew upgrade for brew-sourced installs", () => {
    const plan = buildUpdatePlan(getAgentLifecycleSpec("crush"), {
      host: "posix",
      installSource: "brew",
    });
    expect(plan?.steps[0]).toMatchObject({
      kind: "argv",
      file: "brew",
      args: expect.arrayContaining(["upgrade"]),
    });
  });

  it("reads installed brew cask/formula token from Cellar/Caskroom paths", () => {
    expect(
      brewPackageTokenFromBinPath(
        "/opt/homebrew/Caskroom/claude-code@latest/2.1.221/claude"
      )
    ).toBe("claude-code@latest");
    expect(
      brewPackageTokenFromBinPath(
        "/opt/homebrew/Caskroom/claude-code/2.0.0/claude"
      )
    ).toBe("claude-code");
    expect(
      brewPackageTokenFromBinPath(
        "/opt/homebrew/Cellar/block-goose-cli/1.2.3/bin/goose"
      )
    ).toBe("block-goose-cli");
    expect(brewPackageTokenFromBinPath("/usr/local/bin/claude")).toBeNull();
  });

  it("upgrades tapped brew formula with tap-qualified token (opencode)", () => {
    const plan = buildUpdatePlan(getAgentLifecycleSpec("opencode"), {
      host: "posix",
      defaultBinPath: "/opt/homebrew/Cellar/opencode/1.18.14/bin/opencode",
      installSource: "brew",
    });
    expect(plan?.steps[0]).toMatchObject({
      kind: "argv",
      file: "brew",
      args: ["upgrade", "anomalyco/tap/opencode"],
    });
  });

  it("upgrades the installed cask variant (claude-code@latest ≠ claude-code)", () => {
    // Cask upgrade is darwin-only in plan build (Linux CI has no Homebrew Cask).
    if (process.platform !== "darwin") {
      return;
    }
    const plan = buildUpdatePlan(getAgentLifecycleSpec("claude"), {
      host: "posix",
      defaultBinPath:
        "/opt/homebrew/Caskroom/claude-code@latest/2.1.221/claude",
      installSource: "brew",
    });
    expect(plan?.steps[0]).toMatchObject({
      kind: "argv",
      file: "brew",
      args: ["upgrade", "--cask", "claude-code@latest"],
    });
  });

  it("uses brew cask upgrade first for brew-sourced claude (no npm dual-install)", () => {
    const plan = buildUpdatePlan(getAgentLifecycleSpec("claude"), {
      host: "posix",
      defaultBinPath: "/opt/homebrew/bin/claude",
      installSource: "brew",
    });
    if (process.platform === "darwin") {
      expect(plan?.steps[0]).toMatchObject({
        kind: "argv",
        file: "brew",
        args: expect.arrayContaining(["upgrade", "--cask"]),
      });
    } else {
      // Non-darwin: cask channel dropped; self-update is first.
      expect(plan?.steps[0]).toMatchObject({
        kind: "argv",
        file: "/opt/homebrew/bin/claude",
        args: ["update"],
      });
    }
    // If cask is not actually installed, runner can fall through to self.
    expect(
      plan?.steps.some(
        (s) =>
          s.kind === "argv" &&
          s.file === "/opt/homebrew/bin/claude" &&
          s.args[0] === "update"
      )
    ).toBe(true);
    // Cross-ecosystem npm must not appear — would dual-install beside brew.
    expect(
      plan?.steps.some(
        (s) =>
          s.kind === "argv" &&
          s.file === "npm" &&
          s.args.some((a) => a.includes("@anthropic-ai/claude-code"))
      )
    ).toBe(false);
    // Brew spec has a brew channel, so empty reinstall filter must skip
    // rather than dump npm. kimi has no uv channel (leftover migrate).
    expect(
      sourceHasMatchingInstallChannel(
        getAgentLifecycleSpec("claude").install,
        "brew"
      )
    ).toBe(true);
    expect(
      sourceHasMatchingInstallChannel(
        getAgentLifecycleSpec("kimi").install,
        "uv"
      )
    ).toBe(false);
  });

  it("uses self-update for path-sourced claude under homebrew bin prefix", () => {
    // Mis-detecting /opt/homebrew/bin as brew caused "Cask not installed".
    const plan = buildUpdatePlan(getAgentLifecycleSpec("claude"), {
      host: "posix",
      defaultBinPath: "/opt/homebrew/bin/claude",
      installSource: "path",
    });
    expect(plan?.steps[0]).toMatchObject({
      kind: "argv",
      file: "/opt/homebrew/bin/claude",
      args: ["update"],
    });
  });

  it("plans cursor update via install script first (self needs auth)", () => {
    const plan = buildUpdatePlan(getAgentLifecycleSpec("cursor"), {
      host: "posix",
      defaultBinPath: "/Users/x/.local/bin/cursor-agent",
      installSource: "path",
    });
    expect(plan).not.toBeNull();
    // Official script reinstall first — `agent update` exits 0 unauthenticated.
    expect(plan?.steps[0]?.kind).toBe("official-script");
    expect(plan?.preview).toContain("cursor.com");
    expect(
      plan?.steps.some(
        (s) =>
          s.kind === "argv" &&
          s.file.endsWith("cursor-agent") &&
          s.args[0] === "update"
      )
    ).toBe(true);
  });

  it("plans kiro self-update then script reinstall; antigravity via script", () => {
    const kiro = buildUpdatePlan(getAgentLifecycleSpec("kiro"), {
      host: "posix",
      defaultBinPath: "/Users/x/.local/bin/kiro-cli",
      installSource: "path",
    });
    expect(kiro?.steps[0]).toMatchObject({
      kind: "argv",
      file: "/Users/x/.local/bin/kiro-cli",
      args: ["update", "--non-interactive"],
    });
    expect(kiro?.steps.some((s) => s.kind === "official-script")).toBe(true);

    const antigravity = buildUpdatePlan(getAgentLifecycleSpec("antigravity"), {
      host: "posix",
      installSource: "path",
    });
    expect(antigravity).not.toBeNull();
    expect(antigravity?.steps.some((s) => s.kind === "official-script")).toBe(
      true
    );
  });

  it("uses brew cask upgrade for brew-sourced copilot and devin", () => {
    if (process.platform !== "darwin") {
      return;
    }
    expect(
      buildUpdatePlan(getAgentLifecycleSpec("copilot"), {
        host: "posix",
        installSource: "brew",
      })?.preview
    ).toContain("brew upgrade --cask copilot-cli");
    expect(
      buildUpdatePlan(getAgentLifecycleSpec("devin"), {
        host: "posix",
        installSource: "brew",
      })?.preview
    ).toContain("brew upgrade --cask devin-cli");
  });

  it("uses brew cask install as default for brew-sourced claude install cmd", () => {
    if (process.platform !== "darwin") {
      return;
    }
    const plan = buildInstallPlan(getAgentLifecycleSpec("claude"), "posix", {
      installSource: "brew",
    });
    expect(plan?.preview).toContain("brew install --cask claude-code");
  });

  it("uses omp self-update for path/script installs", () => {
    const plan = buildUpdatePlan(getAgentLifecycleSpec("omp"), {
      host: "posix",
      defaultBinPath: "/Users/x/.local/bin/omp",
      installSource: "path",
    });
    expect(plan?.steps[0]).toMatchObject({
      kind: "argv",
      file: "/Users/x/.local/bin/omp",
      args: ["update"],
    });
    expect(plan?.preview).toMatch(/omp update/);
  });

  it("UI default commands hide absolute bin path prefixes", async () => {
    const { defaultCommandsFor } = await import(
      "../../../../../src/main/services/agents/lifecycle/defaults.ts"
    );
    const { defaultUpdateCommand } = defaultCommandsFor(
      "omp",
      "path",
      "/Users/xyz/.nvm/versions/node/v24.15.0/bin/omp"
    );
    expect(defaultUpdateCommand).toMatch(/^omp update/);
    expect(defaultUpdateCommand).not.toContain("/Users/");
    expect(defaultUpdateCommand).not.toContain(".nvm");
  });

  it("plan.preview is UI-safe even when steps use absolute self bins", () => {
    const plan = buildUpdatePlan(getAgentLifecycleSpec("codex"), {
      host: "posix",
      defaultBinPath: "/opt/home/codex",
      installSource: "path",
    });
    expect(plan?.steps[0]).toMatchObject({
      kind: "argv",
      file: "/opt/home/codex",
    });
    expect(plan?.preview.startsWith("codex update")).toBe(true);
    expect(plan?.preview).not.toContain("/opt/home/");
  });

  it("returns null install for guided agents", () => {
    expect(
      buildInstallCommand(getAgentLifecycleSpec("rovo"), "posix")
    ).toBeNull();
  });

  it("rejects non-allowlisted script hosts", () => {
    expect(() =>
      assertAllowedScriptUrl("https://evil.example/install.sh")
    ).toThrow(/not allowed/);
  });

  it("detects WSL unc paths for plan wrapping", () => {
    expect(
      wslDistroFromPath("\\\\wsl$\\Ubuntu\\home\\u\\.local\\bin\\claude")
    ).toBe("Ubuntu");
  });

  it("skips brew channels on Windows (npm/script still planned)", () => {
    const crush = buildInstallPlan(getAgentLifecycleSpec("crush"), "win");
    expect(crush?.preview).not.toContain("brew");
    expect(crush?.preview).toContain("@charmland/crush");

    const goose = buildInstallPlan(getAgentLifecycleSpec("goose"), "win");
    expect(goose?.preview).not.toContain("brew");
    expect(goose?.preview).toContain("download_cli.ps1");
  });

  it("plans aider with official script, uv, pipx, and brew fallbacks", () => {
    const plan = buildInstallPlan(getAgentLifecycleSpec("aider"), "posix");
    expect(plan).not.toBeNull();
    expect(plan?.preview).toContain("aider.chat/install.sh");
    expect(plan?.preview).toContain("uv tool install aider-chat@latest");
    expect(plan?.preview).toContain("pipx install aider-chat");
    expect(plan?.preview).toContain("brew install aider");
    const files = (plan?.steps ?? [])
      .filter((s) => s.kind === "argv")
      .map((s) => (s.kind === "argv" ? s.file : ""));
    expect(files).toEqual(["uv", "pipx", "brew"]);
  });

  it("plans mistral-vibe with uv before pipx", () => {
    const plan = buildInstallPlan(
      getAgentLifecycleSpec("mistral-vibe"),
      "posix"
    );
    expect(plan?.preview).toContain("mistral.ai/vibe/install.sh");
    expect(plan?.preview).toContain("uv tool install mistral-vibe@latest");
    expect(plan?.preview).toContain("pipx install mistral-vibe");
  });

  it("plans install for full agents", () => {
    const planned = planLifecycle(getAgentLifecycleSpec("gemini"), "install");
    expect(planned?.preview).toContain("@google/gemini-cli");
  });

  it("builds guide commands from the same install channels as run", () => {
    const guides = buildGuideCommands(getAgentLifecycleSpec("codex"), "posix");
    expect(guides.some((g) => g.command.includes("@openai/codex"))).toBe(true);
  });
});
