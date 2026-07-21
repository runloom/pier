import {
  lstat,
  mkdir,
  mkdtemp,
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
import type { ProjectSkillsManifest } from "@shared/contracts/project-skills.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let userData: string;
let projectRoot: string;
let sharedLockRoot: string;

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "pier-ps-enabled-ud-"));
  projectRoot = await mkdtemp(join(tmpdir(), "pier-ps-enabled-proj-"));
  sharedLockRoot = await mkdtemp(join(tmpdir(), "pier-ps-enabled-lock-"));
});

afterEach(async () => {
  await Promise.all(
    [userData, projectRoot, sharedLockRoot].map((dir) =>
      rm(dir, { force: true, recursive: true })
    )
  );
});

async function writeEnabledSkill(skillId: string): Promise<void> {
  const skillsRoot = join(projectRoot, ".pier", "skills");
  const libraryDir = join(skillsRoot, "library", skillId);
  await mkdir(libraryDir, { recursive: true });
  await writeFile(
    join(libraryDir, "SKILL.md"),
    `---\nname: ${skillId}\ndescription: enabled skill\n---\n# ${skillId}\n`,
    "utf8"
  );
  const manifest: ProjectSkillsManifest = {
    version: 1,
    delivery: { agents: true, claude: false },
    skills: [
      {
        id: skillId,
        enabled: true,
        contentDigest: await computeTreeSha256V1(libraryDir),
        source: { type: "git-declared" },
      },
    ],
  };
  await writeFile(
    join(skillsRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

describe("project-skills enabled projection", () => {
  it("projects an enabled valid library skill during ensureReady", async () => {
    await writeEnabledSkill("review-guide");
    const identity = await resolveStableProjectIdentity(projectRoot);
    const transactionLock = new FilePathTransactionLock();
    const service = createProjectSkillsService({
      userData,
      transactionLock,
      sharedLockRoot,
      lock: createProjectSkillsLock({
        transactionLock,
        sharedLockRoot,
        acquireTimeoutMs: 2000,
      }),
      inspectGitState: async () => "absent",
      getObservedRevision: async () => "observed-rev-1",
    });

    const result = await service.ensureReady({
      projectRef: toContractProjectRootRef(identity),
      agentId: "codex",
      launchAttemptId: "attempt-enabled",
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.repaired).toBe(true);
    const link = join(projectRoot, ".agents", "skills", "review-guide");
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe(
      "../../.pier/skills/library/review-guide"
    );
  });
});
