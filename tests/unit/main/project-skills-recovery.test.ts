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
import { join } from "node:path";
import { FilePathTransactionLock } from "@main/services/file-path-transaction-lock.ts";
import {
  type ApplyHooks,
  type ApplyTransactionPhase,
  createProjectSkillsApplyService,
} from "@main/services/project-skills/apply-service.ts";
import {
  resolveStableProjectIdentity,
  toContractProjectRootRef,
} from "@main/services/project-skills/identity.ts";
import { createProjectSkillsLock } from "@main/services/project-skills/lock.ts";
import { createProjectSkillsPaths } from "@main/services/project-skills/paths.ts";
import { createProjectSkillsRecoveryCoordinator } from "@main/services/project-skills/recovery.ts";
import {
  createProjectSkillsStore,
  type OperationRecord,
} from "@main/services/project-skills/store.ts";
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

async function writeLibrarySkill(skillId: string): Promise<string> {
  const dir = join(projectRoot, ".pier", "skills", "library", skillId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${skillId}\ndescription: recovery skill\n---\n# ${skillId}\n`,
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

function createLock() {
  return createProjectSkillsLock({
    transactionLock: new FilePathTransactionLock(),
    sharedLockRoot,
    acquireTimeoutMs: 2000,
  });
}

function createApplyService(hooks?: ApplyHooks) {
  return createProjectSkillsApplyService({
    userData,
    lock: createLock(),
    inspectGitState: async () => "absent",
    getObservedRevision: async () => "observed-rev-1",
    ...(hooks ? { hooks } : {}),
  });
}

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "pier-ps-rec-ud-"));
  projectRoot = await mkdtemp(join(tmpdir(), "pier-ps-rec-proj-"));
  sharedLockRoot = await mkdtemp(join(tmpdir(), "pier-ps-rec-lock-"));
});

afterEach(async () => {
  await rm(userData, { force: true, recursive: true });
  await rm(projectRoot, { force: true, recursive: true });
  await rm(sharedLockRoot, { force: true, recursive: true });
});

describe("project-skills recovery coordinator basics", () => {
  it("writes durable recovery log before first project write", async () => {
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
    let sawPreparedBeforeWrite = false;
    const service = createApplyService({
      beforePhase: async (phase, ctx) => {
        if (phase === "CONTENT_PUBLISHED") {
          const store = createProjectSkillsStore({ userData });
          const op = await store.readOperation(ctx.rootKey, ctx.operationId);
          expect(op).toEqual(
            expect.objectContaining({
              kind: "in-flight",
              phase: "PREPARED",
            })
          );
          sawPreparedBeforeWrite = true;
        }
      },
    });

    const ref = await projectRef();
    const draft = emptyDraft({ enabledBySkillId: { "review-guide": true } });
    const planned = await service.plan(ref, "observed-rev-1", draft);
    const result = await service.apply({
      projectRef: ref,
      observedRevision: "observed-rev-1",
      draft,
      planDigest: planned.planDigest,
      operationId: randomUUID(),
      acknowledgements: [],
    });

    expect(sawPreparedBeforeWrite).toBe(true);
    expect(result.status).toBe("converged");
  });

  it("recovers post-commit crash by finishing projections to terminal converged", async () => {
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
    const crashPhase: ApplyTransactionPhase = "MANIFEST_COMMITTED";
    const operationId = randomUUID();
    const service = createApplyService({
      afterPhase: async (phase) => {
        if (phase === crashPhase) {
          throw new Error("simulated crash after manifest");
        }
      },
    });

    const ref = await projectRef();
    const draft = emptyDraft({ enabledBySkillId: { "review-guide": true } });
    const planned = await service.plan(ref, "observed-rev-1", draft);

    await expect(
      service.apply({
        projectRef: ref,
        observedRevision: "observed-rev-1",
        draft,
        planDigest: planned.planDigest,
        operationId,
        acknowledgements: [],
      })
    ).rejects.toThrow(/simulated crash/);

    // Manifest was committed.
    const raw = await readFile(
      join(projectRoot, ".pier", "skills", "manifest.json"),
      "utf8"
    );
    expect((JSON.parse(raw) as ProjectSkillsManifest).skills[0]?.enabled).toBe(
      true
    );

    const store = createProjectSkillsStore({ userData });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);
    const mid = await store.readOperation(rootKey, operationId);
    expect(mid?.kind).toBe("in-flight");

    const recovery = createProjectSkillsRecoveryCoordinator({
      userData,
      lock: createLock(),
      inspectGitState: async () => "absent",
      getObservedRevision: async () => "observed-rev-1",
    });

    const recovered = await recovery.recoverOperation(ref, operationId);
    expect(recovered.status).toBe("converged");

    const linkPath = join(projectRoot, ".agents", "skills", "review-guide");
    expect(await readlink(linkPath)).toBe(
      "../../.pier/skills/library/review-guide"
    );
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);

    const terminal = await store.readOperation(rootKey, operationId);
    expect(terminal).toEqual(
      expect.objectContaining({
        kind: "terminal",
        status: "converged",
      })
    );

    // Idempotent: second recovery returns same terminal.
    const again = await recovery.recoverOperation(ref, operationId);
    expect(again).toEqual(recovered);
  });

  it("sweepPendingOperations drives stranded in-flight apply logs to terminal (v8.2 §4.2.1)", async () => {
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
    const operationId = randomUUID();
    const service = createApplyService({
      afterPhase: async (phase) => {
        if (phase === "MANIFEST_COMMITTED") {
          throw new Error("simulated crash after manifest");
        }
      },
    });
    const ref = await projectRef();
    const draft = emptyDraft({ enabledBySkillId: { "review-guide": true } });
    const planned = await service.plan(ref, "observed-rev-1", draft);
    await expect(
      service.apply({
        projectRef: ref,
        observedRevision: "observed-rev-1",
        draft,
        planDigest: planned.planDigest,
        operationId,
        acknowledgements: [],
      })
    ).rejects.toThrow(/simulated crash/);

    // No one knows the operation id (crash) — the sweep must find and
    // finish it from the durable log alone.
    const recovery = createProjectSkillsRecoveryCoordinator({
      userData,
      lock: createLock(),
      inspectGitState: async () => "absent",
      getObservedRevision: async () => "observed-rev-1",
    });
    const swept = await recovery.sweepPendingOperations(ref);
    expect(swept.advanced).toBe(1);

    const store = createProjectSkillsStore({ userData });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);
    const terminal = await store.readOperation(rootKey, operationId);
    expect(terminal).toEqual(
      expect.objectContaining({ kind: "terminal", status: "converged" })
    );

    // Nothing left to advance.
    const again = await recovery.sweepPendingOperations(ref);
    expect(again.advanced).toBe(0);
  });

  it("recovers pre-commit crash as not-applied without applying projections", async () => {
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
    const operationId = randomUUID();
    const service = createApplyService({
      beforePhase: async (phase) => {
        if (phase === "MANIFEST_COMMITTED") {
          throw new Error("crash before commit");
        }
      },
    });

    const ref = await projectRef();
    const draft = emptyDraft({ enabledBySkillId: { "review-guide": true } });
    const planned = await service.plan(ref, "observed-rev-1", draft);

    await expect(
      service.apply({
        projectRef: ref,
        observedRevision: "observed-rev-1",
        draft,
        planDigest: planned.planDigest,
        operationId,
        acknowledgements: [],
      })
    ).rejects.toMatchObject({ code: "not-applied" });

    // Leave an in-flight PREPARED-style record if apply already finalized —
    // force an in-flight mid-state for recovery path by writing one.
    const store = createProjectSkillsStore({ userData });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);
    const existing = await store.readOperation(rootKey, operationId);
    // apply already wrote terminal not-applied; recovery should return it.
    expect(existing?.kind).toBe("terminal");
    if (existing?.kind === "terminal") {
      expect(existing.status).toBe("not-applied");
    }

    const recovery = createProjectSkillsRecoveryCoordinator({
      userData,
      lock: createLock(),
      inspectGitState: async () => "absent",
      getObservedRevision: async () => "observed-rev-1",
    });
    const recovered = await recovery.recoverOperation(ref, operationId);
    expect(recovered.status).toBe("not-applied");

    await expect(
      lstat(join(projectRoot, ".agents", "skills", "review-guide"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("operation status is read-only and does not drive recovery", async () => {
    const store = createProjectSkillsStore({ userData });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);
    const operationId = randomUUID();
    const inFlight: OperationRecord = {
      kind: "in-flight",
      phase: "MANIFEST_COMMITTED",
      requestDigest: `sha256:${"d".repeat(64)}`,
    };
    await store.writeOperation(rootKey, operationId, inFlight);

    const recovery = createProjectSkillsRecoveryCoordinator({
      userData,
      lock: createLock(),
    });
    const status = await recovery.operationStatus(
      await projectRef(),
      operationId
    );
    expect(status).toEqual(
      expect.objectContaining({
        operationId,
        kind: "pending",
        phase: "MANIFEST_COMMITTED",
      })
    );

    // Still in-flight — status must not have finalized it.
    const still = await store.readOperation(rootKey, operationId);
    expect(still).toEqual(inFlight);
  });

  it("does not rewrite a degraded terminal to converged", async () => {
    const store = createProjectSkillsStore({ userData });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);
    const operationId = randomUUID();
    const digest = `sha256:${"e".repeat(64)}`;
    const terminal: OperationRecord = {
      kind: "terminal",
      status: "degraded",
      requestDigest: digest,
      result: {
        status: "degraded",
        operationId,
        revisions: {
          manifestRevision: `sha256:${"f".repeat(64)}`,
          observedRevision: "observed-rev-1",
        },
        targetResults: [],
        snapshot: { ok: false },
        pendingIssueIds: ["cleanup-pending:x"],
      },
    };
    await store.writeOperation(rootKey, operationId, terminal);

    const recovery = createProjectSkillsRecoveryCoordinator({
      userData,
      lock: createLock(),
    });
    const out = await recovery.recoverOperation(
      await projectRef(),
      operationId
    );
    expect(out.status).toBe("degraded");
    const again = await store.readOperation(rootKey, operationId);
    expect(again).toEqual(terminal);
  });
});
