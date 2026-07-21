import type {
  SkillAgentEffect,
  SkillEffectiveCell,
} from "../../../shared/contracts/project-skills.ts";
import type {
  SkillDiscoveryAdapter,
  SkillDiscoveryAdapterRegistry,
} from "./adapters.ts";

/**
 * Effective-matrix derivation (design v8 §5.1): a pure function from a
 * filesystem snapshot to per (skill × agent) effective states, including
 * layer-3 shadowing/override facts. Never touches disk, never blocks —
 * layer-3 facts map to notices only.
 */

export interface MatrixManagedSkill {
  enabled: boolean;
  /** Project-relative roots where an owned projection link actually exists. */
  projectedRoots: readonly string[];
  skillId: string;
}

export interface MatrixUnmanagedSkill {
  directoryName: string;
  /** Discovery root the directory lives in, e.g. `.claude/skills`. */
  root: string;
}

export interface MatrixUserGlobalSkill {
  directoryName: string;
  /** `~`-relative user root, e.g. `~/.claude/skills`. */
  root: string;
}

export interface EffectiveMatrixInput {
  /** Installed agent ids; when omitted, installation state is not asserted. */
  installedAgents?: ReadonlySet<string>;
  managed: readonly MatrixManagedSkill[];
  registry: SkillDiscoveryAdapterRegistry;
  unmanaged: readonly MatrixUnmanagedSkill[];
  userGlobal: readonly MatrixUserGlobalSkill[];
}

export interface EffectiveMatrixResult {
  managedEffects: Map<string, SkillEffectiveCell[]>;
  /**
   * Managed skills whose projection is shadowed by a same-named user-global
   * skill for a `user-shadows-project` agent. Surfaced via effect state
   * `shadowed-by-user` (not a duplicate health issue).
   */
  shadowedManaged: Array<{
    skillId: string;
    agentKind: string;
    userRoot: string;
  }>;
  unmanagedEffects: Map<string, SkillEffectiveCell[]>;
}

export function unmanagedKey(root: string, directoryName: string): string {
  return `${root}/${directoryName}`;
}

function agentInstalled(
  input: EffectiveMatrixInput,
  agentKind: string
): boolean | null {
  if (!input.installedAgents) return null;
  return input.installedAgents.has(agentKind);
}

/**
 * Project roots (adapter order = precedence) where the NAME is present for
 * this agent, regardless of which row owns the presence. Used to resolve
 * same-name precedence between a row's own copy and other copies.
 */
function presentProjectRoots(
  adapter: SkillDiscoveryAdapter,
  name: string,
  input: EffectiveMatrixInput,
  ownRoots: readonly string[]
): string[] {
  const present: string[] = [];
  for (const root of adapter.discoveryRoots) {
    const ownHit = ownRoots.includes(root);
    const unmanagedHit = input.unmanaged.some(
      (u) => u.root === root && u.directoryName === name
    );
    const managedHit = input.managed.some(
      (m) => m.skillId === name && m.projectedRoots.includes(root)
    );
    if (ownHit || unmanagedHit || managedHit) {
      present.push(root);
    }
  }
  return present;
}

function userRootsWithName(
  adapter: SkillDiscoveryAdapter,
  name: string,
  input: EffectiveMatrixInput
): string[] {
  return adapter.userDiscoveryRoots.filter((root) =>
    input.userGlobal.some((g) => g.root === root && g.directoryName === name)
  );
}

function deriveEffect(args: {
  adapter: SkillDiscoveryAdapter;
  name: string;
  input: EffectiveMatrixInput;
  /** Managed skill's own projections, or null for unmanaged rows. */
  managedProjectedRoots: readonly string[] | null;
  /** For unmanaged rows: the root the directory actually lives in. */
  unmanagedRoot?: string;
}): SkillAgentEffect {
  const { adapter, name, input } = args;

  const installed = agentInstalled(input, adapter.agentKind);
  if (installed === false) {
    return { state: "agent-not-installed" };
  }
  if (!adapter.consumesProjectSkills) {
    return { state: "not-applicable" };
  }

  // Unmanaged row living in a root this agent never scans.
  if (
    args.unmanagedRoot !== undefined &&
    !adapter.discoveryRoots.includes(args.unmanagedRoot)
  ) {
    return { state: "root-not-scanned" };
  }

  // The ROW's own copies visible to this agent (design §5.1: managed
  // classification joins ownership — a same-named unmanaged directory never
  // makes an unprojected managed row "discoverable").
  const ownRoots =
    args.unmanagedRoot === undefined
      ? (args.managedProjectedRoots ?? []).filter((root) =>
          adapter.discoveryRoots.includes(root)
        )
      : [args.unmanagedRoot];
  if (ownRoots.length === 0) {
    return { state: "not-projected" };
  }
  // Row's own best copy in this agent's precedence order.
  const viaRoot =
    adapter.discoveryRoots.find((root) => ownRoots.includes(root)) ??
    ownRoots[0]!;

  const allRoots = presentProjectRoots(adapter, name, input, ownRoots);
  const userRoots = userRootsWithName(adapter, name, input);
  const winner = allRoots[0] ?? viaRoot;
  const ownWins = ownRoots.includes(winner);

  switch (adapter.duplicateSemantics) {
    case "user-shadows-project": {
      if (userRoots.length > 0) {
        return {
          state: "shadowed-by-user",
          viaRoot,
          shadowedByRoot: userRoots[0]!,
        };
      }
      return { state: "discoverable", viaRoot };
    }
    case "priority-override": {
      // Deterministic override: the highest-priority copy wins. Losing
      // copies report which root overrides them; the winner stays
      // discoverable even when extra copies exist.
      if (!ownWins) {
        return {
          state: "overridden",
          viaRoot,
          overriddenByRoot: winner,
        };
      }
      return { state: "discoverable", viaRoot };
    }
    case "coexist":
    case "multi-root-scan": {
      const all = [...allRoots, ...userRoots];
      if (all.length > 1) {
        return { state: "duplicate", roots: all };
      }
      return { state: "discoverable", viaRoot };
    }
    default: {
      return { state: "discoverable", viaRoot };
    }
  }
}

/**
 * Effects for a user-global (layer 3) row in the unified list: which agents
 * read that user root, and what same-name precedence does to it (verified
 * facts §2.2: Claude personal wins; OpenCode project wins; Codex/Cursor
 * surface duplicates). Only agents that actually read the root get a cell.
 */
export function deriveUserGlobalEffects(args: {
  registry: SkillDiscoveryAdapterRegistry;
  root: string;
  directoryName: string;
  managed: readonly MatrixManagedSkill[];
  unmanaged: readonly MatrixUnmanagedSkill[];
  installedAgents?: ReadonlySet<string> | undefined;
}): SkillEffectiveCell[] {
  const cells: SkillEffectiveCell[] = [];
  for (const adapter of args.registry.list()) {
    if (!adapter.consumesProjectSkills) continue;
    if (!adapter.userDiscoveryRoots.includes(args.root)) continue;
    if (args.installedAgents && !args.installedAgents.has(adapter.agentKind)) {
      cells.push({
        agentKind: adapter.agentKind,
        effect: { state: "agent-not-installed" },
      });
      continue;
    }
    const projectHasSameName =
      args.managed.some(
        (m) =>
          m.skillId === args.directoryName &&
          m.projectedRoots.some((root) => adapter.discoveryRoots.includes(root))
      ) ||
      args.unmanaged.some(
        (u) =>
          u.directoryName === args.directoryName &&
          adapter.discoveryRoots.includes(u.root)
      );
    if (!projectHasSameName) {
      cells.push({
        agentKind: adapter.agentKind,
        effect: { state: "discoverable", viaRoot: args.root },
      });
      continue;
    }
    switch (adapter.duplicateSemantics) {
      case "user-shadows-project":
        // Personal wins (Claude documented precedence) — still discoverable.
        cells.push({
          agentKind: adapter.agentKind,
          effect: { state: "discoverable", viaRoot: args.root },
        });
        break;
      case "priority-override": {
        // The overriding root is the actual highest-precedence project copy,
        // not just the adapter's first configured root.
        const winningRoot =
          adapter.discoveryRoots.find(
            (root) =>
              args.managed.some(
                (m) =>
                  m.skillId === args.directoryName &&
                  m.projectedRoots.includes(root)
              ) ||
              args.unmanaged.some(
                (u) => u.directoryName === args.directoryName && u.root === root
              )
          ) ??
          adapter.discoveryRoots[0] ??
          "";
        cells.push({
          agentKind: adapter.agentKind,
          effect: {
            state: "overridden",
            viaRoot: args.root,
            overriddenByRoot: winningRoot,
          },
        });
        break;
      }
      default:
        cells.push({
          agentKind: adapter.agentKind,
          effect: {
            state: "duplicate",
            roots: [args.root, ...adapter.discoveryRoots],
          },
        });
        break;
    }
  }
  return cells;
}

export function deriveEffectiveMatrix(
  input: EffectiveMatrixInput
): EffectiveMatrixResult {
  const adapters = input.registry
    .list()
    .filter((adapter) => adapter.consumesProjectSkills);

  const managedEffects = new Map<string, SkillEffectiveCell[]>();
  const shadowedManaged: EffectiveMatrixResult["shadowedManaged"] = [];

  for (const skill of input.managed) {
    const cells: SkillEffectiveCell[] = [];
    for (const adapter of adapters) {
      const effect = deriveEffect({
        adapter,
        name: skill.skillId,
        input,
        managedProjectedRoots: skill.projectedRoots,
      });
      cells.push({ agentKind: adapter.agentKind, effect });
      if (effect.state === "shadowed-by-user" && skill.enabled) {
        shadowedManaged.push({
          skillId: skill.skillId,
          agentKind: adapter.agentKind,
          userRoot: effect.shadowedByRoot,
        });
      }
    }
    managedEffects.set(skill.skillId, cells);
  }

  const unmanagedEffects = new Map<string, SkillEffectiveCell[]>();
  for (const entry of input.unmanaged) {
    const cells: SkillEffectiveCell[] = [];
    for (const adapter of adapters) {
      cells.push({
        agentKind: adapter.agentKind,
        effect: deriveEffect({
          adapter,
          name: entry.directoryName,
          input,
          managedProjectedRoots: null,
          unmanagedRoot: entry.root,
        }),
      });
    }
    unmanagedEffects.set(unmanagedKey(entry.root, entry.directoryName), cells);
  }

  return { managedEffects, unmanagedEffects, shadowedManaged };
}
