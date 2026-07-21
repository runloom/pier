import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilePathTransactionLock } from "@main/services/file-path-transaction-lock.ts";
import { createProjectSkillsFileSystemAdapter } from "@main/services/project-skills/fs-adapter.ts";
import {
  resolveStableProjectIdentity,
  toContractProjectRootRef,
} from "@main/services/project-skills/identity.ts";
import { createProjectSkillsLock } from "@main/services/project-skills/lock.ts";
import { createProjectSkillsPaths } from "@main/services/project-skills/paths.ts";
import { createProjectSkillsRepairService } from "@main/services/project-skills/repair-service.ts";
import {
  createProjectSkillsStore,
  type OwnershipRecord,
} from "@main/services/project-skills/store.ts";
import {
  createSystemSkillsChannel,
  type SystemSkillsChannel,
} from "@main/services/project-skills/system-skills.ts";
import { computeTreeSha256V1 } from "@main/services/project-skills/tree-digest.ts";
import type { ProjectSkillsManifest } from "@shared/contracts/project-skills.ts";
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
  return toContractProjectRootRef(
    await resolveStableProjectIdentity(projectRoot)
  );
}

function createRepair(args?: {
  onInvalidated?: (event: {
    projectIdentity: string;
    observedRevision: string;
  }) => void;
  systemSkills?: SystemSkillsChannel;
}) {
  const transactionLock = new FilePathTransactionLock();
  const lock = createProjectSkillsLock({
    transactionLock,
    sharedLockRoot,
    acquireTimeoutMs: 2000,
  });
  return createProjectSkillsRepairService({
    userData,
    lock,
    inspectGitState: async () => "absent",
    getObservedRevision: async () => "observed-rev-1",
    ...(args?.systemSkills ? { systemSkills: args.systemSkills } : {}),
    ...(args?.onInvalidated ? { onInvalidated: args.onInvalidated } : {}),
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

describe("project-skills repair / ensureReady", () => {
  it("manifest three-state: absent + no ledger is no-op", async () => {
    const repair = createRepair();
    const plan = await repair.repairPlan(await projectRef(), "observed-rev-1");
    expect(plan.targetOperations).toEqual([]);
    expect(plan.executable).toBe(true);
  });

  it("manifest three-state: invalid manifest blocks", async () => {
    const dir = join(projectRoot, ".pier", "skills");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "manifest.json"), "{not-json", "utf8");
    const repair = createRepair();
    const plan = await repair.repairPlan(await projectRef(), "observed-rev-1");
    expect(plan.blockingIssues.some((i) => i.code === "invalid-skill")).toBe(
      true
    );
    expect(plan.executable).toBe(false);
  });

  it("manifest three-state: empty enabled set plans ownership cleanup", async () => {
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [],
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const store = createProjectSkillsStore({ userData });
    const paths = createProjectSkillsPaths(userData);
    const agentsDir = join(projectRoot, ".agents", "skills");
    await mkdir(agentsDir, { recursive: true });
    const linkPath = join(agentsDir, "old-skill");
    await symlink("../../.pier/skills/library/old-skill", linkPath);
    const id =
      await createProjectSkillsFileSystemAdapter().lstatIdentity(linkPath);
    const ownership: OwnershipRecord = {
      schemaVersion: 1,
      generation: 1,
      projectIdentity: identity,
      targets: [
        {
          relativePath: ".agents/skills/old-skill",
          skillId: "old-skill",
          expectedRelativeLinkTarget: "../../.pier/skills/library/old-skill",
          objectIdentity: {
            dev: id.dev,
            ino: id.ino,
            mode: id.mode,
            nlink: id.nlink,
            isDirectory: id.isDirectory,
            isSymbolicLink: id.isSymbolicLink,
          },
          createdByOperationId: "op-old",
          createdAt: 1,
        },
      ],
    };
    await store.commitOwnership(paths.rootKeyFor(identity), 0, ownership);

    const repair = createRepair();
    const plan = await repair.repairPlan(await projectRef(), "observed-rev-1");
    expect(
      plan.targetOperations.some(
        (op) =>
          op.kind === "delete-symlink" &&
          op.relativeTarget === ".agents/skills/old-skill"
      )
    ).toBe(true);
  });

  it("ensureReady auto-repairs missing projection for an enabled valid skill", async () => {
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
    const events: Array<{ projectIdentity: string }> = [];
    const repair = createRepair({
      onInvalidated: (e) => events.push(e),
    });
    const result = await repair.ensureReady({
      projectRef: await projectRef(),
      agentId: "codex",
      launchAttemptId: "attempt-2",
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.repaired).toBe(true);
    const link = join(projectRoot, ".agents", "skills", "guide");
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe("../../.pier/skills/library/guide");
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("ensureReady does not rewrite manifest", async () => {
    const digest = await writeLibrarySkill("guide");
    const manifest: ProjectSkillsManifest = {
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
    };
    await writeManifest(manifest);
    const before = await readFile(
      join(projectRoot, ".pier", "skills", "manifest.json"),
      "utf8"
    );
    const repair = createRepair();
    await repair.ensureReady({
      projectRef: await projectRef(),
      agentId: "codex",
      launchAttemptId: "attempt-3",
    });
    const after = await readFile(
      join(projectRoot, ".pier", "skills", "manifest.json"),
      "utf8"
    );
    expect(after).toBe(before);
  });

  it("explicit repair converges missing projection", async () => {
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
    const repair = createRepair();
    const plan = await repair.repairPlan(await projectRef(), "observed-rev-1");
    expect(
      plan.targetOperations.some((op) => op.kind === "create-symlink")
    ).toBe(true);
    const result = await repair.repair({
      projectRef: await projectRef(),
      observedRevision: "observed-rev-1",
      operationId: randomUUID(),
      repairPlanDigest: plan.repairPlanDigest,
      acknowledgements: [],
    });
    expect(result.status).toBe("converged");
    const link = join(projectRoot, ".agents", "skills", "guide");
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
  });

  it("ensureReady does not adopt unmanaged existing target", async () => {
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
    const agentsDir = join(projectRoot, ".agents", "skills");
    await mkdir(agentsDir, { recursive: true });
    // Unmanaged real directory conflict.
    await mkdir(join(agentsDir, "guide"), { recursive: true });
    await writeFile(
      join(agentsDir, "guide", "SKILL.md"),
      "# foreign\n",
      "utf8"
    );

    const repair = createRepair();
    const result = await repair.ensureReady({
      projectRef: await projectRef(),
      agentId: "codex",
      launchAttemptId: "attempt-4",
    });
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(
      result.issueSummary.some((i) => i.code === "unmanaged-conflict")
    ).toBe(true);
    // Still a directory, not replaced.
    expect((await lstat(join(agentsDir, "guide"))).isDirectory()).toBe(true);
  });

  it("ensureReady preserves and admits a desired system projection", async () => {
    const source = join(userData, "system-source");
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: pier-test-capability\ndescription: test capability\n---\n# Test\n",
      "utf8"
    );
    const systemSkills = createSystemSkillsChannel({
      userData,
      isProduction: false,
      contributions: [
        {
          id: "pier-test-capability",
          contentDir: source,
          provider: { id: "pier.test", version: "1.0.0" },
        },
      ],
    });
    const repair = createRepair({ systemSkills });

    const first = await repair.ensureReady({
      projectRef: await projectRef(),
      agentId: "codex",
      launchAttemptId: "system-attempt-1",
    });
    expect(first.status).toBe("ready");
    const target = join(
      projectRoot,
      ".agents",
      "skills",
      "pier-test-capability"
    );
    expect(await readlink(target)).toBe(
      "../../.pier/skills/library/pier-test-capability"
    );

    const second = await repair.ensureReady({
      projectRef: await projectRef(),
      agentId: "codex",
      launchAttemptId: "system-attempt-2",
    });
    expect(second.status).toBe("ready");
    expect(await readlink(target)).toBe(
      "../../.pier/skills/library/pier-test-capability"
    );
  });

  it("ensureReady launch-blocks a foreign system projection target", async () => {
    const source = join(userData, "system-source");
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: pier-test-capability\ndescription: test capability\n---\n# Test\n",
      "utf8"
    );
    const target = join(
      projectRoot,
      ".agents",
      "skills",
      "pier-test-capability"
    );
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "SKILL.md"), "# foreign\n", "utf8");
    const systemSkills = createSystemSkillsChannel({
      userData,
      isProduction: false,
      contributions: [
        {
          id: "pier-test-capability",
          contentDir: source,
          provider: { id: "pier.test", version: "1.0.0" },
        },
      ],
    });

    const result = await createRepair({ systemSkills }).ensureReady({
      projectRef: await projectRef(),
      agentId: "codex",
      launchAttemptId: "system-conflict-attempt",
    });
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.issueSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unmanaged-conflict",
          skillId: "pier-test-capability",
          relativeTarget: ".agents/skills/pier-test-capability",
        }),
      ])
    );
    expect((await lstat(target)).isDirectory()).toBe(true);
    expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe(
      "# foreign\n"
    );
  });
});
