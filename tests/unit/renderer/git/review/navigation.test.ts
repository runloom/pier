import type { GitReviewDocumentLoaderSnapshot } from "@plugins/builtin/git/renderer/review/document/resource.ts";
import {
  findReviewNavigationTarget,
  isReviewNavigationContentReady,
  isReviewNavigationTerminal,
  resolveReviewSectionKey,
} from "@plugins/builtin/git/renderer/review/navigation.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { patchDocument, stateDocument } from "./document/fixture.ts";

afterEach(() => vi.restoreAllMocks());

describe("Review navigation verification", () => {
  it("状态 section 使用投影缓存身份导航且不被判为终态", () => {
    const snapshot = {
      retainedEntryKeys: ["entry:binary"],
      resources: [
        {
          document: stateDocument({
            entryKey: "entry:binary",
            path: "src/binary.dat",
            reason: "binary",
            revision: "document:binary",
          }),
          entry: {
            entryKey: "entry:binary",
            oldPaths: [],
            path: "src/binary.dat",
            renderSlots: [
              {
                group: "unstaged",
                oldPath: null,
                sectionKey: "state:binary",
                status: "modified",
                targetPath: "src/binary.dat",
              },
            ],
            status: "modified",
          },
          kind: "loaded",
        },
      ],
      settled: true,
    } satisfies GitReviewDocumentLoaderSnapshot;
    const cacheKey = '["document:binary","entry:binary","en"]';

    expect(
      findReviewNavigationTarget(
        snapshot.resources[0],
        new Map([["state:binary", cacheKey]])
      )
    ).toEqual({ cacheKey, sectionId: "state:binary" });
    expect(
      isReviewNavigationTerminal(snapshot.resources[0], snapshot.settled)
    ).toBe(false);
  });

  it("resolveReviewSectionKey rebinds when preferred left the entry", () => {
    expect(
      resolveReviewSectionKey({
        entryKey: "entry:a",
        entryKeyBySectionId: new Map([["section:staged", "entry:a"]]),
        firstSectionIdByEntryKey: new Map([["entry:a", "section:staged"]]),
        preferredSectionKey: "section:unstaged",
      })
    ).toBe("section:staged");
    expect(
      resolveReviewSectionKey({
        entryKey: "entry:a",
        entryKeyBySectionId: new Map([
          ["section:unstaged", "entry:a"],
          ["section:staged", "entry:a"],
        ]),
        firstSectionIdByEntryKey: new Map([["entry:a", "section:unstaged"]]),
        preferredSectionKey: "section:staged",
      })
    ).toBe("section:staged");
  });

  it("isReviewNavigationTerminal when settled resource lacks orphan sectionKey", () => {
    const entry = {
      entryKey: "entry:a",
      oldPaths: [] as string[],
      path: "a.ts",
      renderSlots: [
        {
          group: "staged" as const,
          oldPath: null,
          sectionKey: "section:staged",
          status: "modified" as const,
          targetPath: "a.ts",
        },
      ],
      status: "modified" as const,
    };
    const loaded = {
      document: patchDocument({
        entryKey: entry.entryKey,
        patch: "diff",
        revision: "r",
      }),
      entry,
      kind: "loaded" as const,
    };
    expect(isReviewNavigationTerminal(loaded, true, "section:unstaged")).toBe(
      true
    );
    expect(isReviewNavigationTerminal(loaded, true, "section:staged")).toBe(
      false
    );
    expect(
      isReviewNavigationTerminal(
        { entry, kind: "unchanged" },
        true,
        "section:unstaged"
      )
    ).toBe(true);
    expect(
      isReviewNavigationTerminal(
        { entry, kind: "unchanged" },
        true,
        "section:staged"
      )
    ).toBe(false);
  });

  it("findReviewNavigationTarget resolves the requested staged/unstaged section", () => {
    const resource = {
      document: patchDocument({
        entryKey: "entry:a",
        patch: "u",
        revision: "document:a",
      }),
      entry: {
        entryKey: "entry:a",
        oldPaths: [],
        path: "a.ts",
        renderSlots: [
          {
            group: "unstaged" as const,
            oldPath: null,
            sectionKey: "section:u",
            status: "modified" as const,
            targetPath: "a.ts",
          },
          {
            group: "staged" as const,
            oldPath: null,
            sectionKey: "section:s",
            status: "modified" as const,
            targetPath: "a.ts",
          },
        ],
        status: "modified" as const,
      },
      kind: "loaded" as const,
    };
    const cacheKeys = new Map([
      ["section:u", "cache:u"],
      ["section:s", "cache:s"],
    ]);
    expect(findReviewNavigationTarget(resource, cacheKeys)).toEqual({
      cacheKey: "cache:u",
      sectionId: "section:u",
    });
    expect(
      findReviewNavigationTarget(resource, cacheKeys, "section:s")
    ).toEqual({ cacheKey: "cache:s", sectionId: "section:s" });
    expect(
      findReviewNavigationTarget(resource, cacheKeys, "section:orphan")
    ).toBeNull();
  });
});

describe("Review navigation content readiness", () => {
  it("treats only loaded/error documents as navigation-ready content", () => {
    expect(isReviewNavigationContentReady(undefined)).toBe(false);
    expect(
      isReviewNavigationContentReady({
        entry: {
          entryKey: "entry:1",
          oldPaths: [],
          path: "a.ts",
          renderSlots: [],
          status: "modified",
        },
        kind: "idle",
      })
    ).toBe(false);
    expect(
      isReviewNavigationContentReady({
        document: patchDocument({
          entryKey: "entry:1",
          patch: "diff",
          revision: "r1",
        }),
        entry: {
          entryKey: "entry:1",
          oldPaths: [],
          path: "a.ts",
          renderSlots: [],
          status: "modified",
        },
        kind: "loaded",
      } as never)
    ).toBe(true);
  });
});
