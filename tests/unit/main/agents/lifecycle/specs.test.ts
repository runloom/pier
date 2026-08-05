import { agentKindSchema } from "@shared/contracts/agent.ts";
import { describe, expect, it } from "vitest";
import { buildGuideCommands } from "../../../../../src/main/services/agents/lifecycle/plan.ts";
import {
  AGENT_LIFECYCLE_SPECS,
  getAgentLifecycleSpec,
  listAgentLifecycleSpecs,
} from "../../../../../src/main/services/agents/lifecycle/specs/index.ts";
import { resolveUpdateMode } from "../../../../../src/main/services/agents/lifecycle/specs/types.ts";

describe("agent lifecycle specs", () => {
  it("covers every AgentKind exactly once in the map", () => {
    for (const id of agentKindSchema.options) {
      const spec = AGENT_LIFECYCLE_SPECS[id];
      expect(spec.agentId).toBe(id);
      expect(["full", "guided", "none"]).toContain(spec.support);
      expect(spec.expectedBins.length).toBeGreaterThan(0);
    }
    expect(listAgentLifecycleSpecs()).toHaveLength(
      agentKindSchema.options.length
    );
  });

  it("locks npm packages with scopes for high-risk agents", () => {
    const kilo = getAgentLifecycleSpec("kilo");
    const npm = kilo.install.find((c) => c.kind === "npm");
    expect(npm && npm.kind === "npm" ? npm.package : null).toBe(
      "@kilocode/cli"
    );

    const crush = getAgentLifecycleSpec("crush");
    // Never bare npm package name `crush` — only scoped @charmland/crush.
    const crushNpm = crush.install.find((c) => c.kind === "npm");
    expect(crushNpm && crushNpm.kind === "npm" ? crushNpm.package : null).toBe(
      "@charmland/crush"
    );
    expect(crush.install.some((c) => c.kind === "brew")).toBe(true);
  });

  it("locks self-update and cask channels for audited agents", () => {
    expect(
      getAgentLifecycleSpec("goose").update.some((c) => c.kind === "self")
    ).toBe(true);
    expect(
      getAgentLifecycleSpec("droid").update.some((c) => c.kind === "self")
    ).toBe(true);
    expect(
      getAgentLifecycleSpec("autohand").update.some((c) => c.kind === "self")
    ).toBe(true);
    expect(
      getAgentLifecycleSpec("omp").update.some((c) => c.kind === "self")
    ).toBe(true);
    const piSelf = getAgentLifecycleSpec("pi").update.find(
      (c) => c.kind === "self"
    );
    expect(piSelf && piSelf.kind === "self" ? [...piSelf.argv] : null).toEqual([
      "update",
      "--self",
    ]);
    // kimi upgrade is interactive — must not be primary automation path
    expect(
      getAgentLifecycleSpec("kimi").update.every((c) => c.kind !== "self")
    ).toBe(true);

    // Official docs do not support Homebrew for kiro-cli
    expect(
      getAgentLifecycleSpec("kiro").install.every((c) => c.kind !== "brew")
    ).toBe(true);
    expect(
      getAgentLifecycleSpec("copilot").update.some((c) => c.kind === "self")
    ).toBe(true);
  });

  it("marks tier-A agents as full", () => {
    for (const id of [
      "claude",
      "codex",
      "gemini",
      "grok",
      "opencode",
      "openclaw",
      "hermes",
      "kimi",
      "copilot",
      "cursor",
    ] as const) {
      expect(getAgentLifecycleSpec(id).support).toBe("full");
      expect(getAgentLifecycleSpec(id).install.length).toBeGreaterThan(0);
    }
  });

  it("supports omp with official install channels", () => {
    const omp = getAgentLifecycleSpec("omp");
    expect(omp.support).toBe("full");
    expect(omp.expectedBins).toContain("omp");
    expect(
      omp.install.some(
        (c) => c.kind === "official-script" && c.url.includes("omp.sh")
      )
    ).toBe(true);
    expect(
      omp.install.some(
        (c) => c.kind === "npm" && c.package === "@oh-my-pi/pi-coding-agent"
      )
    ).toBe(true);
  });

  it("gives aider multi-channel install including uv", () => {
    const aider = getAgentLifecycleSpec("aider");
    expect(aider.support).toBe("full");
    expect(aider.install.some((c) => c.kind === "uv")).toBe(true);
    expect(aider.install.some((c) => c.kind === "pipx")).toBe(true);
    expect(aider.install.some((c) => c.kind === "brew")).toBe(true);
    expect(
      aider.install.some(
        (c) => c.kind === "official-script" && c.url.includes("aider.chat")
      )
    ).toBe(true);
  });

  it("classifies update mode honestly", () => {
    expect(resolveUpdateMode(getAgentLifecycleSpec("codex"))).toBe("versioned");
    expect(resolveUpdateMode(getAgentLifecycleSpec("crush"))).toBe("versioned");
    // cursor is self+reinstall without npm/brew latest probe
    expect(resolveUpdateMode(getAgentLifecycleSpec("cursor"))).toBe(
      "reinstall"
    );
    expect(resolveUpdateMode(getAgentLifecycleSpec("hermes"))).toBe(
      "reinstall"
    );
    expect(resolveUpdateMode(getAgentLifecycleSpec("rovo"))).toBe("none");
  });

  it("locks critical package renames and cask flags", () => {
    const pi = getAgentLifecycleSpec("pi");
    const piNpm = pi.install.find((c) => c.kind === "npm");
    expect(piNpm && piNpm.kind === "npm" ? piNpm.package : null).toBe(
      "@earendil-works/pi-coding-agent"
    );

    const amp = getAgentLifecycleSpec("amp");
    const ampNpm = amp.install.find((c) => c.kind === "npm");
    expect(ampNpm && ampNpm.kind === "npm" ? ampNpm.package : null).toBe(
      "@ampcode/cli"
    );

    const copilotBrew = getAgentLifecycleSpec("copilot").install.find(
      (c) => c.kind === "brew"
    );
    expect(
      copilotBrew && copilotBrew.kind === "brew" ? copilotBrew.cask : null
    ).toBe(true);

    const devinBrew = getAgentLifecycleSpec("devin").install.find(
      (c) => c.kind === "brew"
    );
    expect(devinBrew && devinBrew.kind === "brew" ? devinBrew.cask : null).toBe(
      true
    );

    const cursor = getAgentLifecycleSpec("cursor");
    expect(cursor.update.some((c) => c.kind === "self")).toBe(true);
  });

  it("builds guide commands from the same install channels as run", () => {
    const guides = buildGuideCommands(getAgentLifecycleSpec("codex"), "posix");
    expect(guides.some((g) => g.command.includes("@openai/codex"))).toBe(true);
  });

  it("only leaves true website-only agents without install channels", () => {
    const websiteOnly = agentKindSchema.options.filter(
      (id) => getAgentLifecycleSpec(id).support !== "full"
    );
    expect(websiteOnly.sort()).toEqual(["ante", "openclaude", "rovo"].sort());
    for (const id of websiteOnly) {
      expect(getAgentLifecycleSpec(id).install).toEqual([]);
    }
  });
});
