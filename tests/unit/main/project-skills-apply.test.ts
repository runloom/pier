import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
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
  computeApplyRequestDigest,
  createProjectSkillsApplyService,
} from "@main/services/project-skills/apply-service.ts";
import {
  resolveStableProjectIdentity,
  toContractProjectRootRef,
} from "@main/services/project-skills/identity.ts";
import { createProjectSkillsLock } from "@main/services/project-skills/lock.ts";
import { createProjectSkillsPaths } from "@main/services/project-skills/paths.ts";
import { createProjectSkillsStore } from "@main/services/project-skills/store.ts";
import { computeTreeSha256V1 } from "@main/services/project-skills/tree-digest.ts";
import type {
  ProjectSkillsDraft,
  ProjectSkillsManifest,
} from "@shared/contracts/project-skills.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let userData: string;
let projectRoot: string;
let sharedLockRoot: string;

async function writeManifest(manifest: ProjectSkillsManifest): Promise<void> {
  const dir = join(projectRoot, ".pier", "skills");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

async function writeLibrarySkill(
  skillId: string,
  body = `# ${skillId}\n`
): Promise<string> {
  const dir = join(projectRoot, ".pier", "skills", "library", skillId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${skillId}\ndescription: test skill for apply\n---\n${body}`,
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
    enabledBySkillId: {},
    importTokens: [],
    deleteSkillIds: [],
    ...overrides,
  };
}

function createApplyService(hooks?: ApplyHooks) {
  const transactionLock = new FilePathTransactionLock();
  const lock = createProjectSkillsLock({
    transactionLock,
    sharedLockRoot,
    acquireTimeoutMs: 2000,
  });
  return createProjectSkillsApplyService({
    userData,
    lock,
    inspectGitState: async () => "absent",
    getObservedRevision: async () => "observed-rev-1",
    ...(hooks ? { hooks } : {}),
  });
}

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "pier-ps-apply-ud-"));
  projectRoot = await mkdtemp(join(tmpdir(), "pier-ps-apply-proj-"));
  sharedLockRoot = await mkdtemp(join(tmpdir(), "pier-ps-apply-lock-"));
});

afterEach(async () => {
  await rm(userData, { force: true, recursive: true });
  await rm(projectRoot, { force: true, recursive: true });
  await rm(sharedLockRoot, { force: true, recursive: true });
});

describe("project-skills apply", () => {
  it("converges enabling a valid skill and publishes relative symlink", async () => {
    const digest = await writeLibrarySkill("review-guide");
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
    const service = createApplyService();
    const ref = await projectRef();
    const draft = emptyDraft({ enabledBySkillId: { "review-guide": true } });
    const planned = await service.plan(ref, "observed-rev-1", draft);
    expect(planned.applicable).toBe(true);

    const operationId = randomUUID();
    const result = await service.apply({
      projectRef: ref,
      observedRevision: "observed-rev-1",
      draft,
      planDigest: planned.planDigest,
      operationId,
      acknowledgements: [],
    });

    expect(result.status).toBe("converged");
    if (result.status !== "converged") return;
    expect(result.operationId).toBe(operationId);
    expect(result.revisions.observedRevision).toBe("observed-rev-1");
    expect(result.revisions.manifestRevision).toMatch(/^sha256:[a-f0-9]{64}$/);

    const linkPath = join(projectRoot, ".agents", "skills", "review-guide");
    const link = await readlink(linkPath);
    expect(link).toBe("../../.pier/skills/library/review-guide");
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);

    const raw = await readFile(
      join(projectRoot, ".pier", "skills", "manifest.json"),
      "utf8"
    );
    const manifest = JSON.parse(raw) as ProjectSkillsManifest;
    expect(manifest.skills[0]?.enabled).toBe(true);
  });

  it("returns not-applied terminal when failing before manifest commit", async () => {
    const digest = await writeLibrarySkill("review-guide");
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
    const beforeManifest = await readFile(
      join(projectRoot, ".pier", "skills", "manifest.json"),
      "utf8"
    );

    const service = createApplyService({
      beforePhase: async (phase) => {
        if (phase === "MANIFEST_COMMITTED") {
          throw new Error("injected pre-commit failure");
        }
      },
    });
    const ref = await projectRef();
    const draft = emptyDraft({ enabledBySkillId: { "review-guide": true } });
    const planned = await service.plan(ref, "observed-rev-1", draft);
    const operationId = randomUUID();

    await expect(
      service.apply({
        projectRef: ref,
        observedRevision: "observed-rev-1",
        draft,
        planDigest: planned.planDigest,
        operationId,
        acknowledgements: [],
      })
    ).rejects.toMatchObject({
      code: "not-applied",
      operationId,
    });

    const afterManifest = await readFile(
      join(projectRoot, ".pier", "skills", "manifest.json"),
      "utf8"
    );
    expect(afterManifest).toBe(beforeManifest);

    const linkPath = join(projectRoot, ".agents", "skills", "review-guide");
    await expect(lstat(linkPath)).rejects.toMatchObject({ code: "ENOENT" });

    const store = createProjectSkillsStore({ userData });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);
    const op = await store.readOperation(rootKey, operationId);
    expect(op).toEqual(
      expect.objectContaining({
        kind: "terminal",
        status: "not-applied",
      })
    );
  });

  it("rejects in-place manifest edits made after the expected digest was captured", async () => {
    const digest = await writeLibrarySkill("review-guide");
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
    const manifestPath = join(projectRoot, ".pier", "skills", "manifest.json");
    const service = createApplyService({
      beforePhase: async (phase) => {
        if (phase === "MANIFEST_COMMITTED") {
          await writeFile(
            manifestPath,
            `${JSON.stringify(
              {
                version: 1,
                delivery: { agents: true, claude: true },
                skills: [
                  {
                    id: "review-guide",
                    enabled: false,
                    contentDigest: digest,
                    source: { type: "local-import" },
                  },
                ],
              },
              null,
              2
            )}\n`,
            "utf8"
          );
        }
      },
    });
    const ref = await projectRef();
    const draft = emptyDraft({ enabledBySkillId: { "review-guide": true } });
    const plan = await service.plan(ref, "observed-rev-1", draft);

    await expect(
      service.apply({
        projectRef: ref,
        observedRevision: "observed-rev-1",
        draft,
        planDigest: plan.planDigest,
        operationId: randomUUID(),
        acknowledgements: [],
      })
    ).rejects.toMatchObject({ code: "not-applied" });

    const external = JSON.parse(
      await readFile(manifestPath, "utf8")
    ) as ProjectSkillsManifest;
    expect(external.delivery.claude).toBe(true);
    expect(external.skills[0]?.enabled).toBe(false);
  });

  it("returns degraded when projection fails after manifest commit", async () => {
    const digest = await writeLibrarySkill("review-guide");
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
    // Plan preflight rejects an already-occupied target (unmanaged-conflict),
    // so race the unmanaged file in AFTER the manifest committed (TOCTOU):
    // publishNoReplace must not replace it and apply must degrade instead of
    // failing the whole transaction.
    const linkPath = join(projectRoot, ".agents", "skills", "review-guide");
    const service = createApplyService({
      afterPhase: async (phase) => {
        if (phase === "MANIFEST_COMMITTED") {
          await mkdir(dirname(linkPath), { recursive: true });
          await writeFile(linkPath, "unmanaged\n", "utf8");
        }
      },
    });
    const ref = await projectRef();
    const draft = emptyDraft({ enabledBySkillId: { "review-guide": true } });
    const planned = await service.plan(ref, "observed-rev-1", draft);
    const operationId = randomUUID();

    const result = await service.apply({
      projectRef: ref,
      observedRevision: "observed-rev-1",
      draft,
      planDigest: planned.planDigest,
      operationId,
      acknowledgements: [],
    });

    expect(result.status).toBe("degraded");
    if (result.status !== "degraded") return;
    expect(result.operationId).toBe(operationId);
    expect(result.revisions.manifestRevision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.pendingIssueIds.length).toBeGreaterThan(0);

    const raw = await readFile(
      join(projectRoot, ".pier", "skills", "manifest.json"),
      "utf8"
    );
    const manifest = JSON.parse(raw) as ProjectSkillsManifest;
    expect(manifest.skills[0]?.enabled).toBe(true);
    // Unmanaged target preserved.
    expect(await readFile(linkPath, "utf8")).toBe("unmanaged\n");
  });

  it("is idempotent for the same operationId and requestDigest", async () => {
    const digest = await writeLibrarySkill("review-guide");
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
    const service = createApplyService();
    const ref = await projectRef();
    const draft = emptyDraft({ enabledBySkillId: { "review-guide": true } });
    const planned = await service.plan(ref, "observed-rev-1", draft);
    const operationId = randomUUID();
    const request = {
      projectRef: ref,
      observedRevision: "observed-rev-1" as const,
      draft,
      planDigest: planned.planDigest,
      operationId,
      acknowledgements: [] as const,
    };

    const first = await service.apply(request);
    expect(first.status).toBe("converged");
    const second = await service.apply(request);
    expect(second).toEqual(first);

    const requestDigest = computeApplyRequestDigest({
      operationId,
      planDigest: planned.planDigest,
      observedRevision: "observed-rev-1",
      draft,
      acknowledgements: [],
    });
    expect(requestDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("commits the manifest before applying projections", async () => {
    const digest = await writeLibrarySkill("fresh-skill");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "fresh-skill",
          enabled: false,
          contentDigest: digest,
          source: { type: "local-import" },
        },
      ],
    });

    const phases: string[] = [];
    const service = createApplyService({
      afterPhase: async (phase) => {
        phases.push(phase);
      },
    });

    const ref = await projectRef();
    const draft = emptyDraft({ enabledBySkillId: { "fresh-skill": true } });
    const planned = await service.plan(ref, "observed-rev-1", draft);
    expect(planned.applicable).toBe(true);
    expect(planned.confirmationRequirements).toEqual([]);

    const operationId = randomUUID();
    const result = await service.apply({
      projectRef: ref,
      observedRevision: "observed-rev-1",
      draft,
      planDigest: planned.planDigest,
      operationId,
      acknowledgements: [],
    });

    expect(result.status).toBe("converged");
    expect(phases).toContain("MANIFEST_COMMITTED");
  });

  it("rejects same operationId with different requestDigest", async () => {
    const digest = await writeLibrarySkill("review-guide");
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
    const service = createApplyService();
    const ref = await projectRef();
    const draft = emptyDraft({ enabledBySkillId: { "review-guide": true } });
    const planned = await service.plan(ref, "observed-rev-1", draft);
    const operationId = randomUUID();

    await service.apply({
      projectRef: ref,
      observedRevision: "observed-rev-1",
      draft,
      planDigest: planned.planDigest,
      operationId,
      acknowledgements: [],
    });

    await expect(
      service.apply({
        projectRef: ref,
        observedRevision: "observed-rev-1",
        draft: emptyDraft({ enabledBySkillId: { "review-guide": false } }),
        planDigest: planned.planDigest,
        operationId,
        acknowledgements: [],
      })
    ).rejects.toMatchObject({ code: "operation-conflict" });
  });
});
