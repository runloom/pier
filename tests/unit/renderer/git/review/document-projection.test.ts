import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewFileDocumentOk,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import { describe, expect, it, vi } from "vitest";
import { toCodeViewItems } from "../../../../../packages/ui/src/diff-view/items.ts";
import {
  estimateLinesForReviewSlot,
  indexReviewDocumentProjection,
  indexReviewEntrySections,
  indexReviewSectionEntries,
  isCodeViewMemberResource,
  projectReviewDocumentResource,
  projectReviewDocuments,
  projectReviewLedger,
  recordReviewRenderedHeightEstimates,
} from "../../../../../src/plugins/builtin/git/renderer/review/document/projection.ts";
import type { GitReviewDocumentResource } from "../../../../../src/plugins/builtin/git/renderer/review/document/resource.ts";
import {
  patchDocument,
  patchDocumentForEntry,
  stateDocument,
} from "./document-fixture.ts";

function entry(index: number): GitReviewIndexEntry {
  const path = `src/file-${index}.ts`;
  return {
    entryKey: `entry:${index}`,
    oldPaths: [],
    path,
    renderSlots: [
      {
        group: "unstaged",
        oldPath: null,
        sectionKey: `section:${index}`,
        status: "modified",
        targetPath: path,
      },
    ],
    status: "modified",
  };
}

function loaded(index: number): GitReviewDocumentResource {
  const item = entry(index);
  const slot = item.renderSlots[0];
  if (slot === undefined) {
    throw new Error("missing review slot");
  }
  const document: GitReviewFileDocumentOk = patchDocument({
    entryKey: item.entryKey,
    patch: `diff --git a/${item.path} b/${item.path}\n@@ -1 +1 @@\n-old\n+new\n`,
    revision: `document:${index}`,
    sectionKey: slot.sectionKey,
  });
  return { document, entry: item, kind: "loaded" };
}

function context(): RendererPluginContext {
  return {
    i18n: {
      t: vi.fn((key: string, _values?: unknown, fallback?: string) =>
        typeof fallback === "string" ? fallback : key
      ),
    },
  } as never;
}

describe("projectReviewLedger content-bearing body (gold standard)", () => {
  it("omits pure-rename slots from CodeView projection", () => {
    const path = "src/renamed.ts";
    const item: GitReviewIndexEntry = {
      entryKey: "entry:rename",
      oldPaths: ["src/old.ts"],
      path,
      renderSlots: [
        {
          additions: 0,
          deletions: 0,
          group: "unstaged",
          oldPath: "src/old.ts",
          sectionKey: "section:rename",
          status: "renamed",
          targetPath: path,
        },
      ],
      status: "renamed",
    };
    const projection = projectReviewLedger({
      context: context(),
      entries: [item],
      locale: "en",
      resourceByEntryKey: new Map(),
    });
    expect(projection.items).toEqual([]);
  });

  it("omits mutation controls when projecting a read-only committed patch", () => {
    const path = "src/committed.ts";
    const item: GitReviewIndexEntry = {
      entryKey: "entry:committed",
      oldPaths: [],
      path,
      renderSlots: [
        {
          group: "committed",
          oldPath: null,
          sectionKey: "section:committed",
          status: "added",
          targetPath: path,
        },
      ],
      status: "added",
    };
    const document = patchDocument({
      entryKey: item.entryKey,
      patch: [
        `diff --git a/${path} b/${path}`,
        "new file mode 100644",
        "index 0000000..1111111",
        "--- /dev/null",
        `+++ b/${path}`,
        "@@ -0,0 +1 @@",
        "+export const committed = true;",
        "",
      ].join("\n"),
      sectionKey: "section:committed",
      stageState: null,
    });
    const projection = projectReviewDocumentResource(
      { document, entry: item, kind: "loaded" },
      context(),
      "en"
    );

    expect(projection.items[0]).not.toHaveProperty("changeControls");
    expect(toCodeViewItems(projection.items, new Map()).errors).toEqual([]);
  });

  it("reuses immutable loaded projection for the same document and entry semantics", () => {
    const resource = loaded(2);
    if (resource.kind !== "loaded") {
      throw new Error("expected loaded resource");
    }
    const pluginContext = context();
    const first = projectReviewDocumentResource(resource, pluginContext, "en");
    const second = projectReviewDocumentResource(
      { ...resource, entry: structuredClone(resource.entry) },
      pluginContext,
      "en"
    );

    expect(second).toBe(first);
  });

  it("projects Conflict, Index and Staged as isolated renderer surfaces", () => {
    const item: GitReviewIndexEntry = {
      entryKey: "entry:partial",
      oldPaths: [],
      path: "src/partial.ts",
      renderSlots: [
        {
          group: "conflict",
          oldPath: null,
          sectionKey: "section:conflict",
          status: "conflicted",
          targetPath: "src/partial.ts",
        },
        {
          group: "staged",
          oldPath: null,
          sectionKey: "section:staged",
          status: "modified",
          targetPath: "src/partial.ts",
        },
        {
          group: "unstaged",
          oldPath: null,
          sectionKey: "section:unstaged",
          status: "modified",
          targetPath: "src/partial.ts",
        },
      ],
      status: "modified",
    };
    const patch =
      "diff --git a/src/partial.ts b/src/partial.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const staged = patchDocument({
      entryKey: item.entryKey,
      patch,
      sectionKey: "section:staged",
      stageState: "staged",
    }).sections[0];
    const conflict = patchDocument({
      entryKey: item.entryKey,
      patch,
      sectionKey: "section:conflict",
      stageState: "partial",
    }).sections[0];
    const unstaged = patchDocument({
      entryKey: item.entryKey,
      patch,
      sectionKey: "section:unstaged",
      stageState: "unstaged",
    }).sections[0];
    const head = patchDocument({
      entryKey: item.entryKey,
      patch,
      sectionKey: "section:head",
      stageState: "partial",
    }).sections[0];
    if (!(conflict && staged && unstaged && head)) {
      throw new Error("missing test sections");
    }
    const document: GitReviewFileDocumentOk = {
      entryKey: item.entryKey,
      kind: "ok",
      revision: "revision:partial",
      sections: [conflict, staged, unstaged, head],
      surfaceSections: {
        committed: null,
        head: head.sectionKey,
        index: unstaged.sectionKey,
        staged: staged.sectionKey,
      },
    };
    const resourceByEntryKey = new Map<string, GitReviewDocumentResource>([
      [item.entryKey, { document, entry: item, kind: "loaded" }],
    ]);
    const rendererContext = context();
    const project = (diffBase: "conflict" | "index" | "staged") =>
      projectReviewLedger({
        context: rendererContext,
        diffBase,
        entries: [item],
        locale: "en",
        resourceByEntryKey,
      });

    expect(project("conflict").items.map(({ id }) => id)).toEqual([
      "section:conflict",
    ]);
    expect(project("index").items.map(({ id }) => id)).toEqual([
      "section:unstaged",
    ]);
    expect(project("index").items[0]?.changeControls?.[0]).toMatchObject({
      canRevert: true,
      state: "unstaged",
    });
    expect(project("staged").items.map(({ id }) => id)).toEqual([
      "section:staged",
    ]);
  });

  it("projects every index slot; idle/loading/unchanged become estimate", () => {
    const entries = [entry(0), entry(1), entry(2), entry(3), entry(4)];
    const resourceByEntryKey = new Map<string, GitReviewDocumentResource>([
      ["entry:0", { entry: entry(0), kind: "idle" }],
      ["entry:1", { entry: entry(1), kind: "loading", operationId: "op-1" }],
      ["entry:2", loaded(2)],
      [
        "entry:3",
        {
          entry: entry(3),
          failure: {
            kind: "error",
            message: "boom",
            reason: "internal",
            retryable: true,
          },
          kind: "error",
        },
      ],
      ["entry:4", { entry: entry(4), kind: "unchanged" }],
    ]);
    const projection = projectReviewLedger({
      context: context(),
      entries,
      locale: "en",
      resourceByEntryKey,
    });

    expect(projection.items.map((item) => item.id)).toEqual([
      "section:0",
      "section:1",
      "section:2",
      "section:3",
      "section:4",
    ]);
    expect(projection.items[0]?.kind).toBe("estimate");
    expect(projection.items[0]?.cacheKey.startsWith("estimate:")).toBe(true);
    // 骨架固定矮行，不得灌 numstat 级假行
    expect(projection.items[0]?.estimateLines).toBeGreaterThan(0);
    expect(projection.items[0]?.estimateLines).toBeLessThanOrEqual(5);
    expect(projection.items[2]?.patch).toContain("+new");
    expect(projection.items[2]?.kind).toBe("loaded");
    expect(projection.items[3]?.stateNotice).toBe("Unable to load this change");
    expect(projection.items[3]?.kind).toBe("error");
    expect(
      projection.items.every(
        (item) => !item.cacheKey.startsWith("git-review-placeholder:")
      )
    ).toBe(true);
    expect(projection.entryKeyBySectionId.get("section:2")).toBe("entry:2");
    expect(projection.revisionBySectionId.get("section:2")).toBe("document:2");
  });

  it("with pendingEntryKeys only mounts estimate for demand window (no estimate sea)", () => {
    const entries = [entry(0), entry(1), entry(2), entry(3), entry(4)];
    const resourceByEntryKey = new Map<string, GitReviewDocumentResource>(
      entries.map((item) => [item.entryKey, { entry: item, kind: "idle" }])
    );
    const projection = projectReviewLedger({
      context: context(),
      entries,
      locale: "en",
      pendingEntryKeys: new Set(["entry:0", "entry:2"]),
      resourceByEntryKey,
    });
    expect(projection.items.map((item) => item.id)).toEqual([
      "section:0",
      "section:2",
    ]);
    expect(projection.items.every((item) => item.kind === "estimate")).toBe(
      true
    );
  });

  it("pendingEntryKeys still keeps loaded outside demand (soft-retain)", () => {
    const entries = [entry(0), entry(1)];
    const projection = projectReviewLedger({
      context: context(),
      entries,
      locale: "en",
      pendingEntryKeys: new Set(["entry:0"]),
      resourceByEntryKey: new Map([
        ["entry:0", { entry: entry(0), kind: "idle" }],
        ["entry:1", loaded(1)],
      ]),
    });
    expect(projection.items.map((item) => item.id)).toEqual([
      "section:0",
      "section:1",
    ]);
    expect(projection.items[0]?.kind).toBe("estimate");
    expect(projection.items[1]?.kind).toBe("loaded");
  });

  it("omits pure rename slots from CodeView body (gold standard meta)", () => {
    const pureRename: GitReviewIndexEntry = {
      entryKey: "entry:rename",
      oldPaths: ["src/old.ts"],
      path: "src/new.ts",
      renderSlots: [
        {
          additions: 0,
          deletions: 0,
          group: "staged",
          oldPath: "src/old.ts",
          sectionKey: "section:rename",
          status: "renamed",
          targetPath: "src/new.ts",
        },
      ],
      status: "renamed",
    };
    const projection = projectReviewLedger({
      context: context(),
      entries: [pureRename],
      locale: "en",
      resourceByEntryKey: new Map([
        ["entry:rename", { entry: pureRename, kind: "idle" }],
      ]),
    });
    expect(projection.items).toEqual([]);
  });

  it("keeps controls visible and rejects writes until the retained document is authoritative", () => {
    const item = entry(2);
    const resource = loaded(2);
    const pending = projectReviewLedger({
      authoritativeEntryKeys: new Set(),
      context: context(),
      entries: [item],
      locale: "en",
      resourceByEntryKey: new Map([[item.entryKey, resource]]),
    });
    expect(pending.items[0]?.stageControl).toMatchObject({ busy: true });
    expect(pending.items[0]?.changeControls?.[0]?.busy).toBeUndefined();
    expect(pending.revisionBySectionId.has("section:2")).toBe(false);

    const ready = projectReviewLedger({
      authoritativeEntryKeys: new Set([item.entryKey]),
      context: context(),
      entries: [item],
      locale: "en",
      resourceByEntryKey: new Map([[item.entryKey, resource]]),
    });
    expect(ready.items[0]?.stageControl?.busy).toBeUndefined();
    expect(ready.items[0]?.changeControls?.[0]?.busy).toBeUndefined();
    expect(ready.revisionBySectionId.get("section:2")).toBe("document:2");
  });

  it("still paints loaded body when outside allowedBody priority (no forever estimate)", () => {
    const item = entry(2);
    const projection = projectReviewLedger({
      allowedBodyEntryKeys: new Set(),
      context: context(),
      entries: [item],
      locale: "en",
      measuredEstimateLinesByPath: new Map([[item.path, 37]]),
      resourceByEntryKey: new Map([["entry:2", loaded(2)]]),
    });

    // allowedBody 只控 mutation 权威；已 loaded 必须画真正文，不能退回 estimate。
    expect(projection.items[0]?.kind).toBe("loaded");
    expect(projection.items[0]?.patch).toContain("+new");
    expect(projection.items[0]?.stageControl).toMatchObject({
      busy: true,
      state: "unstaged",
    });
    expect(projection.revisionBySectionId.has("section:2")).toBe(false);
  });

  it("soft-retains unstaged patch body onto staged slot after stage migration", () => {
    const path = "src/file-stage.ts";
    const stagedEntry: GitReviewIndexEntry = {
      entryKey: "entry:stage",
      oldPaths: [],
      path,
      renderSlots: [
        {
          additions: 1,
          deletions: 1,
          group: "staged",
          oldPath: null,
          sectionKey: "section:staged",
          status: "modified",
          targetPath: path,
        },
      ],
      status: "modified",
    };
    const unstagedPatch = [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1 +1 @@",
      "-old line",
      "+new line after stage handoff",
      "",
    ].join("\n");
    // 旧 document 仍挂 unstaged sectionKey / surface index（soft-retain 典型）
    const document = patchDocument({
      entryKey: stagedEntry.entryKey,
      patch: unstagedPatch,
      revision: "rev-soft",
      sectionKey: "section:unstaged",
      stageState: "unstaged",
    });
    const projection = projectReviewDocumentResource(
      { document, entry: stagedEntry, kind: "loaded" },
      context(),
      "en"
    );
    expect(projection.items).toHaveLength(1);
    expect(projection.items[0]).toMatchObject({
      id: "section:staged",
      kind: "loaded",
      patch: unstagedPatch,
      stageControl: { state: "staged" },
    });
    expect(projection.items[0]?.patch).toContain(
      "+new line after stage handoff"
    );
  });

  it("uses fixed skeleton height for content slots (not raw numstat lines)", () => {
    // header 仍用 lineStats 画 -12 +7；正文骨架固定 5 行，对齐 estimate-skeleton
    expect(
      estimateLinesForReviewSlot({
        additions: 12,
        binary: false,
        deletions: 7,
        group: "unstaged",
        oldPath: null,
        sectionKey: "section:stats",
        status: "modified",
        targetPath: "stats.ts",
      })
    ).toBe(5);
    expect(
      estimateLinesForReviewSlot({
        additions: 200,
        binary: false,
        deletions: 50,
        group: "unstaged",
        oldPath: null,
        sectionKey: "section:huge",
        status: "modified",
        targetPath: "huge.ts",
      })
    ).toBe(5);
  });

  it("estimates pure rename / empty as zero lines", () => {
    expect(
      estimateLinesForReviewSlot({
        additions: 0,
        deletions: 0,
        group: "staged",
        oldPath: "a.ts",
        sectionKey: "section:rename",
        status: "renamed",
        targetPath: "b.ts",
      })
    ).toBe(0);
  });

  it("attaches index numstat as lineStats on estimate items for first paint", () => {
    const path = "src/with-stats.ts";
    const item: GitReviewIndexEntry = {
      entryKey: "entry:stats",
      oldPaths: [],
      path,
      renderSlots: [
        {
          additions: 6,
          deletions: 9,
          group: "unstaged",
          oldPath: null,
          sectionKey: "section:stats",
          status: "modified",
          targetPath: path,
        },
      ],
      status: "modified",
    };
    const projection = projectReviewLedger({
      context: context(),
      entries: [item],
      locale: "en",
      resourceByEntryKey: new Map([
        ["entry:stats", { entry: item, kind: "idle" }],
      ]),
    });
    expect(projection.items[0]).toMatchObject({
      id: "section:stats",
      kind: "estimate",
      lineStats: { additions: 6, deletions: 9 },
    });
  });

  it("records visible measured heights by stable repository path", () => {
    const estimates = new Map<string, number>();
    // PIER_DIFF_ESTIMATE_SLOT_HEIGHT_PX=144, DEFAULT_ESTIMATE_LINES=16
    // 720/144*16 = 80
    recordReviewRenderedHeightEstimates(
      [entry(0)],
      new Map([["section:0", 720]]),
      estimates
    );
    expect(estimates.get("src/file-0.ts")).toBe(80);
  });

  it("records staged measured height through its section id", () => {
    const estimates = new Map<string, number>();
    const unstagedEntry = entry(0);
    const stagedEntry: GitReviewIndexEntry = {
      ...unstagedEntry,
      renderSlots: [
        {
          group: "staged",
          oldPath: null,
          sectionKey: "staged:entry:0",
          status: "modified",
          targetPath: unstagedEntry.path,
        },
      ],
    };
    // 540/144*16 = 60
    recordReviewRenderedHeightEstimates(
      [stagedEntry],
      new Map([["staged:entry:0", 540]]),
      estimates,
      "staged"
    );
    expect(estimates.get("src/file-0.ts")).toBe(60);
  });
});

describe("projectReviewDocuments end-state membership (legacy subset)", () => {
  it("only projects loaded and error members from snapshot resources", () => {
    const resources: GitReviewDocumentResource[] = [
      { entry: entry(0), kind: "idle" },
      { entry: entry(1), kind: "loading", operationId: "op-1" },
      loaded(2),
      {
        entry: entry(3),
        failure: {
          kind: "error",
          message: "boom",
          reason: "internal",
          retryable: true,
        },
        kind: "error",
      },
      { entry: entry(4), kind: "unchanged" },
    ];
    const projection = projectReviewDocuments(
      {
        resources,
        retainedEntryKeys: [],
        settled: false,
      },
      context(),
      "en"
    );

    expect(projection.items.map((item) => item.id)).toEqual([
      "section:2",
      "section:3",
    ]);
    expect(projection.items[0]?.patch).toContain("+new");
    expect(projection.items[1]?.stateNotice).toBe("Unable to load this change");
    expect(
      projection.items.every(
        (item) => !item.cacheKey.startsWith("git-review-placeholder:")
      )
    ).toBe(true);
    expect(projection.entryKeyBySectionId.get("section:2")).toBe("entry:2");
  });

  it("classifies code-view membership", () => {
    expect(isCodeViewMemberResource(loaded(0))).toBe(true);
    expect(
      isCodeViewMemberResource({
        entry: entry(1),
        failure: {
          kind: "error",
          message: "x",
          reason: "internal",
          retryable: false,
        },
        kind: "error",
      })
    ).toBe(true);
    expect(isCodeViewMemberResource({ entry: entry(2), kind: "idle" })).toBe(
      false
    );
    expect(
      isCodeViewMemberResource({
        entry: entry(3),
        kind: "loading",
        operationId: "op",
      })
    ).toBe(false);
  });

  it("orders projected loaded items conflict, staged, unstaged then path", () => {
    const mixed = (partial: {
      path: string;
      entryKey: string;
      slots: Array<{
        group: "conflict" | "unstaged" | "staged" | "committed";
        sectionKey: string;
      }>;
    }): GitReviewDocumentResource => {
      const item: GitReviewIndexEntry = {
        entryKey: partial.entryKey,
        oldPaths: [],
        path: partial.path,
        renderSlots: partial.slots.map((slot) => ({
          group: slot.group,
          oldPath: null,
          sectionKey: slot.sectionKey,
          status: slot.group === "conflict" ? "conflicted" : "modified",
          targetPath: partial.path,
        })),
        status: "modified",
      };
      const firstSlot = partial.slots[0];
      if (firstSlot === undefined) {
        throw new Error("missing mixed review slot");
      }
      return {
        document: partial.slots.some((slot) => slot.group === "conflict")
          ? stateDocument({
              entryKey: partial.entryKey,
              path: partial.path,
              reason: "conflict",
              revision: `rev:${partial.entryKey}`,
              sectionKey: firstSlot.sectionKey,
              status: "conflicted",
            })
          : patchDocumentForEntry(item),
        entry: item,
        kind: "loaded",
      };
    };
    const projection = projectReviewDocuments(
      {
        resources: [
          mixed({
            entryKey: "entry:b",
            path: "b.ts",
            slots: [
              { group: "staged", sectionKey: "sec:s:b" },
              { group: "unstaged", sectionKey: "sec:u:b" },
            ],
          }),
          mixed({
            entryKey: "entry:a",
            path: "a.ts",
            slots: [
              { group: "conflict", sectionKey: "sec:c:a" },
              { group: "unstaged", sectionKey: "sec:u:a" },
              { group: "staged", sectionKey: "sec:s:a" },
            ],
          }),
          mixed({
            entryKey: "entry:z",
            path: "z.ts",
            slots: [{ group: "committed", sectionKey: "sec:m:z" }],
          }),
        ],
        retainedEntryKeys: [],
        settled: false,
      },
      context(),
      "en"
    );
    expect(projection.items.map((item) => item.id)).toEqual([
      "sec:c:a",
      "sec:s:a",
      "sec:s:b",
      "sec:u:a",
      "sec:u:b",
      "sec:m:z",
    ]);
    expect(projection.items[0]?.stageControl).toBeUndefined();
    expect(projection.items[1]?.stageControl).toEqual({ state: "staged" });
    expect(projection.items[3]?.stageControl).toMatchObject({
      state: "unstaged",
    });
  });
});

describe("indexReviewEntrySections", () => {
  it("indexes the section owned by each reading surface", () => {
    const entries = [entry(0), entry(1), entry(2)];
    expect([...indexReviewEntrySections(entries, "index").entries()]).toEqual([
      ["entry:0", "section:0"],
      ["entry:1", "section:1"],
      ["entry:2", "section:2"],
    ]);
    const projection = projectReviewDocuments(
      {
        resources: entries.map((item) => ({
          entry: item,
          kind: "idle" as const,
        })),
        retainedEntryKeys: [],
        settled: true,
      },
      context(),
      "en"
    );
    expect(projection.items).toEqual([]);
    expect(indexReviewDocumentProjection(projection).itemIds).toEqual([]);
  });
});

describe("indexReviewSectionEntries", () => {
  it("maps only sections owned by the requested reading surface", () => {
    const mixedEntry: GitReviewIndexEntry = {
      ...entry(0),
      renderSlots: [
        {
          group: "conflict",
          oldPath: null,
          sectionKey: "conflict:0",
          status: "conflicted",
          targetPath: "src/file-0.ts",
        },
        {
          group: "unstaged",
          oldPath: null,
          sectionKey: "unstaged:0",
          status: "modified",
          targetPath: "src/file-0.ts",
        },
      ],
    };
    expect([
      ...indexReviewSectionEntries([mixedEntry], "conflict").entries(),
    ]).toEqual([["conflict:0", "entry:0"]]);
    expect([
      ...indexReviewSectionEntries([mixedEntry], "index").entries(),
    ]).toEqual([["unstaged:0", "entry:0"]]);
    expect([
      ...indexReviewSectionEntries([mixedEntry], "staged").entries(),
    ]).toEqual([]);
    expect([
      ...indexReviewSectionEntries([entry(1)], "index").entries(),
    ]).toEqual([["section:1", "entry:1"]]);
  });
});
