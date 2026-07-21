import { createSkillDiscoveryAdapterRegistry } from "@main/services/project-skills/adapters.ts";
import {
  deriveEffectiveMatrix,
  deriveUserGlobalEffects,
  unmanagedKey,
} from "@main/services/project-skills/effective-matrix.ts";
import { describe, expect, it } from "vitest";

const registry = createSkillDiscoveryAdapterRegistry();

function cellFor(
  cells: ReturnType<typeof deriveEffectiveMatrix>["managedEffects"],
  skillId: string,
  agentKind: string
) {
  const cell = cells.get(skillId)?.find((c) => c.agentKind === agentKind);
  if (!cell) throw new Error(`missing cell ${skillId}/${agentKind}`);
  return cell.effect;
}

describe("project-skills effective matrix (v8 §5.1)", () => {
  it("derives discoverable per agent from owned projections", () => {
    const result = deriveEffectiveMatrix({
      registry,
      managed: [
        {
          skillId: "review-guide",
          enabled: true,
          projectedRoots: [".agents/skills"],
        },
      ],
      unmanaged: [],
      userGlobal: [],
    });
    expect(cellFor(result.managedEffects, "review-guide", "codex")).toEqual({
      state: "discoverable",
      viaRoot: ".agents/skills",
    });
    // Claude only scans .claude/skills — not projected there.
    expect(cellFor(result.managedEffects, "review-guide", "claude")).toEqual({
      state: "not-projected",
    });
  });

  it("Claude user-global same-name shadows the project skill (verified fact: enterprise > user > project)", () => {
    const result = deriveEffectiveMatrix({
      registry,
      managed: [
        {
          skillId: "review-guide",
          enabled: true,
          projectedRoots: [".agents/skills", ".claude/skills"],
        },
      ],
      unmanaged: [],
      userGlobal: [{ root: "~/.claude/skills", directoryName: "review-guide" }],
    });
    const claude = cellFor(result.managedEffects, "review-guide", "claude");
    expect(claude.state).toBe("shadowed-by-user");
    // Other user-shadows scanners reading ~/.claude/skills (Amp, Auggie)
    // may also report shadowing; the Claude fact must be present.
    expect(result.shadowedManaged).toContainEqual({
      skillId: "review-guide",
      agentKind: "claude",
      userRoot: "~/.claude/skills",
    });
    for (const shadow of result.shadowedManaged) {
      expect(shadow.userRoot).toBe("~/.claude/skills");
    }
  });

  it("OpenCode: a skill's own dual projection stays discoverable via its winning copy", () => {
    // Both copies belong to the SAME managed skill — priority resolution
    // between them is not an override of the row (self-override is
    // meaningless to the user).
    const result = deriveEffectiveMatrix({
      registry,
      managed: [
        {
          skillId: "review-guide",
          enabled: true,
          projectedRoots: [".agents/skills", ".claude/skills"],
        },
      ],
      unmanaged: [],
      userGlobal: [],
    });
    const opencode = cellFor(result.managedEffects, "review-guide", "opencode");
    expect(opencode.state).toBe("discoverable");
    if (opencode.state === "discoverable") {
      // Row's own best copy in OpenCode precedence (.agents > .claude).
      expect(opencode.viaRoot).toBe(".agents/skills");
    }
  });

  it("OpenCode: an unmanaged higher-priority copy overrides the managed projection", () => {
    const result = deriveEffectiveMatrix({
      registry,
      managed: [
        {
          skillId: "review-guide",
          enabled: true,
          projectedRoots: [".agents/skills"],
        },
      ],
      unmanaged: [{ root: ".opencode/skills", directoryName: "review-guide" }],
      userGlobal: [],
    });
    const opencode = cellFor(result.managedEffects, "review-guide", "opencode");
    expect(opencode.state).toBe("overridden");
    if (opencode.state === "overridden") {
      expect(opencode.overriddenByRoot).toBe(".opencode/skills");
      expect(opencode.viaRoot).toBe(".agents/skills");
    }
  });

  it("a same-named unmanaged directory never makes an unprojected managed row discoverable (§5.1 ownership join)", () => {
    const result = deriveEffectiveMatrix({
      registry,
      managed: [
        {
          skillId: "review-guide",
          enabled: false,
          projectedRoots: [],
        },
      ],
      unmanaged: [{ root: ".agents/skills", directoryName: "review-guide" }],
      userGlobal: [],
    });
    for (const agent of ["codex", "opencode", "cursor", "claude"]) {
      const cell = cellFor(result.managedEffects, "review-guide", agent);
      expect(cell.state).toBe("not-projected");
    }
    // The unmanaged row itself IS discoverable via its real directory.
    const unmanagedCodex = cellFor(
      result.unmanagedEffects,
      ".agents/skills/review-guide",
      "codex"
    );
    expect(unmanagedCodex.state).not.toBe("not-projected");
  });

  it("Cursor multi-root scan reports duplicates when both roots carry the name", () => {
    const result = deriveEffectiveMatrix({
      registry,
      managed: [
        {
          skillId: "review-guide",
          enabled: true,
          projectedRoots: [".agents/skills", ".claude/skills"],
        },
      ],
      unmanaged: [],
      userGlobal: [],
    });
    const cursor = cellFor(result.managedEffects, "review-guide", "cursor");
    expect(cursor.state).toBe("duplicate");
  });

  it("unmanaged entries report root-not-scanned for agents that never read that root", () => {
    const result = deriveEffectiveMatrix({
      registry,
      managed: [],
      unmanaged: [{ root: ".claude/skills", directoryName: "legacy-notes" }],
      userGlobal: [],
    });
    const cells = result.unmanagedEffects.get(
      unmanagedKey(".claude/skills", "legacy-notes")
    );
    const codex = cells?.find((c) => c.agentKind === "codex")?.effect;
    const claude = cells?.find((c) => c.agentKind === "claude")?.effect;
    expect(codex).toEqual({ state: "root-not-scanned" });
    expect(claude?.state).toBe("discoverable");
  });

  it("user-global rows: Claude same-name stays discoverable (personal wins)", () => {
    const cells = deriveUserGlobalEffects({
      registry,
      root: "~/.claude/skills",
      directoryName: "review-guide",
      managed: [
        {
          skillId: "review-guide",
          enabled: true,
          projectedRoots: [".agents/skills", ".claude/skills"],
        },
      ],
      unmanaged: [],
    });
    const claude = cells.find((c) => c.agentKind === "claude")?.effect;
    expect(claude).toEqual({
      state: "discoverable",
      viaRoot: "~/.claude/skills",
    });
  });

  it("user-global rows: OpenCode same-name is overridden by the project copy", () => {
    const cells = deriveUserGlobalEffects({
      registry,
      root: "~/.config/opencode/skills",
      directoryName: "review-guide",
      managed: [],
      unmanaged: [{ root: ".opencode/skills", directoryName: "review-guide" }],
    });
    const opencode = cells.find((c) => c.agentKind === "opencode")?.effect;
    expect(opencode?.state).toBe("overridden");
  });

  it("user-global rows: Cursor same-name surfaces as duplicate", () => {
    const cells = deriveUserGlobalEffects({
      registry,
      root: "~/.cursor/skills",
      directoryName: "review-guide",
      managed: [
        {
          skillId: "review-guide",
          enabled: true,
          projectedRoots: [".agents/skills"],
        },
      ],
      unmanaged: [],
    });
    const cursor = cells.find((c) => c.agentKind === "cursor")?.effect;
    expect(cursor?.state).toBe("duplicate");
  });

  it("user-global rows: agents that never read the root get no cell", () => {
    const cells = deriveUserGlobalEffects({
      registry,
      root: "~/.claude/skills",
      directoryName: "review-guide",
      managed: [],
      unmanaged: [],
    });
    const kinds = cells.map((c) => c.agentKind);
    // ~/.claude/skills is not a Codex user root — no cell for codex.
    expect(kinds).not.toContain("codex");
    expect(kinds).toContain("claude");
    // Non-consuming registered agents (private roots only) never get cells.
    expect(kinds).not.toContain("kiro");
  });

  it("user-global rows: installedAgents facts map to agent-not-installed", () => {
    const cells = deriveUserGlobalEffects({
      registry,
      root: "~/.claude/skills",
      directoryName: "review-guide",
      managed: [],
      unmanaged: [],
      installedAgents: new Set(["codex"]),
    });
    const claude = cells.find((c) => c.agentKind === "claude")?.effect;
    expect(claude).toEqual({ state: "agent-not-installed" });
  });

  it("agent installation facts map to agent-not-installed", () => {
    const result = deriveEffectiveMatrix({
      registry,
      managed: [
        {
          skillId: "review-guide",
          enabled: true,
          projectedRoots: [".agents/skills"],
        },
      ],
      unmanaged: [],
      userGlobal: [],
      installedAgents: new Set(["claude"]),
    });
    expect(cellFor(result.managedEffects, "review-guide", "codex")).toEqual({
      state: "agent-not-installed",
    });
  });
});
