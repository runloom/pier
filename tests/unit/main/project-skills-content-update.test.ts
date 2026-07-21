import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FilePathTransactionLock } from "@main/services/file-path-transaction-lock.ts";
import {
  type ApplyHooks,
  createProjectSkillsApplyService,
  ProjectSkillsApplyError,
} from "@main/services/project-skills/apply-service.ts";
import {
  resolveStableProjectIdentity,
  toContractProjectRootRef,
} from "@main/services/project-skills/identity.ts";
import {
  createProjectSkillsImportService,
  PROJECT_SKILLS_IMPORT_LIMITS,
  ProjectSkillsImportError,
} from "@main/services/project-skills/import-service.ts";
import { createProjectSkillsLock } from "@main/services/project-skills/lock.ts";
import { createProjectSkillsPaths } from "@main/services/project-skills/paths.ts";
import { createProjectSkillsPlanService } from "@main/services/project-skills/plan.ts";
import { createProjectSkillsStore } from "@main/services/project-skills/store.ts";
import { computeTreeSha256V1 } from "@main/services/project-skills/tree-digest.ts";
import type { ProjectSkillsManifest } from "@shared/contracts/project-skills.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let userData: string;
let projectRoot: string;
let sharedLockRoot: string;

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "pier-cupdate-ud-"));
  projectRoot = await mkdtemp(join(tmpdir(), "pier-cupdate-proj-"));
  sharedLockRoot = await mkdtemp(join(tmpdir(), "pier-cupdate-lock-"));
});

afterEach(async () => {
  await Promise.all(
    [userData, projectRoot, sharedLockRoot].map((dir) =>
      rm(dir, { force: true, recursive: true })
    )
  );
});

async function writeLibrarySkill(
  skillId: string,
  body: string
): Promise<string> {
  const dir = join(projectRoot, ".pier", "skills", "library", skillId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${skillId}\ndescription: content update skill\n---\n${body}`,
    "utf8"
  );
  return computeTreeSha256V1(dir);
}

async function writeManifest(manifest: ProjectSkillsManifest): Promise<void> {
  const dir = join(projectRoot, ".pier", "skills");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

async function projectRef() {
  return toContractProjectRootRef(
    await resolveStableProjectIdentity(projectRoot)
  );
}

function buildServices(options?: { hooks?: ApplyHooks; now?: () => number }) {
  const store = createProjectSkillsStore({ userData });
  const transactionLock = new FilePathTransactionLock();
  const lock = createProjectSkillsLock({ transactionLock, sharedLockRoot });
  const importService = createProjectSkillsImportService({
    userData,
    lock,
    store,
    defaultCaller: { webContentsId: 1, clientInstanceId: "test" },
    ...(options?.now ? { now: options.now } : {}),
  });
  const planService = createProjectSkillsPlanService({
    userData,
    store,
    getObservedRevision: async () => "observed-rev-1",
    inspectGitState: async () => "absent",
    ...(options?.now ? { now: options.now } : {}),
  });
  const applyService = createProjectSkillsApplyService({
    userData,
    lock,
    store,
    planService,
    inspectGitState: async () => "absent",
    getObservedRevision: async () => "observed-rev-1",
    ...(options?.hooks ? { hooks: options.hooks } : {}),
    ...(options?.now ? { now: options.now } : {}),
  });
  return { store, importService, planService, applyService };
}

const NEW_SKILL_MD =
  "---\nname: review-guide\ndescription: content update skill\n---\nUpdated body\n";

describe("content update / drift acceptance candidates (v8)", () => {
  it("prepareContentUpdate binds base digest and re-runs limits", async () => {
    const digest = await writeLibrarySkill("review-guide", "Original body\n");
    const { importService } = buildServices();
    const ref = await projectRef();

    const candidate = await importService.prepareContentUpdate(ref, {
      skillId: "review-guide",
      baseContentDigest: digest,
      skillMd: NEW_SKILL_MD,
    });
    expect(candidate.sourceKind).toBe("content-update");
    expect(candidate.baseContentDigest).toBe(digest);
    expect(candidate.contentDigest).not.toBe(digest);

    // Stale base digest is refused — edits never stack on concurrent drift.
    await expect(
      importService.prepareContentUpdate(ref, {
        skillId: "review-guide",
        baseContentDigest: `sha256:${"f".repeat(64)}`,
        skillMd: NEW_SKILL_MD,
      })
    ).rejects.toMatchObject({ code: "base-mismatch" });
  });

  it("rejects expired candidates in plan and again under the apply lock", async () => {
    let now = 1000;
    const digest = await writeLibrarySkill("review-guide", "Original body\n");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: false,
          contentDigest: digest,
          source: { type: "local-import" },
        },
      ],
    });
    const { importService, planService, applyService } = buildServices({
      now: () => now,
    });
    const ref = await projectRef();
    const candidate = await importService.prepareContentUpdate(ref, {
      skillId: "review-guide",
      baseContentDigest: digest,
      skillMd: NEW_SKILL_MD,
    });
    const draft = {
      deliveryAgents: true,
      deliveryClaude: false,
      enabledBySkillId: {},
      importTokens: [candidate.token],
      deleteSkillIds: [],
    };
    const plan = await planService.plan(ref, "observed-rev-1", draft);
    now += PROJECT_SKILLS_IMPORT_LIMITS.tokenTtlMs + 1;

    await expect(
      planService.plan(ref, "observed-rev-1", draft)
    ).rejects.toMatchObject({ code: "token-expired" });
    await expect(
      applyService.apply({
        projectRef: ref,
        observedRevision: "observed-rev-1",
        draft,
        planDigest: plan.planDigest,
        operationId: randomUUID(),
        acknowledgements: plan.confirmationRequirements.map((requirement) => ({
          requirementId: requirement.id,
          nonce: randomUUID(),
        })),
      })
    ).rejects.toMatchObject({ code: "token-expired" });
  });

  it("drift acceptance updates reviewed content while the skill stays disabled", async () => {
    const digest = await writeLibrarySkill("review-guide", "Original body\n");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: false,
          contentDigest: digest,
          source: { type: "local-import" },
        },
      ],
    });
    // Tamper outside Pier, then accept the drift via the candidate flow.
    await writeLibrarySkill("review-guide", "Tampered body\n");
    const { importService, planService, applyService } = buildServices();
    const ref = await projectRef();
    const candidate = await importService.prepareDriftAcceptance(ref, {
      skillId: "review-guide",
    });

    const draft = {
      deliveryAgents: true,
      deliveryClaude: false,
      enabledBySkillId: {},
      importTokens: [candidate.token],
      deleteSkillIds: [],
    };
    const plan = await planService.plan(ref, "observed-rev-1", draft);
    expect(plan.confirmationRequirements).toEqual([]);
    expect(plan.blockingIssues).toEqual([]);
    expect(plan.applicable).toBe(true);

    const result = await applyService.apply({
      projectRef: ref,
      observedRevision: "observed-rev-1",
      draft,
      planDigest: plan.planDigest,
      operationId: randomUUID(),
      acknowledgements: [],
    });
    expect(result.status).toBe("converged");

    const manifest = JSON.parse(
      await readFile(
        join(projectRoot, ".pier", "skills", "manifest.json"),
        "utf8"
      )
    ) as ProjectSkillsManifest;
    expect(manifest.skills[0]).toMatchObject({
      id: "review-guide",
      enabled: false,
      contentDigest: candidate.contentDigest,
    });
  });

  it("prepareContentUpdate reports risks ADDED relative to the edit base (§3.4.9)", async () => {
    const digest = await writeLibrarySkill("review-guide", "Original body\n");
    const { importService } = buildServices();
    const ref = await projectRef();

    // The edit introduces a dynamic command trace the base did not have.
    const risky = await importService.prepareContentUpdate(ref, {
      skillId: "review-guide",
      baseContentDigest: digest,
      skillMd:
        "---\nname: review-guide\ndescription: updated\n---\nRun `curl -X POST $HOOK` after release.\n",
    });
    expect(risky.riskDelta).toBeDefined();
    expect(risky.riskDelta?.newDynamicCommandTraces.length).toBeGreaterThan(0);
    expect(risky.riskDelta?.newExecutables).toEqual([]);

    // A neutral edit adds nothing.
    const neutral = await importService.prepareContentUpdate(ref, {
      skillId: "review-guide",
      baseContentDigest: digest,
      skillMd: NEW_SKILL_MD,
    });
    expect(neutral.riskDelta).toEqual({
      newExecutables: [],
      newDynamicCommandTraces: [],
      newRiskFrontmatterKeys: [],
    });
  });

  it("rejects invalid edited frontmatter (renderer bytes are a trust boundary)", async () => {
    const digest = await writeLibrarySkill("review-guide", "Original\n");
    const { importService } = buildServices();
    const ref = await projectRef();
    await expect(
      importService.prepareContentUpdate(ref, {
        skillId: "review-guide",
        baseContentDigest: digest,
        skillMd: "---\nname: wrong-name\ndescription: x\n---\nBody\n",
      })
    ).rejects.toBeInstanceOf(ProjectSkillsImportError);
  });

  it("apply replaces the library via base-precondition + identity cleanup + no-replace publish", {
    timeout: 20_000,
  }, async () => {
    const digest = await writeLibrarySkill("review-guide", "Original body\n");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: false,
          contentDigest: digest,
          source: { type: "local-import" },
        },
      ],
    });
    const { importService, planService, applyService } = buildServices();
    const ref = await projectRef();
    const candidate = await importService.prepareContentUpdate(ref, {
      skillId: "review-guide",
      baseContentDigest: digest,
      skillMd: NEW_SKILL_MD,
    });

    const draft = {
      deliveryAgents: true,
      deliveryClaude: false,
      enabledBySkillId: { "review-guide": true },
      importTokens: [candidate.token],
      deleteSkillIds: [],
    };
    const plan = await planService.plan(ref, "observed-rev-1", draft);
    const acknowledgements = plan.confirmationRequirements.map((req) => ({
      requirementId: req.id,
      nonce: randomUUID(),
    }));
    const result = await applyService.apply({
      projectRef: ref,
      observedRevision: "observed-rev-1",
      draft,
      planDigest: plan.planDigest,
      operationId: randomUUID(),
      acknowledgements,
    });
    expect(result.status).toBe("converged");

    // Library now carries the edited content; manifest digest updated and the
    // original source type is preserved.
    const skillMd = await readFile(
      join(
        projectRoot,
        ".pier",
        "skills",
        "library",
        "review-guide",
        "SKILL.md"
      ),
      "utf8"
    );
    expect(skillMd).toContain("Updated body");
    const manifest = JSON.parse(
      await readFile(
        join(projectRoot, ".pier", "skills", "manifest.json"),
        "utf8"
      )
    ) as ProjectSkillsManifest;
    expect(manifest.skills[0]?.contentDigest).toBe(candidate.contentDigest);
    expect(manifest.skills[0]?.source.type).toBe("local-import");

    const link = join(projectRoot, ".agents", "skills", "review-guide");
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe(
      "../../.pier/skills/library/review-guide"
    );
  });

  it("recognizes an already-restored tree after crashing before rollback progress is persisted", async () => {
    const originalDigest = await writeLibrarySkill(
      "review-guide",
      "Original body\n"
    );
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: false,
          contentDigest: originalDigest,
          source: { type: "local-import" },
        },
      ],
    });
    const { importService, planService, applyService } = buildServices({
      hooks: {
        beforePhase: async (phase) => {
          if (phase === "MANIFEST_COMMITTED") {
            throw new Error("injected replacement rollback");
          }
        },
        afterReplacementRestored: async () => {
          throw new Error("crash after replacement restore");
        },
      },
    });
    const ref = await projectRef();
    const candidate = await importService.prepareContentUpdate(ref, {
      skillId: "review-guide",
      baseContentDigest: originalDigest,
      skillMd: NEW_SKILL_MD,
    });
    const draft = {
      deliveryAgents: true,
      deliveryClaude: false,
      enabledBySkillId: {},
      importTokens: [candidate.token],
      deleteSkillIds: [],
    };
    const plan = await planService.plan(ref, "observed-rev-1", draft);
    const operationId = randomUUID();

    await expect(
      applyService.apply({
        projectRef: ref,
        observedRevision: "observed-rev-1",
        draft,
        planDigest: plan.planDigest,
        operationId,
        acknowledgements: plan.confirmationRequirements.map((requirement) => ({
          requirementId: requirement.id,
          nonce: randomUUID(),
        })),
      })
    ).rejects.toThrow("crash after replacement restore");

    const libraryDir = join(
      projectRoot,
      ".pier",
      "skills",
      "library",
      "review-guide"
    );
    expect(await computeTreeSha256V1(libraryDir)).toBe(originalDigest);
    await expect(
      buildServices().applyService.continueFromLog(ref, operationId)
    ).resolves.toMatchObject({ status: "not-applied", operationId });
    expect(await readFile(join(libraryDir, "SKILL.md"), "utf8")).toContain(
      "Original body"
    );
    const libraryNames = await readdir(dirname(libraryDir));
    expect(
      libraryNames.some((name) => name.startsWith(".pier-skills-backup-"))
    ).toBe(false);
  });

  it("resumes a durable rollback intent instead of driving forward", async () => {
    const originalDigest = await writeLibrarySkill(
      "review-guide",
      "Original body\n"
    );
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: false,
          contentDigest: originalDigest,
          source: { type: "local-import" },
        },
      ],
    });
    const crashing = buildServices({
      hooks: {
        beforePhase: async (phase) => {
          if (phase === "MANIFEST_COMMITTED") {
            throw new Error("start rollback");
          }
        },
        afterRollbackIntent: async () => {
          throw new Error("crash after rollback intent");
        },
      },
    });
    const ref = await projectRef();
    const candidate = await crashing.importService.prepareContentUpdate(ref, {
      skillId: "review-guide",
      baseContentDigest: originalDigest,
      skillMd: NEW_SKILL_MD,
    });
    const draft = {
      deliveryAgents: true,
      deliveryClaude: false,
      enabledBySkillId: {},
      importTokens: [candidate.token],
      deleteSkillIds: [],
    };
    const plan = await crashing.planService.plan(ref, "observed-rev-1", draft);
    const operationId = randomUUID();
    await expect(
      crashing.applyService.apply({
        projectRef: ref,
        observedRevision: "observed-rev-1",
        draft,
        planDigest: plan.planDigest,
        operationId,
        acknowledgements: plan.confirmationRequirements.map((requirement) => ({
          requirementId: requirement.id,
          nonce: randomUUID(),
        })),
      })
    ).rejects.toThrow("crash after rollback intent");

    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);
    await expect(
      crashing.store.readOperation(rootKey, operationId)
    ).resolves.toEqual(
      expect.objectContaining({ kind: "in-flight", phase: "ROLLING_BACK" })
    );

    const forwardPhases: string[] = [];
    const recovering = buildServices({
      hooks: {
        beforePhase: async (phase) => {
          forwardPhases.push(phase);
        },
      },
    });
    await expect(
      recovering.applyService.continueFromLog(ref, operationId)
    ).resolves.toMatchObject({ status: "not-applied", operationId });
    expect(forwardPhases).toEqual([]);
    expect(
      await computeTreeSha256V1(
        join(projectRoot, ".pier", "skills", "library", "review-guide")
      )
    ).toBe(originalDigest);
  });

  it("cleans a committed replacement backup when resuming at MANIFEST_COMMITTED", async () => {
    const originalDigest = await writeLibrarySkill(
      "review-guide",
      "Original body\n"
    );
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: false,
          contentDigest: originalDigest,
          source: { type: "local-import" },
        },
      ],
    });
    const crashing = buildServices({
      hooks: {
        beforeCommittedBackupCleanup: async () => {
          throw new Error("crash before committed backup cleanup");
        },
      },
    });
    const ref = await projectRef();
    const candidate = await crashing.importService.prepareContentUpdate(ref, {
      skillId: "review-guide",
      baseContentDigest: originalDigest,
      skillMd: NEW_SKILL_MD,
    });
    const draft = {
      deliveryAgents: true,
      deliveryClaude: false,
      enabledBySkillId: {},
      importTokens: [candidate.token],
      deleteSkillIds: [],
    };
    const plan = await crashing.planService.plan(ref, "observed-rev-1", draft);
    const operationId = randomUUID();
    await expect(
      crashing.applyService.apply({
        projectRef: ref,
        observedRevision: "observed-rev-1",
        draft,
        planDigest: plan.planDigest,
        operationId,
        acknowledgements: plan.confirmationRequirements.map((requirement) => ({
          requirementId: requirement.id,
          nonce: randomUUID(),
        })),
      })
    ).rejects.toThrow("crash before committed backup cleanup");

    const libraryParent = join(projectRoot, ".pier", "skills", "library");
    expect(
      (await readdir(libraryParent)).some((name) =>
        name.startsWith(".pier-skills-backup-")
      )
    ).toBe(true);

    const recovering = buildServices();
    await expect(
      recovering.applyService.continueFromLog(ref, operationId)
    ).resolves.toMatchObject({ status: "converged", operationId });
    expect(
      (await readdir(libraryParent)).some((name) =>
        name.startsWith(".pier-skills-backup-")
      )
    ).toBe(false);
  });

  it("consumes a claimed candidate when recovery finds its library publish logged", async () => {
    const originalDigest = await writeLibrarySkill(
      "review-guide",
      "Original body\n"
    );
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: false,
          contentDigest: originalDigest,
          source: { type: "local-import" },
        },
      ],
    });
    const ref = await projectRef();
    const operationId = randomUUID();
    const crashing = buildServices({
      hooks: {
        afterLibraryPublishLogged: async () => {
          throw new ProjectSkillsApplyError(
            "indeterminate",
            "crash after publish log",
            operationId
          );
        },
      },
    });
    const candidate = await crashing.importService.prepareContentUpdate(ref, {
      skillId: "review-guide",
      baseContentDigest: originalDigest,
      skillMd: NEW_SKILL_MD,
    });
    const draft = {
      deliveryAgents: true,
      deliveryClaude: false,
      enabledBySkillId: {},
      importTokens: [candidate.token],
      deleteSkillIds: [],
    };
    const plan = await crashing.planService.plan(ref, "observed-rev-1", draft);
    await expect(
      crashing.applyService.apply({
        projectRef: ref,
        observedRevision: "observed-rev-1",
        draft,
        planDigest: plan.planDigest,
        operationId,
        acknowledgements: plan.confirmationRequirements.map((requirement) => ({
          requirementId: requirement.id,
          nonce: randomUUID(),
        })),
      })
    ).resolves.toMatchObject({ status: "indeterminate", operationId });

    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);
    await expect(
      crashing.store.readCandidate(rootKey, candidate.token)
    ).resolves.toMatchObject({ state: "CLAIMED", operationId });

    const pausingRecovery = buildServices({
      hooks: {
        beforePhase: async (phase) => {
          if (phase === "MANIFEST_COMMITTED") {
            throw new ProjectSkillsApplyError(
              "indeterminate",
              "pause after consume",
              operationId
            );
          }
        },
      },
    });
    await expect(
      pausingRecovery.applyService.continueFromLog(ref, operationId)
    ).resolves.toMatchObject({ status: "indeterminate", operationId });
    await expect(
      pausingRecovery.store.readCandidate(rootKey, candidate.token)
    ).resolves.toMatchObject({ state: "CONSUMED", operationId });

    await expect(
      buildServices().applyService.continueFromLog(ref, operationId)
    ).resolves.toMatchObject({ status: "converged", operationId });
  });

  it("prepareDriftAcceptance snapshots the drifted content for integrity adoption", async () => {
    const digest = await writeLibrarySkill("review-guide", "Original body\n");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: true,
          contentDigest: digest,
          source: { type: "git-declared" },
        },
      ],
    });
    // External drift.
    await writeFile(
      join(
        projectRoot,
        ".pier",
        "skills",
        "library",
        "review-guide",
        "SKILL.md"
      ),
      "---\nname: review-guide\ndescription: content update skill\n---\nDrifted body\n",
      "utf8"
    );
    const driftedDigest = await computeTreeSha256V1(
      join(projectRoot, ".pier", "skills", "library", "review-guide")
    );
    expect(driftedDigest).not.toBe(digest);

    const { importService } = buildServices();
    const ref = await projectRef();
    const candidate = await importService.prepareDriftAcceptance(ref, {
      skillId: "review-guide",
    });
    // Integrity adoption: the candidate is the CURRENT content; the base
    // digest is the observed drifted digest so further concurrent change
    // fails apply.
    expect(candidate.sourceKind).toBe("drift-accepted");
    expect(candidate.contentDigest).toBe(driftedDigest);
    expect(candidate.baseContentDigest).toBe(driftedDigest);
  });
});
