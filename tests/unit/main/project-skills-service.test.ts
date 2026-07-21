import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilePathTransactionLock } from "@main/services/file-path-transaction-lock.ts";
import {
  resolveStableProjectIdentity,
  toContractProjectRootRef,
} from "@main/services/project-skills/identity.ts";
import { createProjectSkillsLock } from "@main/services/project-skills/lock.ts";
import { createProjectSkillsService } from "@main/services/project-skills/service.ts";
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
    `---\nname: ${skillId}\ndescription: test skill\n---\n# ${skillId}\n`,
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

function createService(args?: {
  onInvalidated?: (event: {
    projectIdentity: string;
    observedRevision: string;
  }) => void;
  listKnownProjectRoots?: () => Promise<
    Array<{ realPath: string; source: "panel" | "environment" | "unknown" }>
  >;
}) {
  const transactionLock = new FilePathTransactionLock();
  const lock = createProjectSkillsLock({
    transactionLock,
    sharedLockRoot,
    acquireTimeoutMs: 15_000,
  });
  return createProjectSkillsService({
    userData,
    transactionLock,
    sharedLockRoot,
    lock,
    inspectGitState: async () => "absent",
    getObservedRevision: async () => "observed-rev-1",
    ...(args?.onInvalidated ? { onInvalidated: args.onInvalidated } : {}),
    ...(args?.listKnownProjectRoots
      ? { listKnownProjectRoots: args.listKnownProjectRoots }
      : {}),
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

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "pier-ps-svc-ud-"));
  projectRoot = await mkdtemp(join(tmpdir(), "pier-ps-svc-proj-"));
  sharedLockRoot = await mkdtemp(join(tmpdir(), "pier-ps-svc-lock-"));
});

afterEach(async () => {
  await rm(userData, { force: true, recursive: true });
  await rm(projectRoot, { force: true, recursive: true });
  await rm(sharedLockRoot, { force: true, recursive: true });
});

describe("project-skills service facade", () => {
  it("requires shared transactionLock", () => {
    expect(() =>
      createProjectSkillsService({
        userData,
        // @ts-expect-error intentional missing lock
        transactionLock: undefined,
      })
    ).toThrow(/transactionLock/);
  });

  it("snapshot and doctor are read-only for an enabled valid skill", async () => {
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
    const before = await listRelativeFiles(userData);
    const beforeProject = await listRelativeFiles(projectRoot);

    const service = createService();
    const snap = await service.snapshot(await projectRef());
    expect(snap.manifest?.skills).toHaveLength(1);
    expect(snap.health.issues).toEqual([]);

    const doctor = await service.doctor(await projectRef());
    expect(doctor.issues).toEqual([]);

    expect(await listRelativeFiles(userData)).toEqual(before);
    expect(await listRelativeFiles(projectRoot)).toEqual(beforeProject);
  });

  it("plan is read-only", async () => {
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
    const before = await listRelativeFiles(projectRoot);
    const service = createService();
    const plan = await service.plan(
      await projectRef(),
      "observed-rev-1",
      emptyDraft({ enabledBySkillId: { guide: true } })
    );
    expect(plan.planDigest).toMatch(/^sha256:/);
    expect(await listRelativeFiles(projectRoot)).toEqual(before);
  });

  it("projectsSnapshot aggregates known roots without write", async () => {
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [],
    });
    const before = await listRelativeFiles(userData);
    const service = createService({
      listKnownProjectRoots: async () => [
        { realPath: projectRoot, source: "environment" },
      ],
    });
    const list = await service.projectsSnapshot();
    expect(list).toHaveLength(1);
    expect(list[0]?.readStatus).toBe("ok");
    expect(list[0]?.skillCount).toBe(0);
    expect(await listRelativeFiles(userData)).toEqual(before);
  });

  it("includes the active project even when it is not indexed", async () => {
    const service = createService({
      listKnownProjectRoots: async () => [],
    });
    const list = await service.projectsSnapshot(projectRoot);
    const identity = await resolveStableProjectIdentity(projectRoot);
    expect(list).toHaveLength(1);
    expect(list[0]?.projectRef.realPath).toBe(identity.realPath);
    expect(list[0]?.source).toBe("panel");
  });

  it("projectsSnapshot deduplicates panel and index entries for the same identity", async () => {
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [],
    });
    const service = createService({
      listKnownProjectRoots: async () => [
        { realPath: projectRoot, source: "panel" },
        { realPath: projectRoot, source: "environment" },
      ],
    });
    const list = await service.projectsSnapshot();
    expect(list).toHaveLength(1);
    // Panel entries keep list position (current project pins to the top),
    // but "environment" is the stronger fact: it marks the project as
    // explicitly added to the shared index (drives direct-to-detail, §7.1).
    expect(list[0]?.source).toBe("environment");
  });

  it("apply broadcasts invalidated after converge", {
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
    const events: Array<{ projectIdentity: string; observedRevision: string }> =
      [];
    const service = createService({
      onInvalidated: (e) => events.push(e),
    });
    const ref = await projectRef();
    const plan = await service.plan(
      ref,
      "observed-rev-1",
      emptyDraft({ enabledBySkillId: { guide: true } })
    );
    const result = await service.apply({
      projectRef: ref,
      observedRevision: "observed-rev-1",
      draft: emptyDraft({ enabledBySkillId: { guide: true } }),
      planDigest: plan.planDigest,
      operationId: randomUUID(),
      acknowledgements: [],
    });
    expect(result.status).toBe("converged");
    expect(events.length).toBeGreaterThanOrEqual(1);
    const link = join(projectRoot, ".agents", "skills", "guide");
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe("../../.pier/skills/library/guide");
  });

  it("user-root whitelist derives from the adapter registry (~-relative only)", async () => {
    // The user-global enumeration feeds the effective matrix (Claude
    // personal-shadows-project fact); it is registry-derived, read-only.
    const { enumerateUserGlobalSkills } = await import(
      "@main/services/project-skills/enumeration.ts"
    );
    const { createSkillDiscoveryAdapterRegistry } = await import(
      "@main/services/project-skills/adapters.ts"
    );
    const before = await listRelativeFiles(userData);
    const result = await enumerateUserGlobalSkills({
      registry: createSkillDiscoveryAdapterRegistry(),
      withMetadata: false,
    });
    expect(result.groups.length).toBeGreaterThan(0);
    for (const group of result.groups) {
      expect(group.root.startsWith("~/")).toBe(true);
    }
    expect(await listRelativeFiles(userData)).toEqual(before);
  });
});
