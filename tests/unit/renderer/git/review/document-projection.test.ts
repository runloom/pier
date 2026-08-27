import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewFileDocumentOk,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import { describe, expect, it, vi } from "vitest";
import {
  diffMetrics,
  totalScrollHeight,
} from "../../../../../packages/ui/src/diff-view/geometry.ts";
import { toCodeViewItems } from "../../../../../packages/ui/src/diff-view/items.ts";
import { reviewContentEntryKeysInOrder } from "../../../../../src/plugins/builtin/git/renderer/review/document/body-class.ts";
import {
  compareReviewTreePaths,
  defaultReviewCollidingFileLabel,
  indexReviewDocumentProjection,
  indexReviewEntrySections,
  indexReviewSectionEntries,
  isCodeViewMemberResource,
  orderReviewPresentationSlots,
  projectReviewDocumentResource,
  projectReviewLedger,
} from "../../../../../src/plugins/builtin/git/renderer/review/document/projection.ts";
import type { GitReviewDocumentResource } from "../../../../../src/plugins/builtin/git/renderer/review/document/resource.ts";
import { gitReviewTreeModel } from "../../../../../src/plugins/builtin/git/renderer/review/tree.tsx";
import { patchDocument } from "./document-fixture.ts";

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

  it("projects marker-free conflicts as CodeView ready-notice", () => {
    const path = "src/gone.ts";
    const item: GitReviewIndexEntry = {
      entryKey: "entry:dd",
      oldPaths: [],
      path,
      renderSlots: [
        {
          group: "conflict",
          oldPath: null,
          sectionKey: "section:conflict",
          status: "conflicted",
          targetPath: path,
        },
      ],
      status: "conflicted",
    };
    const document: GitReviewFileDocumentOk = {
      entryKey: item.entryKey,
      kind: "ok",
      revision: "revision:dd",
      sections: [
        {
          contents: null,
          contentsDigest: "sha256:dd",
          kind: "conflict",
          oldPath: null,
          presentation: "file-level",
          sectionKey: "section:conflict",
          stages: { baseOid: null, oursOid: null, theirsOid: null },
          status: "conflicted",
          targetPath: path,
          xy: "DD",
        },
      ],
      surfaceSections: {
        committed: null,
        head: null,
        index: null,
        staged: null,
      },
    };
    const projection = projectReviewLedger({
      context: context(),
      diffBase: "conflict",
      entries: [item],
      locale: "en",
      resourceByEntryKey: new Map([
        [item.entryKey, { document, entry: item, kind: "loaded" }],
      ]),
    });
    expect(projection.items).toHaveLength(1);
    expect(projection.items[0]?.kind).toBe("ready-notice");
    expect(projection.items[0]?.conflict).toBeUndefined();
    expect(projection.items[0]?.stateNotice).toContain("stage it to confirm");
    expect(projection.items[0]?.stateNotice).not.toMatch(/open the file/i);
  });

  it("keeps markers-text conflicts on UnresolvedFile", () => {
    const path = "src/conflict.ts";
    const item: GitReviewIndexEntry = {
      entryKey: "entry:uu",
      oldPaths: [],
      path,
      renderSlots: [
        {
          group: "conflict",
          oldPath: null,
          sectionKey: "section:conflict",
          status: "conflicted",
          targetPath: path,
        },
      ],
      status: "conflicted",
    };
    const contents = [
      "<<<<<<< HEAD",
      "ours",
      "=======",
      "theirs",
      ">>>>>>> other",
      "",
    ].join("\n");
    const document: GitReviewFileDocumentOk = {
      entryKey: item.entryKey,
      kind: "ok",
      revision: "revision:uu",
      sections: [
        {
          contents,
          contentsDigest: "sha256:uu",
          kind: "conflict",
          oldPath: null,
          presentation: "markers-text",
          sectionKey: "section:conflict",
          stages: { baseOid: null, oursOid: null, theirsOid: null },
          status: "conflicted",
          targetPath: path,
          xy: "UU",
        },
      ],
      surfaceSections: {
        committed: null,
        head: null,
        index: null,
        staged: null,
      },
    };
    const projection = projectReviewLedger({
      context: context(),
      diffBase: "conflict",
      entries: [item],
      locale: "en",
      resourceByEntryKey: new Map([
        [item.entryKey, { document, entry: item, kind: "loaded" }],
      ]),
    });
    expect(projection.items[0]?.kind).toBe("conflict");
    expect(projection.items[0]?.conflict?.presentation).toBe("markers-text");
    expect(projection.items[0]?.conflict?.contents).toBe(contents);
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
    // estimate 无正文 patch；高度由 geometry 决定，不挂 estimateLines
    expect(projection.items[0]?.patch).toBeNull();
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

  it("mounts all content slots as estimate (demand does not drop ledger ids)", () => {
    const entries = [entry(0), entry(1), entry(2), entry(3), entry(4)];
    const resourceByEntryKey = new Map<string, GitReviewDocumentResource>(
      entries.map((item) => [item.entryKey, { entry: item, kind: "idle" }])
    );
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
    expect(projection.items.every((item) => item.kind === "estimate")).toBe(
      true
    );
  });

  it("keeps loaded body outside hydration priority (soft-retain)", () => {
    const entries = [entry(0), entry(1)];
    const projection = projectReviewLedger({
      allowedBodyEntryKeys: new Set(["entry:0"]),
      context: context(),
      entries,
      locale: "en",
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

  it("collapse-all scroll height uses full content n×header (59 files)", () => {
    const n = 59;
    const entries = Array.from({ length: n }, (_, index) => entry(index));
    const projection = projectReviewLedger({
      context: context(),
      entries,
      locale: "en",
      resourceByEntryKey: new Map(
        entries.map((item) => [item.entryKey, { entry: item, kind: "idle" }])
      ),
    });
    expect(projection.items).toHaveLength(n);
    const metrics = diffMetrics("13px");
    const heights = projection.items.map(() => metrics.headerHeight);
    expect(totalScrollHeight(heights, metrics.gap)).toBe(
      n * metrics.headerHeight + (n - 1) * metrics.gap
    );
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
    // 无权威令牌时控件不禁用：stage/unstage 是路径操作，discard 点击时按需取令牌。
    // 否则大仓折叠全部后按钮会随正文逐个解锁 / 逐个冒出来。
    expect(pending.items[0]?.stageControl?.busy).toBeUndefined();
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
      resourceByEntryKey: new Map([["entry:2", loaded(2)]]),
    });

    // allowedBody 只控 mutation 权威；已 loaded 必须画真正文，不能退回 estimate。
    expect(projection.items[0]?.kind).toBe("loaded");
    expect(projection.items[0]?.patch).toContain("+new");
    // 权威之外控件不禁用（令牌只在 discard 点击时按需取）。
    expect(projection.items[0]?.stageControl?.busy).toBeUndefined();
    expect(projection.items[0]?.stageControl).toMatchObject({
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

  it("does not reuse a lone image section across staged and unstaged slots", () => {
    const path = "icon.png";
    const oid = "a".repeat(40);
    const entry: GitReviewIndexEntry = {
      entryKey: "entry:icon",
      oldPaths: [],
      path,
      renderSlots: [
        {
          binary: true,
          group: "unstaged",
          oldPath: null,
          sectionKey: "section:unstaged",
          status: "modified",
          targetPath: path,
        },
        {
          binary: true,
          group: "staged",
          oldPath: null,
          sectionKey: "section:staged",
          status: "modified",
          targetPath: path,
        },
      ],
      status: "modified",
    };
    const document: GitReviewFileDocumentOk = {
      entryKey: entry.entryKey,
      kind: "ok",
      revision: "rev-image",
      sections: [
        {
          after: {
            byteSize: 8,
            height: 1,
            kind: "blob",
            mime: "image/png",
            oid,
            width: 1,
          },
          before: null,
          gitRootPath: "/workspace",
          kind: "image",
          oldPath: null,
          sectionKey: "section:staged",
          status: "modified",
          targetPath: path,
        },
      ],
      surfaceSections: {
        committed: null,
        head: null,
        index: null,
        staged: "section:staged",
      },
    };
    const projection = projectReviewDocumentResource(
      { document, entry, kind: "loaded" },
      context(),
      "en"
    );
    expect(projection.items.map((item) => item.id)).toEqual(["section:staged"]);
    expect(projection.items[0]?.kind).toBe("image");
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
});

describe("presentation order gold standard (tree ≡ CodeView)", () => {
  const treeLabels = {
    committed: "Changed Files",
    conflict: "Merge Changes",
    staged: "Staged Changes",
    unstaged: "Changes",
  } as const;

  function contentEntry(path: string, sectionKey: string): GitReviewIndexEntry {
    return {
      entryKey: `entry:${path}`,
      oldPaths: [],
      path,
      renderSlots: [
        {
          group: "unstaged",
          oldPath: null,
          sectionKey,
          status: "modified",
          targetPath: path,
        },
      ],
      status: "modified",
    };
  }

  it("places root files after directories (AGENTS.md after src/…)", () => {
    const paths = [
      "AGENTS.md",
      "src/main/ipc/notification-center.ts",
      "tests/unit/main/notification/deliver-os.test.ts",
    ];
    expect([...paths].toSorted(compareReviewTreePaths)).toEqual([
      "src/main/ipc/notification-center.ts",
      "tests/unit/main/notification/deliver-os.test.ts",
      "AGENTS.md",
    ]);
    // Flat localeCompare would put AGENTS.md first — that is the bug we fixed.
    expect([...paths].toSorted((a, b) => a.localeCompare(b))[0]).toBe(
      "AGENTS.md"
    );
  });

  it("uses natural segment order (file2 before file10)", () => {
    expect(compareReviewTreePaths("file2.ts", "file10.ts")).toBeLessThan(0);
  });

  it("keeps tree orderedFileRefs section order identical to CodeView ledger", () => {
    const agents = contentEntry("AGENTS.md", "section:agents");
    const nested = contentEntry("src/z.ts", "section:nested");
    const entries = [agents, nested];
    const label = defaultReviewCollidingFileLabel;
    const tree = gitReviewTreeModel(entries, label, treeLabels);
    const projection = projectReviewLedger({
      collidingFileLabel: label,
      context: context(),
      entries,
      locale: "en",
      resourceByEntryKey: new Map(),
    });
    expect(tree.orderedFileRefs.map((ref) => ref.sectionKey)).toEqual([
      "section:nested",
      "section:agents",
    ]);
    expect(projection.items.map((item) => item.id)).toEqual(
      tree.orderedFileRefs.map((ref) => ref.sectionKey)
    );
    expect(reviewContentEntryKeysInOrder(entries, undefined, label)).toEqual([
      "entry:src/z.ts",
      "entry:AGENTS.md",
    ]);
  });

  it("aligns collision display paths between tree and presentation ledger", () => {
    // File `src` collides with directory prefix of `src/child.ts`.
    const fileAtDirName = contentEntry("src", "section:src-file");
    const child = contentEntry("src/child.ts", "section:src-child");
    const entries = [fileAtDirName, child];
    const label = (name: string) => `(file) ${name}`;
    const ordered = orderReviewPresentationSlots(entries, {
      collidingFileLabel: label,
    });
    // Under `src/`, `(file) src` sorts before `child.ts` (pierre segment order).
    expect(ordered.map((row) => row.displayPath)).toEqual([
      "src/(file) src",
      "src/child.ts",
    ]);
    const tree = gitReviewTreeModel(entries, label, treeLabels);
    expect(tree.orderedFileRefs.map((ref) => ref.sectionKey)).toEqual(
      ordered.map((row) => row.sectionKey)
    );
    const projection = projectReviewLedger({
      collidingFileLabel: label,
      context: context(),
      entries,
      locale: "en",
      resourceByEntryKey: new Map(),
    });
    expect(projection.items.map((item) => item.id)).toEqual(
      ordered.map((row) => row.sectionKey)
    );
  });

  it("orders staged before unstaged for the same path (group ledger)", () => {
    const half: GitReviewIndexEntry = {
      entryKey: "entry:half",
      oldPaths: [],
      path: "a.ts",
      renderSlots: [
        {
          group: "unstaged",
          oldPath: null,
          sectionKey: "section:u",
          status: "modified",
          targetPath: "a.ts",
        },
        {
          group: "staged",
          oldPath: null,
          sectionKey: "section:s",
          status: "modified",
          targetPath: "a.ts",
        },
      ],
      status: "modified",
    };
    const label = defaultReviewCollidingFileLabel;
    const tree = gitReviewTreeModel([half], label, treeLabels);
    const projection = projectReviewLedger({
      collidingFileLabel: label,
      context: context(),
      entries: [half],
      locale: "en",
      resourceByEntryKey: new Map(),
    });
    expect(tree.orderedFileRefs.map((ref) => ref.sectionKey)).toEqual([
      "section:s",
      "section:u",
    ]);
    expect(projection.items.map((item) => item.id)).toEqual([
      "section:s",
      "section:u",
    ]);
  });

  it("keeps content order when meta sibling creates collision geometry", () => {
    // Content file `pkg` + pure-rename meta under `pkg/` + root `zoo.ts`.
    // Tree rewrites `pkg` → `pkg/File change · pkg` so zoo can sort before
    // bare `pkg` only if collision is ignored. After full-geometry order,
    // content subsequence must match tree content refs.
    const pkgContent: GitReviewIndexEntry = {
      entryKey: "entry:pkg",
      oldPaths: [],
      path: "pkg",
      renderSlots: [
        {
          group: "unstaged",
          oldPath: null,
          sectionKey: "section:pkg",
          status: "modified",
          targetPath: "pkg",
        },
      ],
      status: "modified",
    };
    const metaNested: GitReviewIndexEntry = {
      entryKey: "entry:meta",
      oldPaths: ["pkg/old.ts"],
      path: "pkg/deep/x.ts",
      renderSlots: [
        {
          additions: 0,
          deletions: 0,
          group: "unstaged",
          oldPath: "pkg/old.ts",
          sectionKey: "section:meta",
          status: "renamed",
          targetPath: "pkg/deep/x.ts",
        },
      ],
      status: "renamed",
    };
    const zoo: GitReviewIndexEntry = {
      entryKey: "entry:zoo",
      oldPaths: [],
      path: "zoo.ts",
      renderSlots: [
        {
          group: "unstaged",
          oldPath: null,
          sectionKey: "section:zoo",
          status: "modified",
          targetPath: "zoo.ts",
        },
      ],
      status: "modified",
    };
    const entries = [pkgContent, metaNested, zoo];
    const label = defaultReviewCollidingFileLabel;
    const full = orderReviewPresentationSlots(entries, {
      collidingFileLabel: label,
    });
    const contentOnly = orderReviewPresentationSlots(entries, {
      collidingFileLabel: label,
      includeSlot: (slot) =>
        slot.status === "modified" ||
        slot.status === "added" ||
        slot.status === "deleted" ||
        slot.status === "conflicted" ||
        (slot.status === "renamed" &&
          typeof slot.additions === "number" &&
          typeof slot.deletions === "number" &&
          slot.additions + slot.deletions > 0),
    });
    // Meta still in full ledger; content filter drops pure rename.
    expect(full.map((row) => row.sectionKey)).toContain("section:meta");
    expect(contentOnly.map((row) => row.sectionKey)).toEqual([
      "section:pkg",
      "section:zoo",
    ]);
    // Collision rewrite puts pkg under directory — displayPath is not bare `pkg`.
    const pkgRow = full.find((row) => row.sectionKey === "section:pkg");
    expect(pkgRow?.displayPath.startsWith("pkg/")).toBe(true);

    const tree = gitReviewTreeModel(entries, label, treeLabels);
    const contentTreeKeys = tree.orderedFileRefs
      .filter((ref) => ref.sectionKey !== "section:meta")
      .map((ref) => ref.sectionKey);
    const projection = projectReviewLedger({
      collidingFileLabel: label,
      context: context(),
      entries,
      locale: "en",
      resourceByEntryKey: new Map(),
    });
    expect(projection.items.map((item) => item.id)).toEqual(contentTreeKeys);
    expect(reviewContentEntryKeysInOrder(entries, undefined, label)).toEqual([
      "entry:pkg",
      "entry:zoo",
    ]);
  });

  it("uses shared colliding label so locale-sensitive collision order matches", () => {
    const fileAtDir = contentEntry("a", "section:a");
    const nested = contentEntry("a/b", "section:ab");
    const entries = [fileAtDir, nested];
    const en = defaultReviewCollidingFileLabel;
    const zh = (name: string) => `文件变更 · ${name}`;
    const enOrder = orderReviewPresentationSlots(entries, {
      collidingFileLabel: en,
    }).map((row) => row.sectionKey);
    const zhOrder = orderReviewPresentationSlots(entries, {
      collidingFileLabel: zh,
    }).map((row) => row.sectionKey);
    // Labels differ; order must still be computed with the *same* factory on
    // both tree and ledger (not English default on one side only).
    const treeZh = gitReviewTreeModel(entries, zh, treeLabels);
    const ledgerZh = projectReviewLedger({
      collidingFileLabel: zh,
      context: context(),
      entries,
      locale: "zh-CN",
      resourceByEntryKey: new Map(),
    });
    expect(ledgerZh.items.map((item) => item.id)).toEqual(
      treeZh.orderedFileRefs.map((ref) => ref.sectionKey)
    );
    expect(enOrder).toEqual(["section:ab", "section:a"]);
    // zh label still sorts before `b` or after depending on first char — pin
    // tree≡ledger regardless of absolute en/zh relative difference.
    expect(zhOrder).toEqual(
      treeZh.orderedFileRefs.map((ref) => ref.sectionKey)
    );
  });

  it("pins path-store parity table (dirs-first, natural digits, case)", () => {
    // Mirrors @pierre/trees path-store comparePreparedEntries for file leaves.
    expect(compareReviewTreePaths("src/a.ts", "AGENTS.md")).toBeLessThan(0);
    expect(compareReviewTreePaths("file2.ts", "file10.ts")).toBeLessThan(0);
    expect(compareReviewTreePaths("src/A.ts", "src/a.ts")).toBeLessThan(0);
    expect(compareReviewTreePaths("b/a.ts", "a.ts")).toBeLessThan(0);
  });
});

describe("isCodeViewMemberResource", () => {
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
});

describe("indexReviewEntrySections", () => {
  it("indexes the section owned by each reading surface", () => {
    const entries = [entry(0), entry(1), entry(2)];
    expect([...indexReviewEntrySections(entries, "index").entries()]).toEqual([
      ["entry:0", "section:0"],
      ["entry:1", "section:1"],
      ["entry:2", "section:2"],
    ]);
    const projection = projectReviewLedger({
      context: context(),
      entries: [],
      locale: "en",
      resourceByEntryKey: new Map(),
    });
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
