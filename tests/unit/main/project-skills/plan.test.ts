import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillDiscoveryAdapterRegistry } from "@main/services/project-skills/adapters.ts";
import {
  resolveStableProjectIdentity,
  toContractProjectRootRef,
} from "@main/services/project-skills/identity.ts";
import {
  computePlanDigest,
  createProjectSkillsPlanService,
  type GitFiveState,
  normalizeProjectSkillsDraft,
  type PlanGitState,
} from "@main/services/project-skills/plan.ts";
import { computeTreeSha256V1 } from "@main/services/project-skills/tree-digest.ts";
import type {
  ProjectSkillsDraft,
  ProjectSkillsManifest,
} from "@shared/contracts/project-skills.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const _DIGEST_B = `sha256:${"c".repeat(64)}`;

let userData: string;
let projectRoot: string;

async function writeManifest(manifest: ProjectSkillsManifest): Promise<void> {
  const dir = join(projectRoot, ".pier", "skills");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

async function writeLibrarySkill(skillId: string): Promise<string> {
  const dir = join(projectRoot, ".pier", "skills", "library", skillId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${skillId}\ndescription: test skill for planning\n---\n# ${skillId}\n`,
    "utf8"
  );
  return computeTreeSha256V1(dir);
}

async function projectRef() {
  const identity = await resolveStableProjectIdentity(projectRoot);
  return toContractProjectRootRef(identity);
}

function emptyDraft(
  overrides?: Partial<ProjectSkillsDraft>
): ProjectSkillsDraft {
  return {
    deliveryAgents: true,
    deliveryClaude: false,
    deliveryBySkillId: {},
    enabledBySkillId: {},
    importTokens: [],
    deleteSkillIds: [],
    ...overrides,
  };
}

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "pier-ps-plan-ud-"));
  projectRoot = await mkdtemp(join(tmpdir(), "pier-ps-plan-proj-"));
});

afterEach(async () => {
  await rm(userData, { force: true, recursive: true });
  await rm(projectRoot, { force: true, recursive: true });
});

describe("project-skills plan", () => {
  it("normalizes draft keys and lists for stable planning input", () => {
    const normalized = normalizeProjectSkillsDraft({
      deliveryAgents: true,
      deliveryClaude: true,
      deliveryBySkillId: {},
      enabledBySkillId: { "zeta-skill": true, "alpha-skill": false },
      importTokens: ["tok-b", "tok-a"],
      deleteSkillIds: ["z-del", "a-del"],
    });
    expect(Object.keys(normalized.enabledBySkillId)).toEqual([
      "alpha-skill",
      "zeta-skill",
    ]);
    expect(normalized.importTokens).toEqual(["tok-a", "tok-b"]);
    expect(normalized.deleteSkillIds).toEqual(["a-del", "z-del"]);
  });

  it("planDigest covers normalized draft, revision, ops, git five-state, and confirmations", () => {
    const base = {
      normalizedDraft: normalizeProjectSkillsDraft(
        emptyDraft({ deliveryClaude: true, enabledBySkillId: { a: true } })
      ),
      observedRevision: "rev-1",
      targetOperations: [
        {
          kind: "create-symlink" as const,
          relativeTarget: ".agents/skills/a",
          skillId: "a",
          expectedRelativeLinkTarget: "../../.pier/skills/library/a",
        },
      ],
      gitStates: [
        {
          relativeTarget: ".agents/skills/a",
          state: "absent" as GitFiveState,
        },
      ] satisfies PlanGitState[],
      confirmationRequirements: [],
    };

    const d1 = computePlanDigest(base);
    expect(d1).toMatch(/^sha256:[a-f0-9]{64}$/);

    expect(computePlanDigest({ ...base, observedRevision: "rev-2" })).not.toBe(
      d1
    );

    expect(
      computePlanDigest({
        ...base,
        normalizedDraft: normalizeProjectSkillsDraft(
          emptyDraft({ deliveryClaude: false, enabledBySkillId: { a: true } })
        ),
      })
    ).not.toBe(d1);

    expect(
      computePlanDigest({
        ...base,
        gitStates: [{ relativeTarget: ".agents/skills/a", state: "tracked" }],
      })
    ).not.toBe(d1);

    expect(
      computePlanDigest({
        ...base,
        targetOperations: [
          {
            kind: "noop",
            relativeTarget: ".agents/skills/a",
            skillId: "a",
          },
        ],
      })
    ).not.toBe(d1);
  });

  it("rejects a stale observedRevision before returning a plan", async () => {
    const service = createProjectSkillsPlanService({
      userData,
      getObservedRevision: async () => "live-revision",
    });

    await expect(
      service.plan(await projectRef(), "stale-revision", emptyDraft())
    ).rejects.toMatchObject({
      name: "ProjectSkillsPlanStaleError",
      message: "observedRevision mismatch",
    });
  });

  it("plans create-symlink for an enabled valid skill without projection", async () => {
    await writeLibrarySkill("review-guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: false,
          source: { type: "local-import" },
        },
      ],
    });
    const gitStates = new Map<string, GitFiveState>([
      [".agents/skills/review-guide", "absent"],
    ]);
    const service = createProjectSkillsPlanService({
      userData,
      getObservedRevision: async () => "observed-rev-1",
      adapterRegistry: createSkillDiscoveryAdapterRegistry(),
      inspectGitState: async (relativeTarget) =>
        gitStates.get(relativeTarget) ?? "unknown",
    });

    const plan = await service.plan(
      await projectRef(),
      "observed-rev-1",
      emptyDraft({
        enabledBySkillId: { "review-guide": true },
      })
    );

    expect(plan.observedRevision).toBe("observed-rev-1");
    expect(plan.applicable).toBe(true);
    expect(plan.targetOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "create-symlink",
          relativeTarget: ".agents/skills/review-guide",
          skillId: "review-guide",
        }),
      ])
    );
    expect(plan.gitStates).toEqual(
      expect.arrayContaining([
        {
          relativeTarget: ".agents/skills/review-guide",
          state: "absent",
        },
      ])
    );
    expect(plan.planDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.planDigest).toBe(
      computePlanDigest({
        normalizedDraft: plan.normalizedDraft,
        observedRevision: plan.observedRevision,
        targetOperations: plan.targetOperations,
        gitStates: plan.gitStates,
        confirmationRequirements: plan.confirmationRequirements,
      })
    );
  });

  it("projects only the per-skill discovery channels when set", async () => {
    await writeLibrarySkill("review-guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: true },
      skills: [
        {
          id: "review-guide",
          enabled: false,
          source: { type: "local-import" },
        },
      ],
    });
    const service = createProjectSkillsPlanService({
      userData,
      getObservedRevision: async () => "rev-skill-channels",
      adapterRegistry: createSkillDiscoveryAdapterRegistry(),
      inspectGitState: async () => "absent",
    });

    const agentsOnly = await service.plan(
      await projectRef(),
      "rev-skill-channels",
      emptyDraft({
        deliveryAgents: true,
        deliveryClaude: true,
        enabledBySkillId: { "review-guide": true },
        deliveryBySkillId: {
          "review-guide": { agents: true, claude: false },
        },
      })
    );
    expect(agentsOnly.applicable).toBe(true);
    const createTargets = agentsOnly.targetOperations
      .filter((op) => op.kind === "create-symlink")
      .map((op) => op.relativeTarget)
      .sort();
    expect(createTargets).toEqual([".agents/skills/review-guide"]);

    const claudeOnly = await service.plan(
      await projectRef(),
      "rev-skill-channels",
      emptyDraft({
        deliveryAgents: true,
        deliveryClaude: true,
        enabledBySkillId: { "review-guide": true },
        deliveryBySkillId: {
          "review-guide": { agents: false, claude: true },
        },
      })
    );
    const claudeTargets = claudeOnly.targetOperations
      .filter((op) => op.kind === "create-symlink")
      .map((op) => op.relativeTarget)
      .sort();
    expect(claudeTargets).toEqual([".claude/skills/review-guide"]);
  });

  it("keeps valid enables applicable without confirmation", async () => {
    await writeLibrarySkill("review-guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: false,
          source: { type: "local-import" },
        },
      ],
    });

    const service = createProjectSkillsPlanService({
      userData,
      getObservedRevision: async () => "rev-enable",
      adapterRegistry: createSkillDiscoveryAdapterRegistry(),
      inspectGitState: async () => "absent",
    });

    const plan = await service.plan(
      await projectRef(),
      "rev-enable",
      emptyDraft({
        enabledBySkillId: { "review-guide": true },
      })
    );

    expect(plan.applicable).toBe(true);
    expect(plan.blockingIssues).toEqual([]);
    expect(plan.confirmationRequirements).toEqual([]);
    expect(
      plan.targetOperations.some(
        (op) =>
          op.kind === "create-symlink" &&
          op.relativeTarget === ".agents/skills/review-guide"
      )
    ).toBe(true);
  });

  it("allows a plan that turns Claude delivery off to clear duplicate-discovery retention", async () => {
    await writeLibrarySkill("review-guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: true },
      skills: [
        {
          id: "review-guide",
          enabled: true,
          source: { type: "local-import" },
        },
      ],
    });
    const service = createProjectSkillsPlanService({
      userData,
      getObservedRevision: async () => "rev-dup",
      adapterRegistry: createSkillDiscoveryAdapterRegistry(),
      inspectGitState: async () => "absent",
    });

    const keepClaude = await service.plan(
      await projectRef(),
      "rev-dup",
      emptyDraft({
        deliveryClaude: true,
        enabledBySkillId: { "review-guide": true },
      })
    );
    // Dual-root projection is reported for multi-root scanners…
    expect(
      keepClaude.blockingIssues.some(
        (i) =>
          i.code === "duplicate-discovery" &&
          (i.adapterKind === "opencode" || i.adapterKind === "cursor")
      )
    ).toBe(true);
    // …but never blocks applying the delivery setting that causes it
    // (v8.2: the toggle is a first-class feature; its hint documents the
    // multi-root consequence).
    expect(keepClaude.applicable).toBe(true);

    const clearClaude = await service.plan(
      await projectRef(),
      "rev-dup",
      emptyDraft({
        deliveryClaude: false,
        enabledBySkillId: { "review-guide": true },
      })
    );
    expect(
      clearClaude.blockingIssues.some((i) => i.code === "duplicate-discovery")
    ).toBe(false);
    expect(clearClaude.applicable).toBe(true);
    expect(clearClaude.targetOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "delete-symlink",
          relativeTarget: ".claude/skills/review-guide",
        }),
      ])
    );
  });

  it("requires destructive confirmation for tracked git projection deletes", async () => {
    await writeLibrarySkill("review-guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: true,
          source: { type: "local-import" },
        },
      ],
    });
    const service = createProjectSkillsPlanService({
      userData,
      getObservedRevision: async () => "rev-tracked",
      adapterRegistry: createSkillDiscoveryAdapterRegistry(),
      inspectGitState: async (relativeTarget) =>
        relativeTarget === ".agents/skills/review-guide" ? "tracked" : "absent",
    });

    const plan = await service.plan(
      await projectRef(),
      "rev-tracked",
      emptyDraft({
        enabledBySkillId: { "review-guide": false },
      })
    );

    expect(plan.targetOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "delete-symlink",
          relativeTarget: ".agents/skills/review-guide",
        }),
      ])
    );
    expect(plan.confirmationRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "git-projection-delete",
          relativeTarget: ".agents/skills/review-guide",
          gitState: "tracked",
        }),
      ])
    );
    // confirmation required does not by itself make plan inapplicable;
    // acknowledgements are supplied at apply time.
    expect(plan.applicable).toBe(true);
  });

  it("includes both agents and claude targets when enabling with Claude delivery", async () => {
    await writeLibrarySkill("review-guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: false,
          source: { type: "git-declared" },
        },
      ],
    });
    const service = createProjectSkillsPlanService({
      userData,
      getObservedRevision: async () => "rev-claude",
      adapterRegistry: createSkillDiscoveryAdapterRegistry(),
      inspectGitState: async () => "absent",
    });

    const plan = await service.plan(
      await projectRef(),
      "rev-claude",
      emptyDraft({
        deliveryClaude: true,
        enabledBySkillId: { "review-guide": true },
      })
    );

    const targets = plan.targetOperations
      .filter((op) => op.kind === "create-symlink")
      .map((op) => op.relativeTarget)
      .sort();
    expect(targets).toEqual([
      ".agents/skills/review-guide",
      ".claude/skills/review-guide",
    ]);
  });

  it("surfaces invalid-skill with a rebuild confirmation instead of hard-refusing", async () => {
    const dir = join(projectRoot, ".pier", "skills");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "manifest.json"), "{ not json", "utf8");

    const service = createProjectSkillsPlanService({
      userData,
      getObservedRevision: async () => "rev-bad",
      adapterRegistry: createSkillDiscoveryAdapterRegistry(),
      inspectGitState: async () => "absent",
    });
    const plan = await service.plan(
      await projectRef(),
      "rev-bad",
      emptyDraft()
    );
    expect(plan.applicable).toBe(true);
    expect(plan.blockingIssues.some((i) => i.code === "invalid-skill")).toBe(
      true
    );
    expect(
      plan.confirmationRequirements.some(
        (req) =>
          req.kind === "skills-state-reset" && req.reason === "invalid-manifest"
      )
    ).toBe(true);
  });

  it("reports missing library content without refusing the plan", async () => {
    await writeLibrarySkill("review-guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: true,
          source: { type: "local-import" },
        },
      ],
    });
    await rm(join(projectRoot, ".pier", "skills", "library", "review-guide"), {
      recursive: true,
      force: true,
    });

    const service = createProjectSkillsPlanService({
      userData,
      getObservedRevision: async () => "rev-miss",
      adapterRegistry: createSkillDiscoveryAdapterRegistry(),
      inspectGitState: async () => "absent",
    });

    const plan = await service.plan(
      await projectRef(),
      "rev-miss",
      emptyDraft()
    );
    expect(
      plan.blockingIssues.some(
        (i) => i.code === "missing-source" && i.skillId === "review-guide"
      )
    ).toBe(true);
    // User can still apply other intents; missing content is not a hard block.
    expect(plan.applicable).toBe(true);

    const deletePlan = await service.plan(
      await projectRef(),
      "rev-miss",
      emptyDraft({ deleteSkillIds: ["review-guide"] })
    );
    expect(
      deletePlan.blockingIssues.some((i) => i.code === "missing-source")
    ).toBe(false);
    expect(deletePlan.applicable).toBe(true);
  });

  it("plans no discovery creates when both delivery roots are off", async () => {
    await writeLibrarySkill("review-guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: true,
          source: { type: "local-import" },
        },
      ],
    });

    const service = createProjectSkillsPlanService({
      userData,
      getObservedRevision: async () => "rev-empty-delivery",
      adapterRegistry: createSkillDiscoveryAdapterRegistry(),
      inspectGitState: async () => "absent",
    });

    const plan = await service.plan(
      await projectRef(),
      "rev-empty-delivery",
      emptyDraft({ deliveryAgents: false, deliveryClaude: false })
    );

    expect(
      plan.targetOperations.some((op) => op.kind === "create-symlink")
    ).toBe(false);
    expect(
      plan.targetOperations.some(
        (op) =>
          op.kind === "delete-symlink" &&
          op.relativeTarget === ".agents/skills/review-guide"
      )
    ).toBe(true);
  });
});
