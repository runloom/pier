import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilePathTransactionLock } from "@main/services/file-path-transaction-lock.ts";
import {
  cleanupLibrarySkillByIdentity,
  createProjectSkillsApplyService,
} from "@main/services/project-skills/apply-service.ts";
import { createProjectSkillsFileSystemAdapter } from "@main/services/project-skills/fs-adapter.ts";
import {
  resolveStableProjectIdentity,
  toContractProjectRootRef,
} from "@main/services/project-skills/identity.ts";
import { createProjectSkillsLock } from "@main/services/project-skills/lock.ts";
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
    `---\nname: ${skillId}\ndescription: cleanup skill\n---\n# ${skillId}\n`,
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

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "pier-ps-cleanup-ud-"));
  projectRoot = await mkdtemp(join(tmpdir(), "pier-ps-cleanup-proj-"));
  sharedLockRoot = await mkdtemp(join(tmpdir(), "pier-ps-cleanup-lock-"));
});

afterEach(async () => {
  await rm(userData, { force: true, recursive: true });
  await rm(projectRoot, { force: true, recursive: true });
  await rm(sharedLockRoot, { force: true, recursive: true });
});

describe("project-skills library cleanup by object identity", () => {
  it("removes matching files by identity then rmdir; never recursive rm", async () => {
    const skillId = "old-skill";
    const libraryDir = join(projectRoot, ".pier", "skills", "library", skillId);
    await mkdir(libraryDir, { recursive: true });
    await writeFile(join(libraryDir, "SKILL.md"), "# old\n", "utf8");
    await writeFile(join(libraryDir, "notes.txt"), "notes\n", "utf8");

    const fs = createProjectSkillsFileSystemAdapter();
    const skillMdId = await fs.lstatIdentity(join(libraryDir, "SKILL.md"));
    const notesId = await fs.lstatIdentity(join(libraryDir, "notes.txt"));
    const dirId = await fs.lstatIdentity(libraryDir);

    const result = await cleanupLibrarySkillByIdentity({
      libraryDir,
      expectedEntries: [
        {
          relativePath: "SKILL.md",
          kind: "file",
          identity: skillMdId,
        },
        {
          relativePath: "notes.txt",
          kind: "file",
          identity: notesId,
        },
        {
          relativePath: ".",
          kind: "directory",
          identity: dirId,
        },
      ],
    });

    expect(result.status).toBe("removed");
    await expect(lstat(libraryDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps new files unknown to the recovery log and reports cleanup-pending", async () => {
    const skillId = "lingering";
    const libraryDir = join(projectRoot, ".pier", "skills", "library", skillId);
    await mkdir(libraryDir, { recursive: true });
    await writeFile(join(libraryDir, "SKILL.md"), "# base\n", "utf8");

    const fs = createProjectSkillsFileSystemAdapter();
    const skillMdId = await fs.lstatIdentity(join(libraryDir, "SKILL.md"));
    const dirId = await fs.lstatIdentity(libraryDir);

    // User/agent dropped a new file after the cleanup plan was recorded.
    await writeFile(join(libraryDir, "NEW_USER_FILE.md"), "keep me\n", "utf8");

    const result = await cleanupLibrarySkillByIdentity({
      libraryDir,
      expectedEntries: [
        {
          relativePath: "SKILL.md",
          kind: "file",
          identity: skillMdId,
        },
        {
          relativePath: ".",
          kind: "directory",
          identity: dirId,
        },
      ],
    });

    expect(result.status).toBe("cleanup-pending");
    if (result.status !== "cleanup-pending") {
      throw new Error("expected cleanup-pending");
    }
    expect(result.retainedRelativePaths).toEqual(
      expect.arrayContaining(["NEW_USER_FILE.md"])
    );
    expect(await readFile(join(libraryDir, "NEW_USER_FILE.md"), "utf8")).toBe(
      "keep me\n"
    );
    // Matched planned file removed.
    await expect(lstat(join(libraryDir, "SKILL.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    // Directory retained because non-empty.
    expect((await lstat(libraryDir)).isDirectory()).toBe(true);
  });

  it("does not delete a file whose identity no longer matches the log", async () => {
    const skillId = "rewritten";
    const libraryDir = join(projectRoot, ".pier", "skills", "library", skillId);
    await mkdir(libraryDir, { recursive: true });
    const path = join(libraryDir, "SKILL.md");
    await writeFile(path, "# v1\n", "utf8");

    const fs = createProjectSkillsFileSystemAdapter();
    const originalId = await fs.lstatIdentity(path);

    // Replace file → new inode/identity.
    await rm(path);
    await writeFile(path, "# v2 rewritten\n", "utf8");

    const result = await cleanupLibrarySkillByIdentity({
      libraryDir,
      expectedEntries: [
        {
          relativePath: "SKILL.md",
          kind: "file",
          identity: originalId,
        },
      ],
    });

    expect(result.status).toBe("cleanup-pending");
    expect(await readFile(path, "utf8")).toBe("# v2 rewritten\n");
  });

  it("apply deleteSkillIds cleans library only by logged identities and degrades on new files", async () => {
    const digest = await writeLibrarySkill("doomed");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "doomed",
          enabled: false,
          contentDigest: digest,
          source: { type: "local-import" },
        },
      ],
    });
    const libraryDir = join(
      projectRoot,
      ".pier",
      "skills",
      "library",
      "doomed"
    );

    // Inject unknown content AFTER cleanup identities are logged so it must be retained.
    const transactionLock = new FilePathTransactionLock();
    const lock = createProjectSkillsLock({
      transactionLock,
      sharedLockRoot,
      acquireTimeoutMs: 2000,
    });
    const service = createProjectSkillsApplyService({
      userData,
      lock,
      inspectGitState: async () => "absent",
      getObservedRevision: async () => "observed-rev-1",
      hooks: {
        afterPhase: async (phase) => {
          if (phase === "CONTENT_PUBLISHED") {
            await writeFile(
              join(libraryDir, "EXTRA.md"),
              "user added\n",
              "utf8"
            );
          }
        },
      },
    });

    const ref = await projectRef();
    const draft = emptyDraft({ deleteSkillIds: ["doomed"] });
    const planned = await service.plan(ref, "observed-rev-1", draft);
    const operationId = randomUUID();

    // Library content deletion always carries a confirmation requirement
    // (design §7.3: delete = pending mark + undo, confirm at apply).
    const contentDelete = planned.confirmationRequirements.find(
      (req) => req.kind === "content-delete" && req.skillId === "doomed"
    );
    expect(contentDelete).toBeDefined();
    expect(contentDelete?.kind).toBe("content-delete");

    const result = await service.apply({
      projectRef: ref,
      observedRevision: "observed-rev-1",
      draft,
      planDigest: planned.planDigest,
      operationId,
      acknowledgements:
        contentDelete && contentDelete.kind === "content-delete"
          ? [
              {
                requirementId: contentDelete.id,
                nonce: randomUUID(),
                ...(contentDelete.expectedActualTreeDigest === undefined
                  ? {}
                  : {
                      expectedActualTreeDigest:
                        contentDelete.expectedActualTreeDigest,
                    }),
              },
            ]
          : [],
    });

    // Manifest no longer lists skill; cleanup-pending because EXTRA.md retained.
    expect(result.status).toBe("degraded");
    if (result.status !== "degraded") return;
    expect(result.pendingIssueIds.some((id) => id.includes("cleanup"))).toBe(
      true
    );

    const remaining = await readdir(libraryDir);
    expect(remaining).toContain("EXTRA.md");
    expect(remaining).not.toContain("SKILL.md");

    const raw = await readFile(
      join(projectRoot, ".pier", "skills", "manifest.json"),
      "utf8"
    );
    const manifest = JSON.parse(raw) as ProjectSkillsManifest;
    expect(manifest.skills.find((s) => s.id === "doomed")).toBeUndefined();
  });
});
