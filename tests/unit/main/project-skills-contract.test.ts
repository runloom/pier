import { pierCommandSchema } from "@shared/contracts/commands.ts";
import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  pierCapabilitySchema,
} from "@shared/contracts/permissions.ts";
import {
  applyResultSchema,
  contentDigestSchema,
  DEGRADE_POLICIES,
  degradePolicySchema,
  PROJECT_SKILLS_ISSUE_CODES,
  projectSkillsIssueCodeSchema,
  projectSkillsManifestSchema,
  skillIdSchema,
} from "@shared/contracts/project-skills.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { describe, expect, it } from "vitest";

const VALID_DIGEST =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const validManifest = {
  version: 1 as const,
  delivery: { agents: true, claude: false },
  skills: [
    {
      id: "review-guide",
      enabled: true,
      contentDigest: VALID_DIGEST,
      source: { type: "local-import" as const },
    },
  ],
};

const sampleProjectRef = {
  realPath: "/Users/xyz/ABC/pier",
  volumeIdentity: "vol-1",
  directoryIdentity: "dir-1",
  token: "tok-1",
};

describe("project-skills contract", () => {
  it("accepts a valid strict manifest", () => {
    expect(projectSkillsManifestSchema.parse(validManifest)).toEqual(
      validManifest
    );
  });

  it("rejects invalid skill ids", () => {
    for (const id of [
      "",
      "Bad_Id",
      "UPPER",
      "-leading",
      "trailing-",
      "has space",
      "a".repeat(65),
      "under_score",
      "dot.name",
    ]) {
      expect(skillIdSchema.safeParse(id).success).toBe(false);
    }
  });

  it("accepts valid skill ids", () => {
    for (const id of ["a", "review-guide", "a1-b2", "x".repeat(64)]) {
      expect(skillIdSchema.parse(id)).toBe(id);
    }
  });

  it("rejects invalid content digests", () => {
    for (const digest of [
      "sha256:abc",
      "SHA256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "sha256:0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF",
      "md5:0123456789abcdef0123456789abcdef",
      VALID_DIGEST.slice(0, -1),
    ]) {
      expect(contentDigestSchema.safeParse(digest).success).toBe(false);
    }
  });

  it("rejects duplicate skill ids in the manifest", () => {
    const result = projectSkillsManifestSchema.safeParse({
      ...validManifest,
      skills: [
        validManifest.skills[0],
        {
          ...validManifest.skills[0],
          enabled: false,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields on strict objects", () => {
    expect(
      projectSkillsManifestSchema.safeParse({
        ...validManifest,
        extra: true,
      }).success
    ).toBe(false);

    expect(
      projectSkillsManifestSchema.safeParse({
        ...validManifest,
        delivery: { claude: false, cursor: true },
      }).success
    ).toBe(false);

    expect(
      projectSkillsManifestSchema.safeParse({
        ...validManifest,
        skills: [
          {
            ...validManifest.skills[0],
            unexpected: 1,
          },
        ],
      }).success
    ).toBe(false);

    expect(
      projectSkillsManifestSchema.safeParse({
        ...validManifest,
        skills: [
          {
            ...validManifest.skills[0],
            source: { type: "local-import", path: "/tmp" },
          },
        ],
      }).success
    ).toBe(false);
  });

  it("enumerates degradePolicy exhaustively", () => {
    expect([...DEGRADE_POLICIES].sort()).toEqual(["allowed", "denied"].sort());
    for (const policy of DEGRADE_POLICIES) {
      expect(degradePolicySchema.parse(policy)).toBe(policy);
    }
    expect(degradePolicySchema.safeParse("maybe").success).toBe(false);
    expect(degradePolicySchema.options).toEqual([...DEGRADE_POLICIES]);
  });

  it("enumerates issue codes exhaustively", () => {
    // v8 adds shadowed-by-user-skill (layer-3 notice, never blocking).
    expect(PROJECT_SKILLS_ISSUE_CODES).toHaveLength(30);
    expect(PROJECT_SKILLS_ISSUE_CODES).toContain("shadowed-by-user-skill");
    expect(new Set(PROJECT_SKILLS_ISSUE_CODES).size).toBe(
      PROJECT_SKILLS_ISSUE_CODES.length
    );
    for (const code of PROJECT_SKILLS_ISSUE_CODES) {
      expect(projectSkillsIssueCodeSchema.parse(code)).toBe(code);
    }
    expect(projectSkillsIssueCodeSchema.safeParse("not-a-code").success).toBe(
      false
    );
    expect(projectSkillsIssueCodeSchema.options).toEqual([
      ...PROJECT_SKILLS_ISSUE_CODES,
    ]);
  });

  it("keeps apply result union exclusive", () => {
    const converged = {
      status: "converged" as const,
      operationId: "op-1",
      revisions: {
        manifestRevision: "m1",
        observedRevision: "o1",
      },
      targetResults: [],
      snapshot: { ok: true },
    };
    const degraded = {
      status: "degraded" as const,
      operationId: "op-2",
      revisions: {
        manifestRevision: "m2",
        observedRevision: "o2",
      },
      targetResults: [],
      snapshot: { ok: true },
      pendingIssueIds: ["issue-1"],
    };
    const indeterminate = {
      status: "indeterminate" as const,
      operationId: "op-3",
      lastConfirmedObservedRevision: "o0",
      operationStatusQuery: {
        projectRef: sampleProjectRef,
        operationId: "op-3",
      },
    };

    expect(applyResultSchema.parse(converged).status).toBe("converged");
    expect(applyResultSchema.parse(degraded).status).toBe("degraded");
    expect(applyResultSchema.parse(indeterminate).status).toBe("indeterminate");

    // indeterminate must not accept a fake authoritative snapshot field
    expect(
      applyResultSchema.safeParse({
        ...indeterminate,
        snapshot: { fake: true },
      }).success
    ).toBe(false);

    // status branches are mutually exclusive on required fields
    expect(
      applyResultSchema.safeParse({
        ...converged,
        pendingIssueIds: ["x"],
      }).success
    ).toBe(false);
    expect(
      applyResultSchema.safeParse({
        status: "converged",
        operationId: "op",
        lastConfirmedObservedRevision: "o0",
        operationStatusQuery: indeterminate.operationStatusQuery,
      }).success
    ).toBe(false);
    expect(
      applyResultSchema.safeParse({
        status: "unknown",
        operationId: "op",
      }).success
    ).toBe(false);
  });

  it("registers skills capabilities on default client kinds", () => {
    expect(pierCapabilitySchema.parse("skills:read")).toBe("skills:read");
    expect(pierCapabilitySchema.parse("skills:write")).toBe("skills:write");
    expect(DEFAULT_CAPABILITIES_BY_CLIENT_KIND["desktop-renderer"]).toEqual(
      expect.arrayContaining(["skills:read", "skills:write"])
    );
    expect(DEFAULT_CAPABILITIES_BY_CLIENT_KIND["cli-local"]).toContain(
      "skills:read"
    );
    expect(DEFAULT_CAPABILITIES_BY_CLIENT_KIND["cli-local"]).not.toContain(
      "skills:write"
    );
    expect(DEFAULT_CAPABILITIES_BY_CLIENT_KIND["mcp-local"]).not.toContain(
      "skills:read"
    );
  });

  it("accepts frozen skills.* and agent.launch.continue command shapes", () => {
    const draft = {
      deliveryAgents: true,
      deliveryClaude: false,
      enabledBySkillId: { "review-guide": true },
      importTokens: [],
      deleteSkillIds: [],
    };

    const commands = [
      { type: "skills.projects.snapshot" },
      { type: "skills.snapshot", projectRef: sampleProjectRef },
      { type: "skills.import.prepare", projectRef: sampleProjectRef },
      {
        type: "skills.import.prepare",
        projectRef: sampleProjectRef,
        globalSource: {
          root: "~/.claude/skills",
          directoryName: "review-guide",
        },
      },
      {
        type: "skills.import.prepareFromDiscovery",
        projectRef: sampleProjectRef,
        relativeSource: ".agents/skills/review-guide",
      },
      {
        type: "skills.import.prepareTemplate",
        projectRef: sampleProjectRef,
        skillId: "review-guide",
        description: "Review changes against project rules",
      },
      {
        type: "skills.import.prepareContentUpdate",
        projectRef: sampleProjectRef,
        skillId: "review-guide",
        baseContentDigest: `sha256:${"a".repeat(64)}`,
        skillMd: "---\nname: review-guide\ndescription: x\n---\nBody",
      },
      {
        type: "skills.import.prepareDriftAcceptance",
        projectRef: sampleProjectRef,
        skillId: "review-guide",
      },
      {
        type: "skills.import.discard",
        projectRef: sampleProjectRef,
        token: "import-token",
      },
      {
        type: "skills.plan",
        projectRef: sampleProjectRef,
        observedRevision: "obs-1",
        draft,
      },
      {
        type: "skills.apply",
        projectRef: sampleProjectRef,
        observedRevision: "obs-1",
        draft,
        planDigest: "plan-1",
        operationId: "11111111-1111-4111-8111-111111111111",
        acknowledgements: [{ requirementId: "req-1", nonce: "n1" }],
      },
      {
        type: "skills.repair.plan",
        projectRef: sampleProjectRef,
        observedRevision: "obs-1",
      },
      {
        type: "skills.repair",
        projectRef: sampleProjectRef,
        observedRevision: "obs-1",
        operationId: "22222222-2222-4222-8222-222222222222",
        repairPlanDigest: "repair-1",
        acknowledgements: [],
        continuationOf: "op-prev",
      },
      { type: "skills.doctor", projectRef: sampleProjectRef },
      {
        type: "skills.skill.read",
        projectRef: sampleProjectRef,
        ref: { kind: "managed", skillId: "review-guide" },
      },
      {
        type: "skills.skill.read",
        projectRef: sampleProjectRef,
        ref: {
          kind: "user-global",
          root: "~/.claude/skills",
          directoryName: "review-guide",
        },
      },
      {
        type: "skills.operation.status",
        projectRef: sampleProjectRef,
        operationId: "op-1",
      },
      {
        // v8: one-shot attempts keyed by launchAttemptId; no challenge field.
        type: "agent.launch.continue",
        launchAttemptId: "attempt-1",
        decision: "cancel",
      },
    ] as const;

    for (const command of commands) {
      expect(pierCommandSchema.parse(command)).toMatchObject(command);
    }
  });

  it("exposes project-skills invalidated broadcast channel", () => {
    expect(PIER_BROADCAST.PROJECT_SKILLS_INVALIDATED).toBe(
      "pier://project-skills:invalidated"
    );
  });
});
