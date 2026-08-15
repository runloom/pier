import {
  getAgentComposerSurface,
  listBuiltinCommands,
  listBundledSkills,
} from "@shared/agent-surfaces/index.ts";
import type {
  ProjectSkillView,
  UnmanagedSkillView,
  UserGlobalSkillView,
} from "@shared/contracts/project-skills.ts";
import { skillInvokePrefix, skillInvokeText } from "@shared/skill-invoke.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  composerBundledSkillDescKey,
  composerCommandDescKey,
  resolveComposerBundledSkillDescription,
  resolveComposerCommandDescription,
} from "@/panel-kits/terminal/structured-composer/composer-command-i18n.ts";
import {
  type ComposerSkillQuerySnapshot,
  createComposerSkillQueryClient,
  resetComposerSkillQueryCacheForTests,
} from "@/panel-kits/terminal/structured-composer/composer-skill-query.ts";
import {
  buildComposerSkillSuggestItems,
  filterComposerSkillSuggestItems,
  getSkillSuggestMatch,
  getSkillSuggestNodeReplaceRange,
  preserveSuggestActiveIndex,
} from "@/panel-kits/terminal/structured-composer/composer-skill-suggest.ts";

const EMPTY_SNAPSHOT = {
  skills: [] as ProjectSkillView[],
  unmanagedSkills: [] as UnmanagedSkillView[],
  userGlobalSkills: [] as UserGlobalSkillView[],
};

/** Isolate disk-layer tests from default adapter bundled/command tables. */
const noBundled = { builtinCommands: [] as const, bundled: [] as const };

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
    userInvocable: partial.userInvocable ?? true,
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
    userInvocable: partial.userInvocable ?? true,
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
    userInvocable: partial.userInvocable ?? true,
  };
}

describe("skillInvokePrefix", () => {
  it("uses $ for codex and / for verified slash skill agents", () => {
    expect(skillInvokePrefix("codex")).toBe("$");
    expect(skillInvokePrefix("claude")).toBe("/");
    expect(skillInvokePrefix("cursor")).toBe("/");
    expect(skillInvokeText("codex", "prd")).toBe("$prd");
    expect(skillInvokeText("claude", "code-review")).toBe("/code-review");
  });

  it("returns null for missing agent, empty id, or unsupported agents", () => {
    expect(skillInvokePrefix(null)).toBeNull();
    expect(skillInvokeText("claude", "")).toBeNull();
    expect(skillInvokePrefix("aider")).toBeNull();
    expect(skillInvokeText("aider", "anything")).toBeNull();
    expect(skillInvokePrefix("unknown")).toBeNull();
  });
});

describe("getSkillSuggestMatch", () => {
  it("matches / only at message start (optional leading whitespace)", () => {
    expect(getSkillSuggestMatch("/")).toEqual({
      matchingString: "",
      trigger: "/",
    });
    expect(getSkillSuggestMatch("/prd")).toEqual({
      matchingString: "prd",
      trigger: "/",
    });
    expect(getSkillSuggestMatch("  /code")).toEqual({
      matchingString: "code",
      trigger: "/",
    });
    // Mid-message slash is free text — agent force-invoke is turn-start only.
    expect(getSkillSuggestMatch("use /code")).toBeNull();
    expect(getSkillSuggestMatch("hello\n/plan")).toBeNull();
    expect(getSkillSuggestMatch("$")).toBeNull();
    expect(getSkillSuggestMatch("use $code")).toBeNull();
  });

  it("matches Goose progressive /skills [id] form", () => {
    expect(getSkillSuggestMatch("/skills")).toEqual({
      matchingString: "",
      trigger: "/",
    });
    expect(getSkillSuggestMatch("/skills ")).toEqual({
      matchingString: "",
      trigger: "/",
    });
    expect(getSkillSuggestMatch("/skills pier")).toEqual({
      matchingString: "pier",
      trigger: "/",
    });
    expect(getSkillSuggestMatch("use /skills x")).toBeNull();
  });

  it("does not match mid-path or @/# triggers", () => {
    expect(getSkillSuggestMatch("foo/bar")).toBeNull();
    expect(getSkillSuggestMatch("@file")).toBeNull();
    expect(getSkillSuggestMatch("#1")).toBeNull();
  });
});

describe("getSkillSuggestNodeReplaceRange", () => {
  it("maps leading whitespace + slash query to a replace span", () => {
    expect(getSkillSuggestNodeReplaceRange("  /plan", 7)).toEqual({
      endOffset: 7,
      leadOffset: 2,
      matchingString: "plan",
    });
    expect(getSkillSuggestNodeReplaceRange("/", 1)).toEqual({
      endOffset: 1,
      leadOffset: 0,
      matchingString: "",
    });
  });

  it("replaces Goose /skills [id] span through the caret", () => {
    expect(getSkillSuggestNodeReplaceRange("/skills pier", 12)).toEqual({
      endOffset: 12,
      leadOffset: 0,
      matchingString: "pier",
    });
    expect(getSkillSuggestNodeReplaceRange("/skills", 7)).toEqual({
      endOffset: 7,
      leadOffset: 0,
      matchingString: "",
    });
  });

  it("rejects mid-token caret and non-start slash tokens", () => {
    // Caret in the middle of "plan" → before is "/pl", not a complete token match end.
    expect(getSkillSuggestNodeReplaceRange("/plan", 3)).toEqual({
      endOffset: 3,
      leadOffset: 0,
      matchingString: "pl",
    });
    expect(getSkillSuggestNodeReplaceRange("use /plan", 9)).toBeNull();
    expect(getSkillSuggestNodeReplaceRange("x/plan", 6)).toBeNull();
  });
});

describe("buildComposerSkillSuggestItems", () => {
  it("includes invocable skills and prefers managed over global", () => {
    const items = buildComposerSkillSuggestItems(
      {
        skills: [
          managed({
            id: "review-guide",
            name: "review-guide",
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
      "claude",
      noBundled
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

  it("excludes enabled managed skills that are not-projected for this agent", () => {
    // delivery.claude=false → Claude cell is not-projected; L1 must not list
    // a skill the foreground agent cannot load (strict invocable catalog).
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
      "claude",
      noBundled
    );
    expect(items.map((i) => i.id)).not.toContain("publish-project");
  });

  it("still lists the same skill for the agent where it is discoverable", () => {
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
      "codex",
      noBundled
    );
    expect(items).toEqual([
      expect.objectContaining({
        id: "publish-project",
        invokeText: "$publish-project",
      }),
    ]);
  });

  it("excludes disabled managed skills even when discoverable", () => {
    const items = buildComposerSkillSuggestItems(
      {
        skills: [
          managed({
            id: "turned-off",
            enabled: false,
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
      "claude",
      noBundled
    );
    expect(items.map((i) => i.id)).not.toContain("turned-off");
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
      "cursor",
      noBundled
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
      "codex",
      noBundled
    );
    expect(items).toEqual([
      expect.objectContaining({ id: "prd", invokeText: "$prd" }),
    ]);
  });

  it("lists commands but never skills for agents without force-invoke support", () => {
    const items = buildComposerSkillSuggestItems(
      {
        skills: [
          managed({
            id: "should-not-appear",
            enabled: true,
            effects: [
              {
                agentKind: "aider",
                effect: { state: "discoverable", viaRoot: ".agents/skills" },
              },
            ],
          }),
        ],
        unmanagedSkills: [],
        userGlobalSkills: [],
      },
      "aider"
    );
    expect(items.every((i) => i.source === "builtin-command")).toBe(true);
    expect(items.map((i) => i.id)).not.toContain("should-not-appear");
    expect(items.some((i) => i.id === "architect")).toBe(true);
  });

  it("does not dump other agents' skills when this agent has no matrix cells", () => {
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
        ],
        unmanagedSkills: [
          unmanaged({
            directoryName: "repo-skill",
            effects: [
              {
                agentKind: "claude",
                effect: { state: "discoverable", viaRoot: ".agents/skills" },
              },
            ],
          }),
        ],
        userGlobalSkills: [],
      },
      "grok",
      noBundled
    );
    // Strict L1: no wide dump. Grok only gets its surface commands (if any).
    expect(items.map((i) => i.id)).not.toContain("only-claude");
    expect(items.map((i) => i.id)).not.toContain("repo-skill");
    expect(items.every((i) => i.source === "builtin-command")).toBe(true);
  });

  it("lists pier-canvas for Grok when projected discoverable under .agents/skills", () => {
    const items = buildComposerSkillSuggestItems(
      {
        skills: [
          managed({
            id: "pier-canvas",
            name: "pier-canvas",
            description:
              "Create or update a Pier Canvas under .pier/canvases using pier/canvas",
            enabled: true,
            effects: [
              {
                agentKind: "grok",
                effect: {
                  state: "discoverable",
                  viaRoot: ".agents/skills",
                },
              },
            ],
          }),
        ],
        unmanagedSkills: [],
        userGlobalSkills: [],
      },
      "grok"
    );
    const canvas = items.find((i) => i.id === "pier-canvas");
    expect(canvas).toEqual(
      expect.objectContaining({
        id: "pier-canvas",
        invokeText: "/pier-canvas",
        source: "project",
        label: "pier-canvas",
      })
    );
    expect(canvas?.description.toLowerCase()).toContain("canvas");
    // Prefix filter matches the empty-state repro: /pier-c → pier-canvas.
    const filtered = filterComposerSkillSuggestItems(items, "pier-c");
    expect(filtered.map((i) => i.id)).toContain("pier-canvas");
  });

  it("uses frontmatter name for invoke when it is a valid skill id token", () => {
    const items = buildComposerSkillSuggestItems(
      {
        skills: [],
        unmanagedSkills: [
          unmanaged({
            directoryName: "foo-dir",
            name: "bar-skill",
            effects: [
              {
                agentKind: "claude",
                effect: {
                  state: "discoverable",
                  viaRoot: ".claude/skills",
                },
              },
            ],
          }),
        ],
        userGlobalSkills: [],
      },
      "claude",
      noBundled
    );
    expect(items.find((i) => i.id === "bar-skill")).toEqual(
      expect.objectContaining({
        invokeText: "/bar-skill",
        source: "project-unmanaged",
      })
    );
    expect(items.map((i) => i.id)).not.toContain("foo-dir");
  });

  it("hides skills with userInvocable false from L1", () => {
    const items = buildComposerSkillSuggestItems(
      {
        skills: [
          managed({
            id: "hidden-skill",
            userInvocable: false,
            effects: [
              {
                agentKind: "grok",
                effect: {
                  state: "discoverable",
                  viaRoot: ".agents/skills",
                },
              },
            ],
          }),
        ],
        unmanagedSkills: [],
        userGlobalSkills: [],
      },
      "grok",
      noBundled
    );
    expect(items.map((i) => i.id)).not.toContain("hidden-skill");
  });

  it("for Grok keeps built-in bare name and qualifies colliding skills", () => {
    const items = buildComposerSkillSuggestItems(
      {
        skills: [
          managed({
            id: "compact",
            name: "compact",
            effects: [
              {
                agentKind: "grok",
                effect: {
                  state: "discoverable",
                  viaRoot: ".agents/skills",
                },
              },
            ],
          }),
        ],
        unmanagedSkills: [],
        userGlobalSkills: [],
      },
      "grok"
    );
    const compactRows = items.filter((i) => i.id === "compact");
    expect(compactRows.map((i) => i.invokeText).sort()).toEqual([
      "/compact",
      "/repo:compact",
    ]);
    expect(compactRows.find((i) => i.invokeText === "/compact")?.source).toBe(
      "builtin-command"
    );
    expect(
      compactRows.find((i) => i.invokeText === "/repo:compact")?.source
    ).toBe("project");
  });

  it("lists Claude bundled skills including code-review on empty disk", () => {
    const items = buildComposerSkillSuggestItems(EMPTY_SNAPSHOT, "claude");
    const ids = items.map((i) => i.id);
    expect(ids).toContain("code-review");
    expect(items.find((i) => i.id === "code-review")).toEqual(
      expect.objectContaining({
        invokeText: "/code-review",
        source: "bundled",
      })
    );
    // Host/Grok-only skills must never appear via default table.
    expect(ids).not.toContain("check-work");
    expect(ids).not.toContain("imagine");
  });

  it("lets disk managed override bundled with same id", () => {
    const items = buildComposerSkillSuggestItems(
      {
        skills: [
          managed({
            id: "code-review",
            name: "Project Review",
            description: "Repo checklist",
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
    const review = items.find((i) => i.id === "code-review");
    expect(review?.source).toBe("project");
    expect(review?.description).toBe("Repo checklist");
    expect(review?.label).toBe("Project Review");
  });

  it("does not attach Claude bundled skills to codex", () => {
    const items = buildComposerSkillSuggestItems(EMPTY_SNAPSHOT, "codex");
    expect(items.map((i) => i.id)).not.toContain("code-review");
    expect(listBundledSkills("codex").some((s) => s.id === "code-review")).toBe(
      false
    );
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
    "claude",
    noBundled
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

describe("preserveSuggestActiveIndex", () => {
  const prev = [{ id: "btw" }, { id: "plan" }, { id: "compact" }];

  it("keeps the same id when the catalog grows", () => {
    const next = [{ id: "btw" }, { id: "extra" }, { id: "plan" }];
    expect(preserveSuggestActiveIndex(1, prev, next)).toBe(2);
  });

  it("clamps when the selected id disappears", () => {
    const next = [{ id: "btw" }];
    expect(preserveSuggestActiveIndex(2, prev, next)).toBe(0);
  });

  it("returns 0 when the next list is empty", () => {
    expect(preserveSuggestActiveIndex(1, prev, [])).toBe(0);
  });
});

describe("listBundledSkills", () => {
  it("returns Claude table for openclaude and empty for unknown agents", () => {
    expect(
      listBundledSkills("openclaude").some((s) => s.id === "code-review")
    ).toBe(true);
    expect(listBundledSkills("unknown-agent")).toEqual([]);
    expect(listBundledSkills(null)).toEqual([]);
  });
});

describe("builtin command catalog", () => {
  it("lists documented commands per agent and none for unknown agents", () => {
    expect(listBuiltinCommands("copilot").some((c) => c.id === "plan")).toBe(
      true
    );
    expect(listBuiltinCommands("codex").some((c) => c.id === "btw")).toBe(true);
    expect(listBuiltinCommands("openclaude").some((c) => c.id === "plan")).toBe(
      true
    );
    expect(listBuiltinCommands("unknown-agent")).toEqual([]);
    expect(listBuiltinCommands(null)).toEqual([]);
  });

  it("covers the wider agent ecosystem with evidence-backed tables", () => {
    expect(listBuiltinCommands("gemini").some((c) => c.id === "compress")).toBe(
      true
    );
    expect(
      listBuiltinCommands("qwen-code").some((c) => c.id === "review")
    ).toBe(true);
    expect(listBuiltinCommands("aider").some((c) => c.id === "architect")).toBe(
      true
    );
    expect(listBuiltinCommands("goose").some((c) => c.id === "endplan")).toBe(
      true
    );
    expect(listBuiltinCommands("kimi").some((c) => c.id === "btw")).toBe(true);
    expect(listBuiltinCommands("grok").some((c) => c.id === "compact")).toBe(
      true
    );
    expect(listBuiltinCommands("cline").some((c) => c.id === "undo")).toBe(
      true
    );
    expect(listBuiltinCommands("continue").some((c) => c.id === "init")).toBe(
      true
    );
    expect(
      listBuiltinCommands("cursor").some((c) => c.id === "summarize")
    ).toBe(true);
    expect(listBuiltinCommands("droid").some((c) => c.id === "btw")).toBe(true);
    expect(listBuiltinCommands("codebuddy").some((c) => c.id === "btw")).toBe(
      true
    );
  });

  it("kilo inherits the opencode table plus its own review command", () => {
    const opencodeIds = listBuiltinCommands("opencode").map((c) => c.id);
    const kiloIds = listBuiltinCommands("kilo").map((c) => c.id);
    for (const id of opencodeIds) {
      expect(kiloIds).toContain(id);
    }
    expect(kiloIds).toContain("review");
    expect(opencodeIds).not.toContain("review");
  });

  it("agents without a slash system stay absent (palette-driven CLIs)", () => {
    expect(listBuiltinCommands("amp")).toEqual([]);
    expect(listBuiltinCommands("crush")).toEqual([]);
    expect(getAgentComposerSurface("amp")).toEqual({
      builtinCommands: [],
      bundledSkills: [],
    });
  });

  it("exposes commands and bundled skills on the same per-agent surface", () => {
    const claude = getAgentComposerSurface("claude");
    expect(claude.builtinCommands.some((c) => c.id === "plan")).toBe(true);
    expect(claude.bundledSkills.some((s) => s.id === "code-review")).toBe(true);
    expect(getAgentComposerSurface("openclaude")).toBe(claude);

    const codex = getAgentComposerSurface("codex");
    expect(codex.builtinCommands.some((c) => c.id === "plan")).toBe(true);
    expect(codex.bundledSkills.some((s) => s.id === "skill-creator")).toBe(
      true
    );
  });

  it("lists copilot /plan on empty disk with command badge", () => {
    const items = buildComposerSkillSuggestItems(EMPTY_SNAPSHOT, "copilot");
    expect(items.find((i) => i.id === "plan")).toEqual(
      expect.objectContaining({
        invokeText: "/plan",
        source: "builtin-command",
      })
    );
  });

  it("lists built-in commands before skills, each group sorted by id", () => {
    const items = buildComposerSkillSuggestItems(
      {
        skills: [
          managed({
            id: "aaa-skill",
            effects: [
              {
                agentKind: "grok",
                effect: { state: "discoverable", viaRoot: ".agents/skills" },
              },
            ],
          }),
          managed({
            id: "zzz-skill",
            effects: [
              {
                agentKind: "grok",
                effect: { state: "discoverable", viaRoot: ".agents/skills" },
              },
            ],
          }),
        ],
        unmanagedSkills: [],
        userGlobalSkills: [],
      },
      "grok"
    );
    const sources = items.map((i) => i.source);
    const firstSkill = sources.indexOf("project");
    expect(firstSkill).toBeGreaterThan(0);
    expect(
      sources.slice(0, firstSkill).every((s) => s === "builtin-command")
    ).toBe(true);
    expect(
      sources.slice(firstSkill).every((s) => s !== "builtin-command")
    ).toBe(true);
    const commandIds = items
      .filter((i) => i.source === "builtin-command")
      .map((i) => i.id);
    expect(commandIds).toEqual(
      [...commandIds].sort((a, b) => a.localeCompare(b))
    );
    const skillIds = items
      .filter((i) => i.source !== "builtin-command")
      .map((i) => i.id);
    expect(skillIds).toEqual(["aaa-skill", "zzz-skill"]);
  });

  it("uses literal slash for codex commands while skills keep $", () => {
    const items = buildComposerSkillSuggestItems(
      {
        skills: [
          managed({
            id: "plan",
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
    // $plan (disk skill) and /plan (built-in command) do not collide.
    const plans = items.filter((i) => i.id === "plan");
    expect(plans.map((i) => i.invokeText).sort()).toEqual(["$plan", "/plan"]);
    expect(plans.find((i) => i.invokeText === "/plan")?.source).toBe(
      "builtin-command"
    );
  });

  it("drops a command when a skill claims the same invoke text", () => {
    const items = buildComposerSkillSuggestItems(
      {
        skills: [
          managed({
            id: "plan",
            name: "Repo Plan",
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
    const plans = items.filter((i) => i.invokeText === "/plan");
    expect(plans).toHaveLength(1);
    expect(plans[0]?.source).toBe("project");
  });
});

describe("createComposerSkillQueryClient", () => {
  const projectRef = {
    realPath: "/tmp/proj",
    worktreeKey: "wt-1",
  };

  function installPier(api: {
    projectsSnapshot?: (path: string) => Promise<unknown>;
    snapshot?: (ref: unknown) => Promise<unknown>;
  }) {
    const projectsSnapshot =
      api.projectsSnapshot ?? vi.fn(async () => [] as unknown[]);
    const snapshot = api.snapshot ?? vi.fn(async () => null);
    Object.assign(window, {
      pier: {
        projectSkills: {
          projectsSnapshot,
          snapshot,
        },
      },
    });
    return { projectsSnapshot, snapshot };
  }

  async function collectSearch(args: {
    agentKind: string;
    projectRootPath: string;
    query?: string;
  }): Promise<ComposerSkillQuerySnapshot[]> {
    const client = createComposerSkillQueryClient();
    const updates: ComposerSkillQuerySnapshot[] = [];
    const done = new Promise<void>((resolve) => {
      client.search({
        agentKind: args.agentKind,
        onUpdate: (snap) => {
          updates.push(snap);
          if (snap.status === "done" || snap.status === "error") {
            resolve();
          }
        },
        projectRootPath: args.projectRootPath,
        query: args.query ?? "",
      });
    });
    await vi.advanceTimersByTimeAsync(100);
    await done;
    client.dispose();
    return updates;
  }

  beforeEach(() => {
    resetComposerSkillQueryCacheForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetComposerSkillQueryCacheForTests();
    vi.useRealTimers();
    // Drop test pier stub so later suites do not see a partial window.pier.
    (window as { pier?: unknown }).pier = undefined;
  });

  it("shows filtered surface commands on the first update without waiting for IPC", () => {
    installPier({
      projectsSnapshot: vi.fn(() => new Promise(() => undefined)),
    });
    const client = createComposerSkillQueryClient();
    const updates: ComposerSkillQuerySnapshot[] = [];
    client.search({
      agentKind: "grok",
      onUpdate: (snap) => {
        updates.push(snap);
      },
      projectRootPath: "/tmp/proj",
      query: "b",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]?.items.map((item) => item.id)).toEqual(["btw"]);
    client.dispose();
  });

  it("loads surface commands when projects list is empty", async () => {
    const { projectsSnapshot, snapshot } = installPier({
      projectsSnapshot: vi.fn(async () => []),
    });
    const updates = await collectSearch({
      agentKind: "copilot",
      projectRootPath: "/tmp/proj",
    });
    const last = updates.at(-1);
    expect(last?.status).toBe("done");
    expect(
      last?.items.some((i) => i.id === "plan" && i.source === "builtin-command")
    ).toBe(true);
    expect(projectsSnapshot).toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("does not TTL-cache empty-projects surface fallback for a real path", async () => {
    const projectsSnapshot = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          displayPath: "/tmp/proj",
          skillCount: 1,
          projectRef,
        },
      ]);
    const snapshot = vi.fn(async () => ({
      observedRevision: "1",
      skills: [
        managed({
          id: "repo-skill",
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
    }));
    installPier({ projectsSnapshot, snapshot });

    const first = await collectSearch({
      agentKind: "claude",
      projectRootPath: "/tmp/proj",
    });
    expect(first.at(-1)?.items.some((i) => i.id === "repo-skill")).toBe(false);
    expect(projectsSnapshot).toHaveBeenCalledTimes(1);

    const second = await collectSearch({
      agentKind: "claude",
      projectRootPath: "/tmp/proj",
    });
    // Must re-resolve projects (no 30s pin of empty list).
    expect(projectsSnapshot).toHaveBeenCalledTimes(2);
    expect(second.at(-1)?.items.some((i) => i.id === "repo-skill")).toBe(true);
  });

  it("still surfaces commands when skills IPC throws", async () => {
    installPier({
      projectsSnapshot: vi.fn(async () => {
        throw new Error("ipc down");
      }),
    });
    const updates = await collectSearch({
      agentKind: "copilot",
      projectRootPath: "/tmp/proj",
    });
    const last = updates.at(-1);
    expect(last?.status).toBe("done");
    expect(
      last?.items.some((i) => i.id === "plan" && i.source === "builtin-command")
    ).toBe(true);
  });

  it("loads surface catalog without calling skills IPC when path is empty", async () => {
    const { projectsSnapshot, snapshot } = installPier({});
    const updates = await collectSearch({
      agentKind: "claude",
      projectRootPath: "",
    });
    const last = updates.at(-1);
    expect(last?.status).toBe("done");
    expect(
      last?.items.some(
        (i) => i.source === "builtin-command" || i.source === "bundled"
      )
    ).toBe(true);
    expect(projectsSnapshot).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("falls back to surface catalog when snapshot is malformed", async () => {
    installPier({
      projectsSnapshot: vi.fn(async () => [
        {
          displayPath: "/tmp/proj",
          skillCount: 0,
          projectRef,
        },
      ]),
      // Missing observedRevision / skills → normalizeSnapshot returns null.
      snapshot: vi.fn(async () => ({})),
    });
    const updates = await collectSearch({
      agentKind: "copilot",
      projectRootPath: "/tmp/proj",
    });
    const last = updates.at(-1);
    expect(last?.status).toBe("done");
    expect(last?.items.some((i) => i.id === "plan")).toBe(true);
  });

  it("merges managed skills from a valid snapshot and caches by agent", async () => {
    const projectsSnapshot = vi.fn(async () => [
      {
        displayPath: "/tmp/proj",
        skillCount: 1,
        projectRef,
      },
    ]);
    const snapshot = vi.fn(async () => ({
      observedRevision: "1",
      skills: [
        managed({
          id: "repo-skill",
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
    }));
    installPier({ projectsSnapshot, snapshot });

    const first = await collectSearch({
      agentKind: "claude",
      projectRootPath: "/tmp/proj",
    });
    expect(first.at(-1)?.items.some((i) => i.id === "repo-skill")).toBe(true);
    expect(snapshot).toHaveBeenCalledTimes(1);

    const second = await collectSearch({
      agentKind: "claude",
      projectRootPath: "/tmp/proj",
    });
    expect(second.at(-1)?.items.some((i) => i.id === "repo-skill")).toBe(true);
    // TTL cache should skip a second snapshot fetch for the same agent/path.
    expect(snapshot).toHaveBeenCalledTimes(1);
  });
});

describe("composer command i18n", () => {
  it("maps openclaude to claude locale keys", () => {
    expect(composerCommandDescKey("openclaude", "plan")).toBe(
      "terminal.composer.commandDesc.claude.plan"
    );
    expect(composerCommandDescKey("grok", "btw")).toBe(
      "terminal.composer.commandDesc.grok.btw"
    );
    expect(composerBundledSkillDescKey("openclaude", "code-review")).toBe(
      "terminal.composer.skillDesc.claude.code-review"
    );
  });

  it("prefers translated copy and falls back to English surface text", () => {
    const t = ((key: string, opts?: { defaultValue?: string }) => {
      if (key === "terminal.composer.commandDesc.grok.plan") {
        return "切换到计划模式";
      }
      if (key === "terminal.composer.skillDesc.claude.code-review") {
        return "审查代码改动";
      }
      return opts?.defaultValue ?? "";
    }) as import("i18next").TFunction;

    expect(
      resolveComposerCommandDescription(
        t,
        "grok",
        "plan",
        "Switch to plan mode"
      )
    ).toBe("切换到计划模式");
    expect(
      resolveComposerCommandDescription(
        t,
        "grok",
        "btw",
        "Ask a quick side question"
      )
    ).toBe("Ask a quick side question");
    expect(
      resolveComposerBundledSkillDescription(
        t,
        "claude",
        "code-review",
        "Review code changes"
      )
    ).toBe("审查代码改动");
  });

  it("falls back kilo missing keys to opencode", () => {
    const t = ((key: string, opts?: { defaultValue?: string }) => {
      if (key === "terminal.composer.commandDesc.opencode.new") {
        return "开始新会话";
      }
      return opts?.defaultValue ?? "";
    }) as import("i18next").TFunction;

    expect(
      resolveComposerCommandDescription(t, "kilo", "new", "Start a new session")
    ).toBe("开始新会话");
  });
});
