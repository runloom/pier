import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_LATEST_HOSTS } from "../../../../../src/main/services/agents/lifecycle/latest-hosts.ts";
import { listAgentLifecycleSpecs } from "../../../../../src/main/services/agents/lifecycle/specs/index.ts";
import {
  type AgentLatestProbe,
  resolveUpdateMode,
} from "../../../../../src/main/services/agents/lifecycle/specs/types.ts";

const GOLD_SPEC = join(
  process.cwd(),
  "docs/superpowers/specs/2026-08-29-agent-latest-version-gold-standard.md"
);
const AGENTS_MD = join(process.cwd(), "AGENTS.md");
const SOURCE_POLICY = join(
  process.cwd(),
  "src/main/services/agents/lifecycle/plan/source-policy.ts"
);
const LATEST_TS = join(
  process.cwd(),
  "src/main/services/agents/lifecycle/latest.ts"
);
const LATEST_BREW = join(
  process.cwd(),
  "src/main/services/agents/lifecycle/latest-brew.ts"
);

function probeHost(probe: AgentLatestProbe): string {
  return new URL(probe.url).hostname;
}

function versionedHasSameLineLatestSource(
  spec: ReturnType<typeof listAgentLifecycleSpecs>[number]
): boolean {
  if (resolveUpdateMode(spec) !== "versioned") {
    return true;
  }
  if (spec.latestProbe) {
    return true;
  }
  if (spec.npmPackageForLatest || spec.install.some((c) => c.kind === "npm")) {
    return true;
  }
  if (spec.install.some((c) => c.kind === "brew")) {
    return true;
  }
  if (spec.install.some((c) => c.kind === "uv" || c.kind === "pipx")) {
    return true;
  }
  return false;
}

describe("agent latest-version gold-standard governance", () => {
  it("locks the gold-standard doc and AGENTS.md checkpoint section", () => {
    const gold = readFileSync(GOLD_SPEC, "utf8");
    expect(gold).toContain("智能体最新版本检测与更新金标准");
    expect(gold).toContain("formulae.brew.sh");
    expect(gold).toContain("latestCheckFailed");
    const agents = readFileSync(AGENTS_MD, "utf8");
    expect(agents).toContain("智能体 CLI 版本检测与更新 — 金标准");
    expect(agents).toContain(
      "2026-08-29-agent-latest-version-gold-standard.md"
    );
  });

  it("brew update priority excludes npm-latest (no dual-install)", () => {
    const src = readFileSync(SOURCE_POLICY, "utf8");
    expect(src).toMatch(
      /brew:\s*\[["']brew-upgrade["'],\s*["']self["'],\s*["']reinstall["']\]/
    );
    expect(src).not.toMatch(/brew:\s*\[[^\]]*npm-latest/);
  });

  it("core brew tokens do not fall back to local brew info", () => {
    const src = readFileSync(LATEST_BREW, "utf8");
    expect(src).toContain("export function isBrewCoreToken");
    expect(src).toMatch(
      /if\s*\(\s*!isBrewCoreToken\(name\)\s*\)\s*\{\s*return fetchBrewLocalInfo/
    );
  });

  it("latest cache TTL aligns with catalog remote (10 min) and short miss (60s)", () => {
    const src = readFileSync(LATEST_TS, "utf8");
    expect(src).toContain("CACHE_TTL_OK_MS = 10 * 60 * 1000");
    expect(src).toContain("CACHE_TTL_MISS_MS = 60 * 1000");
  });

  it("every versioned full agent has a same-line latest source", () => {
    for (const spec of listAgentLifecycleSpecs()) {
      if (spec.support !== "full") {
        continue;
      }
      expect(
        versionedHasSameLineLatestSource(spec),
        `${spec.agentId} is versioned without npm/brew/PyPI/latestProbe`
      ).toBe(true);
    }
  });

  it("goose path installs declare GitHub latestProbe (not brew-only)", () => {
    const goose = listAgentLifecycleSpecs().find((s) => s.agentId === "goose");
    expect(goose?.latestProbe?.kind).toBe("github-latest-release");
    expect(goose?.latestProbe?.url).toContain("api.github.com");
  });

  it("claude http-text probe declares stableUrl for channel awareness", () => {
    const claude = listAgentLifecycleSpecs().find(
      (s) => s.agentId === "claude"
    );
    expect(claude?.latestProbe?.kind).toBe("http-text");
    if (claude?.latestProbe?.kind === "http-text") {
      expect(claude.latestProbe.stableUrl).toContain(
        "claude-code-releases/stable"
      );
    }
  });

  it("latestProbe hosts are allowlisted", () => {
    for (const spec of listAgentLifecycleSpecs()) {
      if (!spec.latestProbe) {
        continue;
      }
      expect(
        ALLOWED_LATEST_HOSTS.has(probeHost(spec.latestProbe)),
        `${spec.agentId} latestProbe host not allowlisted`
      ).toBe(true);
      if (spec.latestProbe.kind === "http-text" && spec.latestProbe.stableUrl) {
        expect(
          ALLOWED_LATEST_HOSTS.has(new URL(spec.latestProbe.stableUrl).hostname)
        ).toBe(true);
      }
    }
  });
});
