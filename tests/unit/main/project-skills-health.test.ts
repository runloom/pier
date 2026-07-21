import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillDiscoveryAdapterRegistry } from "@main/services/project-skills/adapters.ts";
import {
  createProjectSkillsHealthService,
  getHealthIssueMapping,
  HEALTH_ISSUE_MAPPINGS,
} from "@main/services/project-skills/health.ts";
import {
  resolveStableProjectIdentity,
  toContractProjectRootRef,
} from "@main/services/project-skills/identity.ts";
import { createProjectSkillsPaths } from "@main/services/project-skills/paths.ts";
import { createProjectSkillsStore } from "@main/services/project-skills/store.ts";
import {
  PROJECT_SKILLS_ISSUE_CODES,
  type ProjectSkillsIssueCode,
  type ProjectSkillsManifest,
} from "@shared/contracts/project-skills.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const DIGEST_A = `sha256:${"a".repeat(64)}`;

let userData: string;
let projectRoot: string;

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
  body = "# hi\n"
): Promise<void> {
  const dir = join(projectRoot, ".pier", "skills", "library", skillId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${skillId}\ndescription: test skill\n---\n${body}`,
    "utf8"
  );
}

async function projectRef() {
  const identity = await resolveStableProjectIdentity(projectRoot);
  return toContractProjectRootRef(identity);
}

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "pier-ps-health-ud-"));
  projectRoot = await mkdtemp(join(tmpdir(), "pier-ps-health-proj-"));
});

afterEach(async () => {
  await rm(userData, { force: true, recursive: true });
  await rm(projectRoot, { force: true, recursive: true });
});

describe("project-skills health issue mapping (§5.1)", () => {
  it("covers every issue code exactly once", () => {
    const codes = HEALTH_ISSUE_MAPPINGS.map((m) => m.code).sort();
    expect(codes).toEqual([...PROJECT_SKILLS_ISSUE_CODES].sort());
    expect(new Set(codes).size).toBe(PROJECT_SKILLS_ISSUE_CODES.length);
  });

  it("fixes severity / blockingScopes / degradePolicy for key codes", () => {
    const table: Array<{
      code: ProjectSkillsIssueCode;
      severity: string;
      degradePolicy: string;
      includes?: string[];
      excludes?: string[];
      repairable?: boolean;
    }> = [
      {
        code: "disabled",
        severity: "info",
        degradePolicy: "allowed",
        includes: [],
      },
      {
        code: "adapter-disabled",
        severity: "info",
        degradePolicy: "allowed",
      },
      {
        code: "agent-not-installed",
        severity: "info",
        degradePolicy: "allowed",
      },
      {
        code: "not-applicable",
        severity: "info",
        degradePolicy: "allowed",
      },
      {
        code: "new-session-recommended",
        severity: "notice",
        degradePolicy: "allowed",
      },
      {
        code: "git-visible-projection",
        severity: "notice",
        degradePolicy: "allowed",
      },
      {
        code: "git-tracked-projection",
        severity: "notice",
        degradePolicy: "allowed",
      },
      {
        code: "cleanup-pending",
        severity: "notice",
        degradePolicy: "allowed",
      },
      {
        code: "projection-missing",
        severity: "warning",
        degradePolicy: "allowed",
        includes: ["launch"],
        repairable: true,
      },
      {
        code: "projection-stale",
        severity: "warning",
        degradePolicy: "allowed",
        includes: ["launch"],
        repairable: true,
      },
      {
        code: "recovery-pending",
        severity: "warning",
        degradePolicy: "allowed",
        includes: ["launch"],
        repairable: true,
      },
      {
        code: "missing-source",
        severity: "error",
        degradePolicy: "denied",
        includes: ["enable", "projection", "launch"],
      },
      {
        code: "invalid-skill",
        severity: "error",
        degradePolicy: "denied",
      },
      {
        code: "library-drift",
        severity: "error",
        degradePolicy: "denied",
      },
      {
        code: "content-conflict",
        severity: "error",
        degradePolicy: "denied",
      },
      {
        code: "unmanaged-conflict",
        severity: "error",
        degradePolicy: "denied",
        includes: ["launch"],
      },
      {
        code: "managed-target-modified",
        severity: "error",
        degradePolicy: "denied",
        includes: ["launch"],
      },
      {
        code: "project-identity-changed",
        severity: "error",
        degradePolicy: "denied",
        includes: ["read", "write", "launch"],
      },
      {
        code: "ledger-corrupt",
        severity: "error",
        degradePolicy: "denied",
        includes: ["write", "launch"],
      },
      {
        code: "recovery-record-corrupt",
        severity: "error",
        degradePolicy: "denied",
      },
      {
        code: "recovery-blocked",
        severity: "error",
        degradePolicy: "denied",
      },
      {
        code: "durability-unknown",
        severity: "error",
        degradePolicy: "denied",
      },
      {
        code: "filesystem-unsupported",
        severity: "error",
        degradePolicy: "denied",
      },
      {
        code: "permission-changed",
        severity: "error",
        degradePolicy: "denied",
      },
      {
        code: "insufficient-space",
        severity: "error",
        degradePolicy: "denied",
      },
      {
        code: "operation-busy",
        severity: "error",
        degradePolicy: "denied",
      },
      {
        // v8.2: documented consequence of the Claude delivery setting —
        // reported inline, never blocks apply or launch.
        code: "duplicate-discovery",
        severity: "notice",
        degradePolicy: "allowed",
      },
      {
        code: "agent-version-unsupported",
        severity: "error",
        degradePolicy: "allowed",
      },
      {
        code: "unknown-agent-behavior",
        severity: "error",
        degradePolicy: "allowed",
      },
    ];

    for (const row of table) {
      const mapping = getHealthIssueMapping(row.code);
      expect(mapping.severity, row.code).toBe(row.severity);
      expect(mapping.degradePolicy, row.code).toBe(row.degradePolicy);
      if (row.includes) {
        for (const scope of row.includes) {
          expect(mapping.blockingScopes, row.code).toContain(scope);
        }
      }
      if (row.repairable !== undefined) {
        expect(mapping.repairable, row.code).toBe(row.repairable);
      }
    }
  });
});

describe("project-skills doctor drift facts (v8.2 §3.5)", () => {
  it("reports library-drift with both digests when the tree no longer matches the manifest", async () => {
    await writeLibrarySkill("review-guide");
    const { computeTreeSha256V1 } = await import(
      "@main/services/project-skills/tree-digest.ts"
    );
    const digest = await computeTreeSha256V1(
      join(projectRoot, ".pier", "skills", "library", "review-guide")
    );
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: true,
          contentDigest: digest,
          source: { type: "local-import" },
        },
      ],
    });
    // Tamper outside Pier.
    await writeLibrarySkill("review-guide", "# tampered\n");

    const health = createProjectSkillsHealthService({
      userData,
      adapterRegistry: createSkillDiscoveryAdapterRegistry(),
    });
    const snapshot = await health.doctor(await projectRef());
    const drift = snapshot.issues.find((i) => i.code === "library-drift");
    expect(drift).toBeDefined();
    expect(drift?.skillId).toBe("review-guide");
    expect(drift?.evidence.expectedContentDigest).toBe(digest);
    expect(typeof drift?.evidence.actualContentDigest).toBe("string");
    expect(drift?.evidence.actualContentDigest).not.toBe(digest);
  });

  it("reports missing-source when the library directory is gone", async () => {
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: true,
          contentDigest: DIGEST_A,
          source: { type: "local-import" },
        },
      ],
    });
    const health = createProjectSkillsHealthService({
      userData,
      adapterRegistry: createSkillDiscoveryAdapterRegistry(),
    });
    const snapshot = await health.doctor(await projectRef());
    expect(
      snapshot.issues.some(
        (i) => i.code === "missing-source" && i.skillId === "review-guide"
      )
    ).toBe(true);
  });
});

describe("project-skills doctor", () => {
  it("reports duplicate-discovery for true multi-root scanners when Claude delivery is enabled", async () => {
    await writeLibrarySkill("review-guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: true },
      skills: [
        {
          id: "review-guide",
          enabled: true,
          contentDigest: DIGEST_A,
          source: { type: "local-import" },
        },
      ],
    });

    const identity = await resolveStableProjectIdentity(projectRoot);
    const store = createProjectSkillsStore({ userData });
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    // Real dual-root projection (v8.2): duplicate-discovery requires owned
    // projections in BOTH delivery roots, not merely Claude delivery on.
    const { lstat, symlink } = await import("node:fs/promises");
    const targets: import("@main/services/project-skills/store.ts").OwnershipTarget[] =
      [];
    for (const root of [".agents/skills", ".claude/skills"] as const) {
      const linkDir = join(projectRoot, root);
      await mkdir(linkDir, { recursive: true });
      const linkPath = join(linkDir, "review-guide");
      await symlink("../../.pier/skills/library/review-guide", linkPath);
      const st = await lstat(linkPath);
      targets.push({
        relativePath: `${root}/review-guide`,
        skillId: "review-guide",
        expectedRelativeLinkTarget: "../../.pier/skills/library/review-guide",
        objectIdentity: {
          dev: st.dev,
          ino: st.ino,
          mode: st.mode,
          nlink: st.nlink,
          isDirectory: false,
          isSymbolicLink: true,
        },
        createdByOperationId: "seed",
        createdAt: 1,
      });
    }
    await store.commitOwnership(rootKey, 0, {
      schemaVersion: 1,
      generation: 1,
      projectIdentity: identity,
      targets,
    });

    const healthWithStore = createProjectSkillsHealthService({
      userData,
      store,
      adapterRegistry: createSkillDiscoveryAdapterRegistry(),
    });
    const snapshot = await healthWithStore.doctor(await projectRef());
    const dupes = snapshot.issues.filter(
      (i) => i.code === "duplicate-discovery"
    );
    const adapters = dupes.map((i) => i.adapterKind).sort();
    // v8 fact correction: OpenCode resolves same-name copies by priority
    // (project .opencode highest) — not a duplicate. Only multi-root
    // scanners without deterministic resolution that read BOTH projection
    // targets report duplicates (registry facts, 2026-07-20).
    expect(adapters).toEqual(["autohand", "copilot", "crush", "cursor"]);
    for (const issue of dupes) {
      expect(issue.severity).toBe("notice");
      expect(issue.degradePolicy).toBe("allowed");
      expect(issue.blockingScopes).toEqual([]);
    }
  });

  it("does not report duplicate-discovery when Claude delivery is off", async () => {
    await writeLibrarySkill("review-guide");
    await writeManifest({
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [
        {
          id: "review-guide",
          enabled: true,
          contentDigest: DIGEST_A,
          source: { type: "local-import" },
        },
      ],
    });

    const store = createProjectSkillsStore({ userData });

    const health = createProjectSkillsHealthService({
      userData,
      store,
      adapterRegistry: createSkillDiscoveryAdapterRegistry(),
    });
    const snapshot = await health.doctor(await projectRef());
    expect(snapshot.issues.some((i) => i.code === "duplicate-discovery")).toBe(
      false
    );
  });
});
