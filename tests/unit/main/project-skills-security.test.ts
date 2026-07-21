import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FilePathTransactionLock } from "@main/services/file-path-transaction-lock.ts";
import {
  computeApplyRequestDigest,
  createProjectSkillsApplyService,
} from "@main/services/project-skills/apply-service.ts";
import { createProjectSkillsFileSystemAdapter } from "@main/services/project-skills/fs-adapter.ts";
import {
  resolveStableProjectIdentity,
  toContractProjectRootRef,
} from "@main/services/project-skills/identity.ts";
import { createProjectSkillsLock } from "@main/services/project-skills/lock.ts";
import { createProjectSkillsPaths } from "@main/services/project-skills/paths.ts";
import { createProjectSkillsService } from "@main/services/project-skills/service.ts";
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
    `---\nname: ${skillId}\ndescription: security skill\n---\n# ${skillId}\n`,
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

function createApplyService(ud = userData) {
  const transactionLock = new FilePathTransactionLock();
  const lock = createProjectSkillsLock({
    transactionLock,
    sharedLockRoot,
    acquireTimeoutMs: 15_000,
  });
  return createProjectSkillsApplyService({
    userData: ud,
    lock,
    inspectGitState: async () => "absent",
    getObservedRevision: async () => "observed-rev-1",
  });
}

function createService(ud = userData) {
  const transactionLock = new FilePathTransactionLock();
  const lock = createProjectSkillsLock({
    transactionLock,
    sharedLockRoot,
    acquireTimeoutMs: 15_000,
  });
  return createProjectSkillsService({
    userData: ud,
    transactionLock,
    sharedLockRoot,
    lock,
    inspectGitState: async () => "absent",
    getObservedRevision: async () => "observed-rev-1",
  });
}

async function listRelativeFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs, rel);
      else out.push(rel);
    }
  }
  await walk(root, "");
  return out.sort();
}

async function enableSkillViaApply(skillId: string, ud = userData) {
  const service = createApplyService(ud);
  const ref = await projectRef();
  const draft = emptyDraft({ enabledBySkillId: { [skillId]: true } });
  const planned = await service.plan(ref, "observed-rev-1", draft);
  expect(planned.applicable).toBe(true);
  const result = await service.apply({
    projectRef: ref,
    observedRevision: "observed-rev-1",
    draft,
    planDigest: planned.planDigest,
    operationId: randomUUID(),
    acknowledgements: [],
  });
  expect(result.status).toBe("converged");
  return result;
}

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "pier-ps-sec-ud-"));
  projectRoot = await mkdtemp(join(tmpdir(), "pier-ps-sec-proj-"));
  sharedLockRoot = await mkdtemp(join(tmpdir(), "pier-ps-sec-lock-"));
});

afterEach(async () => {
  await rm(userData, { force: true, recursive: true });
  await rm(projectRoot, { force: true, recursive: true });
  await rm(sharedLockRoot, { force: true, recursive: true });
});

describe("project-skills security: unmanaged targets", () => {
  it("does not overwrite an unmanaged regular file at the projection path", async () => {
    const digest = await writeLibrarySkill("guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "guide",
          enabled: false,
          contentDigest: digest,
          source: { type: "local-import" },
        },
      ],
    });
    const linkPath = join(projectRoot, ".agents", "skills", "guide");
    await mkdir(dirname(linkPath), { recursive: true });
    await writeFile(linkPath, "user-owned content\n", "utf8");

    const service = createApplyService();
    const ref = await projectRef();
    const draft = emptyDraft({ enabledBySkillId: { guide: true } });
    // Plan preflight surfaces the occupied target as unmanaged-conflict and
    // refuses applicability (design §5.1) — the foreign object is never a
    // scheduled operation, so nothing can overwrite it.
    const planned = await service.plan(ref, "observed-rev-1", draft);
    expect(planned.applicable).toBe(false);
    expect(
      planned.blockingIssues.some(
        (issue) =>
          issue.code === "unmanaged-conflict" && issue.skillId === "guide"
      )
    ).toBe(true);
    expect(
      planned.targetOperations.some(
        (op) => op.relativeTarget === ".agents/skills/guide"
      )
    ).toBe(false);

    await expect(
      service.apply({
        projectRef: ref,
        observedRevision: "observed-rev-1",
        draft,
        planDigest: planned.planDigest,
        operationId: randomUUID(),
        acknowledgements: [],
      })
    ).rejects.toMatchObject({ code: "not-applied" });
    expect(await readFile(linkPath, "utf8")).toBe("user-owned content\n");
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(false);
  });

  it("does not delete an unmanaged symlink that has no ownership ledger entry", async () => {
    const digest = await writeLibrarySkill("guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "guide",
          enabled: true,
          contentDigest: digest,
          source: { type: "local-import" },
        },
      ],
    });
    // Unmanaged projection-looking symlink, no ownership ledger.
    const linkPath = join(projectRoot, ".agents", "skills", "guide");
    await mkdir(dirname(linkPath), { recursive: true });
    await symlink("../../.pier/skills/library/guide", linkPath);

    // Disable via apply — plan wants delete, but no ownership proof.
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "guide",
          enabled: true,
          contentDigest: digest,
          source: { type: "local-import" },
        },
      ],
    });

    const service = createApplyService();
    const ref = await projectRef();
    const draft = emptyDraft({ enabledBySkillId: { guide: false } });
    const planned = await service.plan(ref, "observed-rev-1", draft);
    const result = await service.apply({
      projectRef: ref,
      observedRevision: "observed-rev-1",
      draft,
      planDigest: planned.planDigest,
      operationId: randomUUID(),
      acknowledgements: [],
    });

    // Target must remain — no ownership proof authorizes deletion.
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
    expect(await readlink(linkPath)).toBe("../../.pier/skills/library/guide");
    // Either degraded (delete failed) or converged without touching target.
    if (result.status === "degraded") {
      expect(
        result.pendingIssueIds.some(
          (id) =>
            id.includes("managed-target-modified") || id.includes("unmanaged")
        )
      ).toBe(true);
    }
  });

  it("retains a rewritten symlink when ownership object identity no longer matches", {
    timeout: 20_000,
  }, async () => {
    const digest = await writeLibrarySkill("guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "guide",
          enabled: false,
          contentDigest: digest,
          source: { type: "local-import" },
        },
      ],
    });
    await enableSkillViaApply("guide");

    const linkPath = join(projectRoot, ".agents", "skills", "guide");
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);

    // Rewrite in place: same path + same target, but new inode identity.
    await unlink(linkPath);
    await symlink("../../.pier/skills/library/guide", linkPath);

    const fs = createProjectSkillsFileSystemAdapter();
    const rewrittenIdentity = await fs.lstatIdentity(linkPath);

    const identity = await resolveStableProjectIdentity(projectRoot);
    const store = createProjectSkillsStore({ userData });
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    const ownership = await store.readOwnership(rootKey);
    expect(ownership?.targets).toHaveLength(1);
    const ledgerIdentity = ownership!.targets[0]!.objectIdentity;
    expect(ledgerIdentity.ino).not.toBe(rewrittenIdentity.ino);

    // Disable — delete must refuse identity mismatch and retain the link.
    const service = createApplyService();
    const ref = await projectRef();
    const draft = emptyDraft({ enabledBySkillId: { guide: false } });
    const planned = await service.plan(ref, "observed-rev-1", draft);
    const result = await service.apply({
      projectRef: ref,
      observedRevision: "observed-rev-1",
      draft,
      planDigest: planned.planDigest,
      operationId: randomUUID(),
      acknowledgements: [],
    });

    expect(result.status).toBe("degraded");
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
    expect(await readlink(linkPath)).toBe("../../.pier/skills/library/guide");
    expect(
      result.status === "degraded" &&
        result.pendingIssueIds.some((id) =>
          id.includes("managed-target-modified")
        )
    ).toBe(true);
  });

  it("retains a recreated same-name link and does not adopt it into ownership", async () => {
    const digest = await writeLibrarySkill("guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "guide",
          enabled: false,
          contentDigest: digest,
          source: { type: "local-import" },
        },
      ],
    });
    await enableSkillViaApply("guide");

    const linkPath = join(projectRoot, ".agents", "skills", "guide");
    const identity = await resolveStableProjectIdentity(projectRoot);
    const store = createProjectSkillsStore({ userData });
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    const beforeOwnership = await store.readOwnership(rootKey);
    const beforeIno = beforeOwnership!.targets[0]!.objectIdentity.ino;

    // Delete managed link and recreate identical-looking unmanaged link.
    await unlink(linkPath);
    await symlink("../../.pier/skills/library/guide", linkPath);

    // Re-enable (already enabled in manifest after first apply) — ensureReady
    // / repair must not overwrite or adopt the recreated link.
    const service = createService();
    const ready = await service.ensureReady({
      projectRef: await projectRef(),
      agentId: "codex",
      launchAttemptId: "attempt-recreate",
    });
    expect(ready.status).toBe("blocked");
    if (ready.status !== "blocked") return;
    expect(
      ready.issueSummary.some(
        (i) =>
          i.code === "managed-target-modified" ||
          i.code === "unmanaged-conflict"
      )
    ).toBe(true);

    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
    expect(await readlink(linkPath)).toBe("../../.pier/skills/library/guide");

    const afterOwnership = await store.readOwnership(rootKey);
    // Ownership must still record the original object identity, not adopt.
    expect(afterOwnership!.targets[0]!.objectIdentity.ino).toBe(beforeIno);
  });
});

describe("project-skills security: skills:read has no write side effects", () => {
  it("snapshot, doctor, and plan leave project and userData untouched", async () => {
    const digest = await writeLibrarySkill("guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "guide",
          enabled: true,
          contentDigest: digest,
          source: { type: "git-declared" },
        },
      ],
    });
    const beforeUd = await listRelativeFiles(userData);
    const beforePr = await listRelativeFiles(projectRoot);

    const service = createService();
    const ref = await projectRef();

    const snap = await service.snapshot(ref);
    expect(snap.health.issues).toEqual([]);

    const doctor = await service.doctor(ref);
    expect(doctor.issues).toEqual([]);

    const plan = await service.plan(
      ref,
      "observed-rev-1",
      emptyDraft({ enabledBySkillId: { guide: true } })
    );
    expect(plan.planDigest).toMatch(/^sha256:/);
    expect(plan.applicable).toBe(true);

    const status = await service.operationStatus(ref, randomUUID());
    expect(status.kind).toBe("missing");

    expect(await listRelativeFiles(userData)).toEqual(beforeUd);
    expect(await listRelativeFiles(projectRoot)).toEqual(beforePr);

    // No projections created by reads.
    await expect(
      lstat(join(projectRoot, ".agents", "skills", "guide"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("project-skills security: operation tombstone / terminal idempotency", () => {
  it("replaying a terminal apply operation returns the immutable result without re-execution", async () => {
    const digest = await writeLibrarySkill("guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "guide",
          enabled: false,
          contentDigest: digest,
          source: { type: "local-import" },
        },
      ],
    });
    const service = createApplyService();
    const ref = await projectRef();
    const draft = emptyDraft({ enabledBySkillId: { guide: true } });
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

    const linkPath = join(projectRoot, ".agents", "skills", "guide");
    const fs = createProjectSkillsFileSystemAdapter();
    await fs.lstatIdentity(linkPath);

    // Remove the projection so a re-execution would recreate it with a new inode.
    await unlink(linkPath);

    const second = await service.apply(request);
    expect(second).toEqual(first);

    // Terminal short-circuit must NOT recreate the deleted link.
    await expect(lstat(linkPath)).rejects.toMatchObject({ code: "ENOENT" });

    // Store still holds the same terminal record.
    const identity = await resolveStableProjectIdentity(projectRoot);
    const store = createProjectSkillsStore({ userData });
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);
    const op = await store.readOperation(rootKey, operationId);
    expect(op).toEqual(
      expect.objectContaining({
        kind: "terminal",
        status: "converged",
      })
    );

    // And a missing operation id reports expired/missing — never re-executes.
    const recoveryStatus = await createService().operationStatus(
      ref,
      randomUUID()
    );
    expect(recoveryStatus.kind).toBe("missing");
  });

  it("does not re-execute when a terminal tombstone-style operation record is present", async () => {
    const digest = await writeLibrarySkill("guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "guide",
          enabled: false,
          contentDigest: digest,
          source: { type: "local-import" },
        },
      ],
    });
    const service = createApplyService();
    const ref = await projectRef();
    const draft = emptyDraft({ enabledBySkillId: { guide: true } });
    const planned = await service.plan(ref, "observed-rev-1", draft);
    const operationId = randomUUID();

    // Seed a terminal tombstone directly (compacted result shape).
    const identity = await resolveStableProjectIdentity(projectRoot);
    const store = createProjectSkillsStore({ userData });
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);
    const terminal: OperationRecord = {
      kind: "terminal",
      status: "converged",
      requestDigest: computeApplyRequestDigest({
        operationId,
        planDigest: planned.planDigest,
        observedRevision: "observed-rev-1",
        draft,
        acknowledgements: [],
      }),
      result: {
        status: "converged",
        operationId,
        revisions: {
          manifestRevision: `sha256:${"f".repeat(64)}`,
          observedRevision: "observed-rev-1",
        },
        snapshot: { tombstone: true },
      },
    };
    await store.writeOperation(rootKey, operationId, terminal);

    const beforePr = await listRelativeFiles(projectRoot);
    const result = await service.apply({
      projectRef: ref,
      observedRevision: "observed-rev-1",
      draft,
      planDigest: planned.planDigest,
      operationId,
      acknowledgements: [],
    });

    expect(result.status).toBe("converged");
    if (result.status === "converged") {
      expect(result.snapshot).toEqual({ tombstone: true });
    }
    // No projection writes from replaying a terminal tombstone.
    expect(await listRelativeFiles(projectRoot)).toEqual(beforePr);
    await expect(
      lstat(join(projectRoot, ".agents", "skills", "guide"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("project-skills security: cross-profile isolation", () => {
  it("does not inherit ownership across dual userData stores", async () => {
    const userDataB = await mkdtemp(join(tmpdir(), "pier-ps-sec-ud-b-"));
    try {
      const digest = await writeLibrarySkill("guide");
      await writeManifest({
        version: 1,
        delivery: { agents: true, claude: false },
        skills: [
          {
            id: "guide",
            enabled: false,
            contentDigest: digest,
            source: { type: "local-import" },
          },
        ],
      });

      // Profile A enables and projects.
      await enableSkillViaApply("guide", userData);

      const identity = await resolveStableProjectIdentity(projectRoot);
      const pathsA = createProjectSkillsPaths(userData);
      const pathsB = createProjectSkillsPaths(userDataB);
      const rootKey = pathsA.rootKeyFor(identity);
      expect(pathsB.rootKeyFor(identity)).toBe(rootKey);

      const storeA = createProjectSkillsStore({ userData });
      const storeB = createProjectSkillsStore({ userData: userDataB });

      const ownershipA = await storeA.readOwnership(rootKey);
      expect(ownershipA?.targets.length).toBeGreaterThan(0);

      // Profile B sees no ownership for the same project identity.
      expect(await storeB.readOwnership(rootKey)).toBeNull();

      // Profile B must not adopt profile A's projection into its ownership.
      const serviceB = createService(userDataB);
      const ready = await serviceB.ensureReady({
        projectRef: await projectRef(),
        agentId: "codex",
        launchAttemptId: "profile-b-attempt",
      });
      expect(ready.status).toBe("blocked");
      if (ready.status !== "blocked") return;
      expect(
        ready.issueSummary.some((i) => i.code === "unmanaged-conflict")
      ).toBe(true);

      expect(await storeB.readOwnership(rootKey)).toBeNull();

      // Profile A's projection and ownership remain intact.
      const linkPath = join(projectRoot, ".agents", "skills", "guide");
      expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
      expect(
        (await storeA.readOwnership(rootKey))?.targets.length
      ).toBeGreaterThan(0);

      // Profile B cannot delete profile A's managed projection via disable apply
      // without its own ownership proof.
      const applyB = createApplyService(userDataB);
      // Manifest currently has enabled=true after profile A apply.
      const draft = emptyDraft({ enabledBySkillId: { guide: false } });
      const planned = await applyB.plan(
        await projectRef(),
        "observed-rev-1",
        draft
      );
      await applyB.apply({
        projectRef: await projectRef(),
        observedRevision: "observed-rev-1",
        draft,
        planDigest: planned.planDigest,
        operationId: randomUUID(),
        acknowledgements: [],
      });
      // Link created by profile A must survive profile B's disable attempt
      // when B has no matching ownership identity (or at minimum B does not
      // silently adopt A's ownership).
      expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);

      const ownershipBAfter = await storeB.readOwnership(rootKey);
      if (ownershipBAfter) {
        // If B wrote anything, it must not claim A's inode as owned-for-delete
        // without having created it — empty targets is the safe outcome when
        // disable could not prove ownership.
        const fs = createProjectSkillsFileSystemAdapter();
        const current = await fs.lstatIdentity(linkPath);
        const claimed = ownershipBAfter.targets.find(
          (t) => t.relativePath === ".agents/skills/guide"
        );
        if (claimed) {
          // B must not have recorded A's object as its own managed target
          // for deletion authority after a failed adopt — if it recorded
          // something, identity must match what B itself published.
          expect(claimed.objectIdentity.ino).toBe(current.ino);
        }
      }
    } finally {
      await rm(userDataB, { force: true, recursive: true });
    }
  });

  it("refuses apply symlink publish when .agents escapes the project via symlink", async () => {
    const outside = await mkdtemp(join(tmpdir(), "pier-skills-escape-"));
    try {
      await symlink(outside, join(projectRoot, ".agents"));
      const digest = await writeLibrarySkill("guide");
      await writeManifest({
        version: 1,
        delivery: { agents: true, claude: false },
        skills: [
          {
            id: "guide",
            enabled: false,
            contentDigest: digest,
            source: { type: "local-import" },
          },
        ],
      });

      const service = createApplyService();
      const ref = await projectRef();
      const draft = emptyDraft({ enabledBySkillId: { guide: true } });
      const planned = await service.plan(ref, "observed-rev-1", draft);
      expect(planned.applicable).toBe(true);

      await expect(
        service.apply({
          projectRef: ref,
          observedRevision: "observed-rev-1",
          draft,
          planDigest: planned.planDigest,
          operationId: randomUUID(),
          acknowledgements: [],
        })
      ).rejects.toThrow(/symbolic link/i);

      await expect(
        lstat(join(outside, "skills", "guide"))
      ).rejects.toMatchObject({ code: "ENOENT" });
      const outsideEntries = await readdir(outside);
      expect(outsideEntries).not.toContain("skills");
    } finally {
      await rm(outside, { force: true, recursive: true });
    }
  });
});
