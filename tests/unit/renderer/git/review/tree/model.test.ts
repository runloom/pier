import { gitReviewTreeModel } from "@plugins/builtin/git/renderer/review/tree.tsx";
import {
  makeReviewTreeNodeId,
  parseReviewTreeNodeId,
} from "@plugins/builtin/git/renderer/review/tree-section.ts";
import { describe, expect, it } from "vitest";

function entry(partial: {
  path: string;
  entryKey?: string;
  slots: Array<{
    group: "unstaged" | "staged" | "conflict" | "committed";
    sectionKey: string;
    status?: "modified" | "added" | "conflicted";
  }>;
}) {
  return {
    entryKey: partial.entryKey ?? `ek:${partial.path}`,
    path: partial.path,
    oldPaths: [] as string[],
    status: partial.slots[0]?.status ?? "modified",
    renderSlots: partial.slots.map((s) => ({
      group: s.group,
      sectionKey: s.sectionKey,
      status: s.status ?? "modified",
      targetPath: partial.path,
      oldPath: null,
    })),
  };
}

/** Match @pierre/trees default segment order (lowercase binary compare). */
function sortLikePierreTrees<T extends { path: string }>(
  items: readonly T[]
): T[] {
  return [...items].sort((a, b) => {
    const left = a.path.toLowerCase();
    const right = b.path.toLowerCase();
    if (left === right) {
      return 0;
    }
    return left < right ? -1 : 1;
  });
}

describe("gitReviewTreeModel grouped", () => {
  const labels = {
    committed: "Changed Files",
    conflict: "Merge Changes",
    staged: "Staged Changes",
    unstaged: "Changes",
  } as const;

  it("emits i18n group roots then section file rows; half-staged path twice", () => {
    const model = gitReviewTreeModel(
      [
        entry({
          path: "a.ts",
          slots: [
            { group: "unstaged", sectionKey: "sec:u:a" },
            { group: "staged", sectionKey: "sec:s:a" },
          ],
        }),
        entry({
          path: "new.ts",
          slots: [
            { group: "unstaged", sectionKey: "sec:u:new", status: "added" },
          ],
        }),
      ],
      (name) => `(file) ${name}`,
      labels
    );
    const groupRoots = model.items.filter(
      (item) => item.kind === "directory" && !item.path.includes("/")
    );
    const rootGroups = sortLikePierreTrees(groupRoots).map((item) =>
      model.getGroupForTreePath(item.path)
    );
    expect(rootGroups).toEqual(["staged", "unstaged"]);

    const unstagedRoot = groupRoots.find(
      (item) => model.getGroupForTreePath(item.path) === "unstaged"
    );
    const stagedRoot = groupRoots.find(
      (item) => model.getGroupForTreePath(item.path) === "staged"
    );
    expect(unstagedRoot?.path.endsWith("Changes")).toBe(true);
    expect(stagedRoot?.path.endsWith("Staged Changes")).toBe(true);
    expect(model.getGroupForTreePath(`${stagedRoot?.path}/a.ts`)).toBe(
      "staged"
    );
    expect(
      model.items.some((item) =>
        /group:(unstaged|staged|conflict)/.test(item.path)
      )
    ).toBe(false);

    const refs = [...model.fileRefByNodeId.values()];
    expect(refs.filter((r) => r.path === "a.ts")).toHaveLength(2);
    expect(refs.map((r) => r.sectionKey).sort()).toEqual(
      ["sec:s:a", "sec:u:a", "sec:u:new"].sort()
    );
    expect(model.groupCounts).toEqual({ conflict: 0, unstaged: 2, staged: 1 });
    expect(model.visibleGroups).toEqual(["staged", "unstaged"]);
    expect(model.getGroupRootPath("staged")).toBe(stagedRoot?.path);
    expect(model.getGroupRootPath("unstaged")).toBe(unstagedRoot?.path);
    expect(model.getGroupRootPath("conflict")).toBeUndefined();
  });

  it("keeps conflict→staged→unstaged root order under zh labels", () => {
    const zhLabels = {
      committed: "变更文件",
      conflict: "合并更改",
      staged: "已暂存更改",
      unstaged: "更改",
    } as const;
    const model = gitReviewTreeModel(
      [
        entry({
          path: "a.ts",
          slots: [
            { group: "unstaged", sectionKey: "sec:u:a" },
            { group: "staged", sectionKey: "sec:s:a" },
          ],
        }),
        entry({
          path: "c.ts",
          slots: [
            {
              group: "conflict",
              sectionKey: "sec:c:c",
              status: "conflicted",
            },
          ],
        }),
      ],
      (name) => name,
      zhLabels
    );
    const roots = model.items.filter(
      (item) => item.kind === "directory" && !item.path.includes("/")
    );
    const sorted = sortLikePierreTrees(roots);
    expect(sorted.map((item) => model.getGroupForTreePath(item.path))).toEqual([
      "conflict",
      "staged",
      "unstaged",
    ]);
    expect(model.visibleGroups).toEqual(["conflict", "staged", "unstaged"]);
    expect(sorted[1]?.path.endsWith("已暂存更改")).toBe(true);
    expect(sorted[2]?.path.endsWith("更改")).toBe(true);
  });

  it("只创建实际包含内容的未提交分组根", () => {
    const model = gitReviewTreeModel(
      [
        entry({
          path: "only-staged.ts",
          slots: [{ group: "staged", sectionKey: "sec:s:only" }],
        }),
      ],
      (name) => name,
      labels
    );
    const roots = model.items.filter(
      (item) => item.kind === "directory" && !item.path.includes("/")
    );
    const staged = roots.find(
      (item) => model.getGroupForTreePath(item.path) === "staged"
    );
    const unstaged = roots.find(
      (item) => model.getGroupForTreePath(item.path) === "unstaged"
    );

    expect(staged).toMatchObject({ hasChildren: true, loadState: "loaded" });
    expect(unstaged).toBeUndefined();
    expect(model.groupCounts).toEqual({
      conflict: 0,
      staged: 1,
      unstaged: 0,
    });
    expect(model.visibleGroups).toEqual(["staged"]);
  });

  it("keeps full path segments under group roots (library flattens visually)", () => {
    // Model paths stay expanded; @pierre/trees flattenMinDepth=2 collapses
    // single-child path chains under group roots at render time.
    const model = gitReviewTreeModel(
      [
        entry({
          path: "docs/superpowers/plans/note.md",
          slots: [{ group: "staged", sectionKey: "sec:s:note" }],
        }),
        entry({
          path: "src/a.ts",
          slots: [{ group: "unstaged", sectionKey: "sec:u:a" }],
        }),
        entry({
          path: "src/b.ts",
          slots: [{ group: "unstaged", sectionKey: "sec:u:b" }],
        }),
      ],
      (name) => name,
      labels
    );

    const stagedRoot = model.items.find(
      (item) =>
        item.kind === "directory" &&
        model.getGroupForTreePath(item.path) === "staged" &&
        !item.path.includes("/")
    );
    expect(stagedRoot?.path.endsWith("Staged Changes")).toBe(true);
    expect(stagedRoot?.path.includes("docs")).toBe(false);

    // Full chain retained in model so library owns flatten presentation.
    expect(
      model.items.some((item) => item.path === `${stagedRoot?.path}/docs`)
    ).toBe(true);
    expect(
      model.items.some(
        (item) => item.path === `${stagedRoot?.path}/docs/superpowers/plans`
      )
    ).toBe(true);
    expect(
      model.getFileRefForTreePath(
        `${stagedRoot?.path}/docs/superpowers/plans/note.md`
      )?.sectionKey
    ).toBe("sec:s:note");

    const unstagedRoot = model.items.find(
      (item) =>
        item.kind === "directory" &&
        model.getGroupForTreePath(item.path) === "unstaged" &&
        !item.path.includes("/")
    );
    expect(
      model.items.some((item) => item.path === `${unstagedRoot?.path}/src`)
    ).toBe(true);
    expect(
      model.getFileRefForTreePath(`${unstagedRoot?.path}/src/a.ts`)
    ).toEqual(expect.objectContaining({ sectionKey: "sec:u:a" }));
  });

  it("lists file refs under a directory or group root path", () => {
    const model = gitReviewTreeModel(
      [
        entry({
          path: "docs/a.md",
          slots: [{ group: "staged", sectionKey: "sec:s:a" }],
        }),
        entry({
          path: "docs/b.md",
          slots: [{ group: "staged", sectionKey: "sec:s:b" }],
        }),
        entry({
          path: "other.ts",
          slots: [{ group: "unstaged", sectionKey: "sec:u:o" }],
        }),
      ],
      (name) => name,
      labels
    );
    const stagedRoot = model.items.find(
      (item) =>
        item.kind === "directory" &&
        model.getGroupForTreePath(item.path) === "staged" &&
        !item.path.includes("/")
    );
    const underRoot = model.getFileRefsUnderTreePath(stagedRoot?.path ?? "");
    expect(underRoot.map((ref) => ref.path).sort()).toEqual([
      "docs/a.md",
      "docs/b.md",
    ]);
    const underDocs = model.getFileRefsUnderTreePath(
      `${stagedRoot?.path}/docs`
    );
    expect(underDocs).toHaveLength(2);
    expect(
      model.getFileRefsUnderTreePath(`${stagedRoot?.path}/docs/a.md`)
    ).toEqual([
      expect.objectContaining({ path: "docs/a.md", sectionKey: "sec:s:a" }),
    ]);
  });

  it("roundtrips node id", () => {
    const id = makeReviewTreeNodeId("sec:u:a");
    expect(parseReviewTreeNodeId(id)).toEqual({ sectionKey: "sec:u:a" });
  });

  it("strips synthetic group roots for repo-relative path copy", () => {
    const model = gitReviewTreeModel(
      [
        entry({
          path: "src/a.ts",
          slots: [{ group: "unstaged", sectionKey: "sec:u:a" }],
        }),
      ],
      (name) => name,
      labels
    );

    const unstagedRoot = model.items.find(
      (item) =>
        item.kind === "directory" &&
        model.getGroupForTreePath(item.path) === "unstaged" &&
        !item.path.includes("/")
    );
    expect(unstagedRoot).toBeDefined();
    expect(model.getRepoRelativePath(unstagedRoot?.path ?? "")).toBeNull();
    expect(model.getRepoRelativePath(`${unstagedRoot?.path}/src`)).toBe("src");
    expect(model.getRepoRelativePath(`${unstagedRoot?.path}/src/a.ts`)).toBe(
      "src/a.ts"
    );
  });

  it("labels committed scope as Changed Files not bare Files", () => {
    const model = gitReviewTreeModel(
      [
        entry({
          path: "src/a.ts",
          slots: [{ group: "committed", sectionKey: "sec:committed:a" }],
        }),
      ],
      (name) => name,
      labels
    );
    const root = model.items.find(
      (item) =>
        item.kind === "directory" &&
        model.getGroupForTreePath(item.path) === "committed" &&
        !item.path.includes("/")
    );
    expect(root?.path.endsWith("Changed Files")).toBe(true);
    expect(root?.path.includes("Changed")).toBe(true);
    // Must not use the old bare "Files" product-confusing label alone.
    expect(
      root?.path.endsWith("Files") && !root?.path.includes("Changed")
    ).toBe(false);
    expect(model.getRepoRelativePath(root?.path ?? "")).toBeNull();
    expect(model.getRepoRelativePath(`${root?.path}/src`)).toBe("src");
    expect(model.getRepoRelativePath(`${root?.path}/src/a.ts`)).toBe(
      "src/a.ts"
    );
  });
});

describe("gitReviewTreeModel rename chains", () => {
  it("uses slot.targetPath so staged rename rows keep intermediate paths", () => {
    const entries = [
      {
        entryKey: "ek:rename",
        oldPaths: ["a.ts"],
        path: "c.ts",
        status: "renamed" as const,
        renderSlots: [
          {
            group: "staged" as const,
            oldPath: "a.ts",
            sectionKey: "staged:b",
            status: "renamed" as const,
            targetPath: "b.ts",
          },
          {
            group: "unstaged" as const,
            oldPath: "b.ts",
            sectionKey: "unstaged:c",
            status: "renamed" as const,
            targetPath: "c.ts",
          },
        ],
      },
    ];
    const model = gitReviewTreeModel(entries, (name) => name, {
      committed: "Changed Files",
      conflict: "Conflicts",
      staged: "Staged",
      unstaged: "Changes",
    });
    // Walk all tree items via fileRefByNodeId values
    const refs = [...model.fileRefByNodeId.values()];
    expect(
      refs
        .filter((ref) => ref.group === "staged")
        .map((ref) => ref.path)
        .sort()
    ).toEqual(["b.ts"]);
    expect(
      refs
        .filter((ref) => ref.group === "unstaged")
        .map((ref) => ref.path)
        .sort()
    ).toEqual(["c.ts"]);
  });
});
