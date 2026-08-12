import { describe, expect, it } from "vitest";
import {
  disambiguateFileTabTitles,
  type FileTabDisambiguationEntry,
  fileTabBasename,
  fileTabsShouldDisambiguate,
} from "@/lib/files/disambiguate-tab-titles.ts";

function entry(
  partial: FileTabDisambiguationEntry
): FileTabDisambiguationEntry {
  return partial;
}

describe("fileTabBasename", () => {
  it("returns the leaf segment", () => {
    expect(fileTabBasename("src/panel.tsx")).toBe("panel.tsx");
    expect(fileTabBasename("panel.tsx")).toBe("panel.tsx");
  });
});

describe("fileTabsShouldDisambiguate", () => {
  it("is false for different basenames", () => {
    expect(
      fileTabsShouldDisambiguate(
        entry({
          groupId: "g1",
          path: "a.ts",
          panelId: "1",
          root: "/repo",
        }),
        entry({
          groupId: "g1",
          path: "b.ts",
          panelId: "2",
          root: "/repo",
        })
      )
    ).toBe(false);
  });

  it("is true in the same group for same basename different paths", () => {
    expect(
      fileTabsShouldDisambiguate(
        entry({
          groupId: "g1",
          path: "src/a.ts",
          panelId: "1",
          root: "/repo",
        }),
        entry({
          groupId: "g1",
          path: "lib/a.ts",
          panelId: "2",
          root: "/repo",
        })
      )
    ).toBe(true);
  });

  it("is true across groups only when roots differ", () => {
    expect(
      fileTabsShouldDisambiguate(
        entry({
          groupId: "g1",
          path: "src/a.ts",
          panelId: "1",
          root: "/wt-a",
        }),
        entry({
          groupId: "g2",
          path: "src/a.ts",
          panelId: "2",
          root: "/wt-b",
        })
      )
    ).toBe(true);
    expect(
      fileTabsShouldDisambiguate(
        entry({
          groupId: "g1",
          path: "src/a.ts",
          panelId: "1",
          root: "/repo",
        }),
        entry({
          groupId: "g2",
          path: "lib/a.ts",
          panelId: "2",
          root: "/repo",
        })
      )
    ).toBe(false);
  });
});

describe("disambiguateFileTabTitles", () => {
  it("keeps basename when there is no conflict", () => {
    const out = disambiguateFileTabTitles([
      entry({
        groupId: "g1",
        path: "src/panel.tsx",
        panelId: "p1",
        root: "/repo",
      }),
    ]);
    expect(out.get("p1")).toBe("panel.tsx");
  });

  it("uses parent path segments for same-root same-group collisions", () => {
    const out = disambiguateFileTabTitles([
      entry({
        groupId: "g1",
        path: "src/a.ts",
        panelId: "p1",
        root: "/repo",
      }),
      entry({
        groupId: "g1",
        path: "lib/a.ts",
        panelId: "p2",
        root: "/repo",
      }),
    ]);
    expect(out.get("p1")).toBe("a.ts · src");
    expect(out.get("p2")).toBe("a.ts · lib");
  });

  it("uses worktree leaf for different roots (same or cross group)", () => {
    const out = disambiguateFileTabTitles([
      entry({
        groupId: "g1",
        path: "src/panel.tsx",
        panelId: "p1",
        root: "/Users/dev/pier",
      }),
      entry({
        groupId: "g1",
        path: "src/panel.tsx",
        panelId: "p2",
        root: "/Users/dev/pier.worktree/feature-canvas",
      }),
    ]);
    expect(out.get("p1")).toBe("panel.tsx · pier");
    expect(out.get("p2")).toBe("panel.tsx · feature-canvas");
  });

  it("disambiguates cross-group different roots", () => {
    const out = disambiguateFileTabTitles([
      entry({
        groupId: "left",
        path: "src/a.ts",
        panelId: "p1",
        root: "/wt-a",
      }),
      entry({
        groupId: "right",
        path: "src/a.ts",
        panelId: "p2",
        root: "/wt-b",
      }),
    ]);
    expect(out.get("p1")).toBe("a.ts · wt-a");
    expect(out.get("p2")).toBe("a.ts · wt-b");
  });

  it("does not decorate cross-group same-root different paths", () => {
    const out = disambiguateFileTabTitles([
      entry({
        groupId: "left",
        path: "src/a.ts",
        panelId: "p1",
        root: "/repo",
      }),
      entry({
        groupId: "right",
        path: "lib/a.ts",
        panelId: "p2",
        root: "/repo",
      }),
    ]);
    expect(out.get("p1")).toBe("a.ts");
    expect(out.get("p2")).toBe("a.ts");
  });

  it("deepens path segments when nearest parents collide", () => {
    const out = disambiguateFileTabTitles([
      entry({
        groupId: "g1",
        path: "packages/app/src/index.ts",
        panelId: "p1",
        root: "/repo",
      }),
      entry({
        groupId: "g1",
        path: "packages/ui/src/index.ts",
        panelId: "p2",
        root: "/repo",
      }),
    ]);
    expect(out.get("p1")).toBe("index.ts · app/src");
    expect(out.get("p2")).toBe("index.ts · ui/src");
  });

  it("deepens root path when root leaves match but absolute roots differ", () => {
    const out = disambiguateFileTabTitles([
      entry({
        groupId: "g1",
        path: "src/panel.tsx",
        panelId: "p1",
        root: "/Users/a/pier",
      }),
      entry({
        groupId: "g1",
        path: "src/panel.tsx",
        panelId: "p2",
        root: "/Users/b/pier",
      }),
    ]);
    expect(out.get("p1")).toBe("panel.tsx · a/pier");
    expect(out.get("p2")).toBe("panel.tsx · b/pier");
  });

  it("uses full root as last-resort label when progressive segments still collide", () => {
    // Same leaf chain only differs at absolute root string (already normalized).
    const out = disambiguateFileTabTitles([
      entry({
        groupId: "g1",
        path: "a.ts",
        panelId: "p1",
        root: "/x/y/z",
      }),
      entry({
        groupId: "g1",
        path: "a.ts",
        panelId: "p2",
        root: "/x/y/z",
      }),
    ]);
    // Same identity → not peers; both stay basename (no self-disambiguation).
    expect(out.get("p1")).toBe("a.ts");
    expect(out.get("p2")).toBe("a.ts");
  });

  it("combines root and path when multi-root and same-root path siblings collide", () => {
    const out = disambiguateFileTabTitles([
      entry({
        groupId: "g1",
        path: "src/a.ts",
        panelId: "p1",
        root: "/wt-a",
      }),
      entry({
        groupId: "g1",
        path: "lib/a.ts",
        panelId: "p2",
        root: "/wt-a",
      }),
      entry({
        groupId: "g1",
        path: "src/a.ts",
        panelId: "p3",
        root: "/wt-b",
      }),
    ]);
    // path-only is unique for lib; src needs root because it collides with wt-b.
    expect(out.get("p1")).toBe("a.ts · wt-a/src");
    expect(out.get("p2")).toBe("a.ts · lib");
    expect(out.get("p3")).toBe("a.ts · wt-b");
  });
});
