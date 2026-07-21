import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StableProjectIdentity } from "@main/services/project-skills/identity.ts";
import { createProjectSkillsPaths } from "@main/services/project-skills/paths.ts";
import {
  createProjectSkillsStore,
  type OwnershipRecord,
  ProjectSkillsGenerationConflict,
  ProjectSkillsLedgerCorrupt,
  ProjectSkillsOperationConflict,
  ProjectSkillsStagingConflict,
  type StagingCandidateRecord,
} from "@main/services/project-skills/store.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let userData: string;
const identity: StableProjectIdentity = {
  directoryIdentity: "1:42:100",
  realPath: "/tmp/project-a",
  volumeId: "vol-1",
};

function sampleOwnership(generation: number): OwnershipRecord {
  return {
    generation,
    projectIdentity: identity,
    schemaVersion: 1,
    targets: [
      {
        createdAt: 1_700_000_000_000,
        createdByOperationId: "op-create-1",
        expectedRelativeLinkTarget: "../../.pier/skills/library/review-guide",
        objectIdentity: {
          dev: 1,
          ino: 99,
          isDirectory: false,
          isSymbolicLink: true,
          mode: 0o12_0755,
          nlink: 1,
        },
        relativePath: ".agents/skills/review-guide",
        skillId: "review-guide",
      },
    ],
  };
}

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "pier-project-skills-store-"));
});

afterEach(async () => {
  await rm(userData, { force: true, recursive: true });
});

describe("project-skills store ownership", () => {
  it("returns null when ownership is absent", async () => {
    const store = createProjectSkillsStore({ userData });
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);

    await expect(store.readOwnership(rootKey)).resolves.toBeNull();
  });

  it("commits ownership with generation CAS from absent (expectedGen 0)", async () => {
    const store = createProjectSkillsStore({ userData });
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    const next = sampleOwnership(1);

    await store.commitOwnership(rootKey, 0, next);
    await expect(store.readOwnership(rootKey)).resolves.toEqual(next);
  });

  it("rejects ownership CAS when expected generation does not match", async () => {
    const store = createProjectSkillsStore({ userData });
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);

    await store.commitOwnership(rootKey, 0, sampleOwnership(1));

    await expect(
      store.commitOwnership(rootKey, 0, sampleOwnership(1))
    ).rejects.toBeInstanceOf(ProjectSkillsGenerationConflict);

    await expect(
      store.commitOwnership(rootKey, 2, sampleOwnership(3))
    ).rejects.toBeInstanceOf(ProjectSkillsGenerationConflict);

    await expect(store.readOwnership(rootKey)).resolves.toEqual(
      sampleOwnership(1)
    );
  });

  it("advances ownership only when expectedGen matches current generation", async () => {
    const store = createProjectSkillsStore({ userData });
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);

    await store.commitOwnership(rootKey, 0, sampleOwnership(1));
    const second = sampleOwnership(2);
    second.targets = [];
    await store.commitOwnership(rootKey, 1, second);
    await expect(store.readOwnership(rootKey)).resolves.toEqual(second);
  });
});

describe("project-skills store corrupt isolation", () => {
  it("isolates corrupt ownership via PREPARED tombstone then no-replace quarantine", async () => {
    const store = createProjectSkillsStore({ userData });
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    const ownershipPath = paths.ownershipPath(rootKey);

    await mkdir(paths.projectDir(rootKey), { recursive: true });
    await writeFile(ownershipPath, "{ not-json", "utf8");

    await expect(store.readOwnership(rootKey)).rejects.toBeInstanceOf(
      ProjectSkillsLedgerCorrupt
    );

    const err = await store.readOwnership(rootKey).then(
      () => null,
      (error: unknown) => error
    );
    expect(err).toBeInstanceOf(ProjectSkillsLedgerCorrupt);
    expect((err as ProjectSkillsLedgerCorrupt).code).toBe("ledger-corrupt");

    // Original path must not remain as readable ledger content.
    await expect(readFile(ownershipPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });

    // Quarantine holds the corrupt bytes; missing original still reports corrupt.
    const quarantineDir = join(paths.projectDir(rootKey), "quarantine");
    const quarantined = await readdir(quarantineDir);
    expect(quarantined.length).toBeGreaterThan(0);
    const body = await readFile(join(quarantineDir, quarantined[0]!), "utf8");
    expect(body).toContain("not-json");

    await expect(store.readOwnership(rootKey)).rejects.toBeInstanceOf(
      ProjectSkillsLedgerCorrupt
    );
  });
});

describe("project-skills store operations", () => {
  it("persists in-flight and terminal operation records", async () => {
    const store = createProjectSkillsStore({ userData });
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);

    await store.writeOperation(rootKey, "op-1", {
      kind: "in-flight",
      phase: "PREPARED",
      requestDigest: "req-a",
    });
    await expect(store.readOperation(rootKey, "op-1")).resolves.toMatchObject({
      kind: "in-flight",
      phase: "PREPARED",
      requestDigest: "req-a",
    });

    await store.writeOperation(rootKey, "op-1", {
      kind: "terminal",
      requestDigest: "req-a",
      result: { status: "converged", ok: true },
      status: "converged",
    });
    await expect(store.readOperation(rootKey, "op-1")).resolves.toMatchObject({
      kind: "terminal",
      status: "converged",
    });
  });

  it("keeps terminal results immutable and idempotent by operationId+requestDigest", async () => {
    const store = createProjectSkillsStore({ userData });
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    const terminal = {
      kind: "terminal" as const,
      requestDigest: "req-a",
      result: { once: true },
      status: "degraded" as const,
    };

    await store.writeOperation(rootKey, "op-term", terminal);
    // Same digest + same terminal payload is idempotent.
    await store.writeOperation(rootKey, "op-term", terminal);
    await expect(store.readOperation(rootKey, "op-term")).resolves.toEqual(
      expect.objectContaining(terminal)
    );

    await expect(
      store.writeOperation(rootKey, "op-term", {
        ...terminal,
        result: { once: false },
      })
    ).rejects.toBeInstanceOf(ProjectSkillsOperationConflict);

    await expect(
      store.writeOperation(rootKey, "op-term", {
        kind: "terminal",
        requestDigest: "req-b",
        result: {},
        status: "converged",
      })
    ).rejects.toBeInstanceOf(ProjectSkillsOperationConflict);

    await expect(
      store.writeOperation(rootKey, "op-term", {
        kind: "in-flight",
        phase: "PREPARED",
        requestDigest: "req-a",
      })
    ).rejects.toBeInstanceOf(ProjectSkillsOperationConflict);
  });
});

describe("project-skills store staging state machine", () => {
  it("moves candidates AVAILABLE → CLAIMED → CONSUMED", async () => {
    const store = createProjectSkillsStore({ userData });
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);

    const created = await store.createCandidate(rootKey, {
      contentDigest: `sha256:${"c".repeat(64)}`,
      expiresAt: Date.now() + 60_000,
      skillId: "review-guide",
      sourceKind: "local-import",
      treeDigest: `sha256:${"d".repeat(64)}`,
    });
    expect(created.state).toBe("AVAILABLE");
    expect(created.token.length).toBeGreaterThan(16);

    const claimed = await store.claimCandidate(
      rootKey,
      created.token,
      "op-claim-1"
    );
    expect(claimed.state).toBe("CLAIMED");
    expect(claimed.operationId).toBe("op-claim-1");

    const consumed = await store.consumeCandidate(
      rootKey,
      created.token,
      "op-claim-1"
    );
    expect(consumed.state).toBe("CONSUMED");

    await expect(
      store.claimCandidate(rootKey, created.token, "op-other")
    ).rejects.toBeInstanceOf(ProjectSkillsStagingConflict);
  });

  it("releases CLAIMED candidates to RELEASED and allows discard of AVAILABLE/RELEASED only", async () => {
    const store = createProjectSkillsStore({ userData });
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);

    const available = await store.createCandidate(rootKey, {
      contentDigest: `sha256:${"c".repeat(64)}`,
      expiresAt: Date.now() + 60_000,
      skillId: "a",
      sourceKind: "local-import",
      treeDigest: `sha256:${"d".repeat(64)}`,
    });
    await store.discardAvailable(rootKey, available.token);
    await expect(
      store.readCandidate(rootKey, available.token)
    ).resolves.toBeNull();

    const claimedSource = await store.createCandidate(rootKey, {
      contentDigest: `sha256:${"c".repeat(64)}`,
      expiresAt: Date.now() + 60_000,
      skillId: "b",
      sourceKind: "local-import",
      treeDigest: `sha256:${"d".repeat(64)}`,
    });
    await store.claimCandidate(rootKey, claimedSource.token, "op-1");
    await expect(
      store.discardAvailable(rootKey, claimedSource.token)
    ).rejects.toBeInstanceOf(ProjectSkillsStagingConflict);

    const released = await store.releaseCandidate(
      rootKey,
      claimedSource.token,
      "op-1"
    );
    expect(released.state).toBe("RELEASED");
    await store.discardAvailable(rootKey, claimedSource.token);
    await expect(
      store.readCandidate(rootKey, claimedSource.token)
    ).resolves.toBeNull();
  });

  it("rejects claim/consume/release by the wrong operationId", async () => {
    const store = createProjectSkillsStore({ userData });
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    const candidate = await store.createCandidate(rootKey, {
      contentDigest: `sha256:${"c".repeat(64)}`,
      expiresAt: Date.now() + 60_000,
      skillId: "c",
      sourceKind: "git-declared",
      treeDigest: `sha256:${"d".repeat(64)}`,
    });
    await store.claimCandidate(rootKey, candidate.token, "op-owner");

    await expect(
      store.consumeCandidate(rootKey, candidate.token, "op-other")
    ).rejects.toBeInstanceOf(ProjectSkillsStagingConflict);
    await expect(
      store.releaseCandidate(rootKey, candidate.token, "op-other")
    ).rejects.toBeInstanceOf(ProjectSkillsStagingConflict);

    const still: StagingCandidateRecord | null = await store.readCandidate(
      rootKey,
      candidate.token
    );
    expect(still?.state).toBe("CLAIMED");
  });
});
