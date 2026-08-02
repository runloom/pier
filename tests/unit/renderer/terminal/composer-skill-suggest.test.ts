import type {
  ProjectSkillView,
  UnmanagedSkillView,
  UserGlobalSkillView,
} from "@shared/contracts/project-skills.ts";
import { skillInvokePrefix, skillInvokeText } from "@shared/skill-invoke.ts";
import { describe, expect, it } from "vitest";
import {
  buildComposerSkillSuggestItems,
  filterComposerSkillSuggestItems,
  getSkillSuggestMatch,
} from "@/panel-kits/terminal/structured-composer/composer-skill-suggest.ts";

function managed(
  partial: Partial<ProjectSkillView> & { id: string }
): ProjectSkillView {
  return {
    alwaysInclude: false,
    contentDigest:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    delivery: null,
    description: partial.description ?? "",
    directorySummary: null,
    effects: partial.effects ?? [],
    enabled: partial.enabled ?? true,
    fileCount: 0,
    id: partial.id,
    issueIds: [],
    managedBy: "user",
    name: partial.name ?? partial.id,
    riskSummary: null,
    source: { type: "local-import" },
    totalBytes: 0,
  };
}

function unmanaged(
  partial: Partial<UnmanagedSkillView> & { directoryName: string }
): UnmanagedSkillView {
  return {
    description: partial.description ?? "",
    directoryName: partial.directoryName,
    effects: partial.effects ?? [],
    kind: "real-directory",
    name: partial.name ?? partial.directoryName,
    root: partial.root ?? ".agents/skills",
  };
}

function userGlobal(
  partial: Partial<UserGlobalSkillView> & { directoryName: string }
): UserGlobalSkillView {
  return {
    description: partial.description ?? "",
    directoryName: partial.directoryName,
    effects: partial.effects ?? [],
    name: partial.name ?? partial.directoryName,
    root: partial.root ?? "~/.agents/skills",
  };
}

describe("skillInvokePrefix", () => {
  it("uses $ for codex and / for claude and cursor", () => {
    expect(skillInvokePrefix("codex")).toBe("$");
    expect(skillInvokePrefix("claude")).toBe("/");
    expect(skillInvokePrefix("cursor")).toBe("/");
    expect(skillInvokeText("codex", "prd")).toBe("$prd");
    expect(skillInvokeText("claude", "code-review")).toBe("/code-review");
  });

  it("returns null for missing agent or empty id", () => {
    expect(skillInvokePrefix(null)).toBeNull();
    expect(skillInvokeText("claude", "")).toBeNull();
  });
});

describe("getSkillSuggestMatch", () => {
  it("matches / trigger only; $ does not open skills", () => {
    expect(getSkillSuggestMatch("/", 1)).toEqual({
      leadOffset: 0,
      matchingString: "",
      trigger: "/",
    });
    expect(getSkillSuggestMatch("/prd", 4)).toEqual({
      leadOffset: 0,
      matchingString: "prd",
      trigger: "/",
    });
    expect(getSkillSuggestMatch("use /code", 9)).toEqual({
      leadOffset: 4,
      matchingString: "code",
      trigger: "/",
    });
    expect(getSkillSuggestMatch("$", 1)).toBeNull();
    expect(getSkillSuggestMatch("use $code", 9)).toBeNull();
  });

  it("does not match mid-path or @/# triggers", () => {
    expect(getSkillSuggestMatch("foo/bar", 7)).toBeNull();
    expect(getSkillSuggestMatch("@file", 5)).toBeNull();
    expect(getSkillSuggestMatch("#1", 2)).toBeNull();
  });
});

describe("buildComposerSkillSuggestItems", () => {
  it("includes invocable skills and prefers managed over global", () => {
    const items = buildComposerSkillSuggestItems(
      {
        skills: [
          managed({
            id: "review-guide",
            name: "Review",
            description: "Review checklist",
            effects: [
              {
                agentKind: "claude",
                effect: { state: "discoverable", viaRoot: ".claude/skills" },
              },
              { agentKind: "codex", effect: { state: "not-projected" } },
            ],
          }),
          managed({
            id: "shadowed",
            enabled: false,
            effects: [
              {
                agentKind: "claude",
                effect: {
                  state: "shadowed-by-user",
                  viaRoot: ".claude/skills",
                  shadowedByRoot: "~/.claude/skills",
                },
              },
            ],
          }),
        ],
        unmanagedSkills: [
          unmanaged({
            directoryName: "repo-only",
            effects: [
              {
                agentKind: "claude",
                effect: { state: "discoverable", viaRoot: ".agents/skills" },
              },
            ],
          }),
        ],
        userGlobalSkills: [
          userGlobal({
            directoryName: "review-guide",
            description: "Global copy",
            effects: [
              {
                agentKind: "claude",
                effect: {
                  state: "discoverable",
                  viaRoot: "~/.claude/skills",
                },
              },
            ],
          }),
          userGlobal({
            directoryName: "mac-only",
            effects: [
              {
                agentKind: "claude",
                effect: {
                  state: "discoverable",
                  viaRoot: "~/.claude/skills",
                },
              },
            ],
          }),
        ],
      },
      "claude"
    );

    expect(items.map((i) => i.id).sort()).toEqual([
      "mac-only",
      "repo-only",
      "review-guide",
    ]);
    const review = items.find((i) => i.id === "review-guide");
    expect(review?.source).toBe("project");
    expect(review?.invokeText).toBe("/review-guide");
    expect(review?.description).toBe("Review checklist");

    const repo = items.find((i) => i.id === "repo-only");
    expect(repo?.source).toBe("project-unmanaged");
    expect(repo?.invokeText).toBe("/repo-only");

    const mac = items.find((i) => i.id === "mac-only");
    expect(mac?.source).toBe("user-global");
  });

  it("lists enabled managed skills even when not-projected for this agent", () => {
    // Real pier case: project delivery.claude=false → Claude matrix not-projected
    // but user still has the skill turned on and expects to pick it.
    const items = buildComposerSkillSuggestItems(
      {
        skills: [
          managed({
            id: "publish-project",
            enabled: true,
            effects: [
              {
                agentKind: "codex",
                effect: { state: "discoverable", viaRoot: ".agents/skills" },
              },
              { agentKind: "claude", effect: { state: "not-projected" } },
            ],
          }),
        ],
        unmanagedSkills: [],
        userGlobalSkills: [],
      },
      "claude"
    );
    expect(items).toEqual([
      expect.objectContaining({
        id: "publish-project",
        invokeText: "/publish-project",
      }),
    ]);
  });

  it("includes duplicate matrix state as invocable", () => {
    const items = buildComposerSkillSuggestItems(
      {
        skills: [],
        unmanagedSkills: [
          unmanaged({
            directoryName: "deslop",
            effects: [
              {
                agentKind: "cursor",
                effect: {
                  state: "duplicate",
                  roots: [".agents/skills", ".claude/skills"],
                },
              },
            ],
          }),
        ],
        userGlobalSkills: [],
      },
      "cursor"
    );
    expect(items.map((i) => i.id)).toEqual(["deslop"]);
  });

  it("uses $ invoke text for codex", () => {
    const items = buildComposerSkillSuggestItems(
      {
        skills: [
          managed({
            id: "prd",
            effects: [
              {
                agentKind: "codex",
                effect: { state: "discoverable", viaRoot: ".agents/skills" },
              },
            ],
          }),
        ],
        unmanagedSkills: [],
        userGlobalSkills: [],
      },
      "codex"
    );
    expect(items).toEqual([
      expect.objectContaining({ id: "prd", invokeText: "$prd" }),
    ]);
  });

  it("falls back to enabled managed when agent has no matrix cells", () => {
    const items = buildComposerSkillSuggestItems(
      {
        skills: [
          managed({
            id: "only-claude",
            enabled: true,
            effects: [
              {
                agentKind: "claude",
                effect: { state: "discoverable", viaRoot: ".claude/skills" },
              },
            ],
          }),
          managed({
            id: "off",
            enabled: false,
            effects: [
              {
                agentKind: "claude",
                effect: { state: "not-projected" },
              },
            ],
          }),
        ],
        unmanagedSkills: [],
        userGlobalSkills: [],
      },
      "grok"
    );
    // grok has no cells → agentAbsentFromMatrix; enabled managed still listed.
    expect(items.map((i) => i.id)).toEqual(["only-claude"]);
  });
});

describe("filterComposerSkillSuggestItems", () => {
  const sample = buildComposerSkillSuggestItems(
    {
      skills: [
        managed({
          id: "code-review",
          description: "Review pull requests",
          effects: [
            {
              agentKind: "claude",
              effect: { state: "discoverable", viaRoot: ".claude/skills" },
            },
          ],
        }),
        managed({
          id: "write-tests",
          description: "Generate unit tests",
          effects: [
            {
              agentKind: "claude",
              effect: { state: "discoverable", viaRoot: ".claude/skills" },
            },
          ],
        }),
      ],
      unmanagedSkills: [],
      userGlobalSkills: [],
    },
    "claude"
  );

  it("filters by id, label, and description", () => {
    expect(
      filterComposerSkillSuggestItems(sample, "review").map((i) => i.id)
    ).toEqual(["code-review"]);
    expect(
      filterComposerSkillSuggestItems(sample, "unit").map((i) => i.id)
    ).toEqual(["write-tests"]);
    expect(filterComposerSkillSuggestItems(sample, "").length).toBe(2);
  });
});
