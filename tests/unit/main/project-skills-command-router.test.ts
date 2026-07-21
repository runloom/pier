import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClientRegistry } from "@main/app-core/client-registry.ts";
import { createCommandRouter } from "@main/app-core/command-router.ts";
import type { PierCoreServices } from "@main/app-core/command-router-services.ts";
import { FilePathTransactionLock } from "@main/services/file-path-transaction-lock.ts";
import {
  resolveStableProjectIdentity,
  toContractProjectRootRef,
} from "@main/services/project-skills/identity.ts";
import { createProjectSkillsService } from "@main/services/project-skills/service.ts";
import { computeTreeSha256V1 } from "@main/services/project-skills/tree-digest.ts";
import type { PierCommand } from "@shared/contracts/commands.ts";
import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  type PierClientKind,
} from "@shared/contracts/permissions.ts";
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
    `---\nname: ${skillId}\ndescription: test\n---\n# ${skillId}\n`,
    "utf8"
  );
  return computeTreeSha256V1(dir);
}

async function projectRef() {
  return toContractProjectRootRef(
    await resolveStableProjectIdentity(projectRoot)
  );
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
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel);
      else out.push(rel);
    }
  }
  await walk(root, "");
  return out.sort();
}

function clientOf(kind: PierClientKind) {
  const now = Date.now();
  return {
    capabilities: [...DEFAULT_CAPABILITIES_BY_CLIENT_KIND[kind]],
    createdAt: now,
    id: `${kind}-1`,
    kind,
    lastSeenAt: now,
  };
}

function envelope(clientId: string, command: PierCommand) {
  return {
    clientId,
    command,
    protocolVersion: 1 as const,
    requestId: randomUUID(),
  };
}

function createRouter(kind: PierClientKind = "desktop-renderer") {
  const transactionLock = new FilePathTransactionLock();
  const projectSkills = createProjectSkillsService({
    userData,
    transactionLock,
    sharedLockRoot,
    inspectGitState: async () => "absent",
    getObservedRevision: async () => "observed-rev-1",
  });
  const clients = createClientRegistry();
  clients.register(clientOf(kind));
  const services = {
    projectSkills,
  } as unknown as PierCoreServices;
  return {
    router: createCommandRouter({ clients, services }),
    clientId: `${kind}-1`,
  };
}

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "pier-ps-cmd-ud-"));
  projectRoot = await mkdtemp(join(tmpdir(), "pier-ps-cmd-proj-"));
  sharedLockRoot = await mkdtemp(join(tmpdir(), "pier-ps-cmd-lock-"));
});

afterEach(async () => {
  await rm(userData, { force: true, recursive: true });
  await rm(projectRoot, { force: true, recursive: true });
  await rm(sharedLockRoot, { force: true, recursive: true });
});

describe("project-skills command router", () => {
  it("executes skills.doctor via router", async () => {
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
    const { router, clientId } = createRouter();
    const result = await router.execute(
      envelope(clientId, {
        type: "skills.doctor",
        projectRef: await projectRef(),
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { issues: Array<{ code: string }> };
    expect(data.issues).toEqual([]);
  });

  it("skills:read doctor has no write side effects", async () => {
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
    const beforeUd = await listRelativeFiles(userData);
    const beforePr = await listRelativeFiles(projectRoot);
    const { router, clientId } = createRouter("cli-local");
    const result = await router.execute(
      envelope(clientId, {
        type: "skills.doctor",
        projectRef: await projectRef(),
      })
    );
    expect(result.ok).toBe(true);
    expect(await listRelativeFiles(userData)).toEqual(beforeUd);
    expect(await listRelativeFiles(projectRoot)).toEqual(beforePr);
  });

  it("cli-local cannot call skills.apply", async () => {
    const { router, clientId } = createRouter("cli-local");
    const result = await router.execute(
      envelope(clientId, {
        type: "skills.apply",
        projectRef: await projectRef(),
        observedRevision: "observed-rev-1",
        draft: {
          deliveryAgents: true,
          deliveryClaude: false,
          enabledBySkillId: {},
          importTokens: [],
          deleteSkillIds: [],
        },
        planDigest: `sha256:${"a".repeat(64)}`,
        operationId: randomUUID(),
        acknowledgements: [],
      })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("permission_denied");
  });

  it("skills.snapshot and skills.plan succeed for desktop", async () => {
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
    const { router, clientId } = createRouter();
    const ref = await projectRef();
    const snap = await router.execute(
      envelope(clientId, { type: "skills.snapshot", projectRef: ref })
    );
    expect(snap.ok).toBe(true);

    const plan = await router.execute(
      envelope(clientId, {
        type: "skills.plan",
        projectRef: ref,
        observedRevision: "observed-rev-1",
        draft: {
          deliveryAgents: true,
          deliveryClaude: false,
          enabledBySkillId: { guide: true },
          importTokens: [],
          deleteSkillIds: [],
        },
      })
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect((plan.data as { planDigest: string }).planDigest).toMatch(
      /^sha256:/
    );
  });

  it("skills.repair.plan is available", async () => {
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [],
    });
    const { router, clientId } = createRouter();
    const result = await router.execute(
      envelope(clientId, {
        type: "skills.repair.plan",
        projectRef: await projectRef(),
        observedRevision: "observed-rev-1",
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      (result.data as { repairPlanDigest: string }).repairPlanDigest
    ).toMatch(/^sha256:/);
  });
});
