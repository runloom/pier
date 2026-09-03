import {
  breadcrumbRevealPathForDiskSource,
  breadcrumbSegmentsForPanelSource,
  breadcrumbSegmentsForSource,
} from "@plugins/builtin/files/renderer/panel/source.ts";
import { describe, expect, it } from "vitest";

describe("breadcrumbRevealPathForDiskSource", () => {
  const path =
    "docs/superpowers/specs/2026-06-29-terminal-input-focus-architecture-design.md";

  it("maps project-prefixed segments including the project root", () => {
    const segments = breadcrumbSegmentsForSource(
      { kind: "disk", path, root: "/Users/xyz/ABC/pier" },
      "pier"
    );
    expect(segments[0]).toBe("pier");
    expect(
      breadcrumbRevealPathForDiskSource({
        path,
        projectName: "pier",
        segmentIndex: 0,
      })
    ).toBe("");
    expect(
      breadcrumbRevealPathForDiskSource({
        path,
        projectName: "pier",
        segmentIndex: 1,
      })
    ).toBe("docs");
    expect(
      breadcrumbRevealPathForDiskSource({
        path,
        projectName: "pier",
        segmentIndex: 2,
      })
    ).toBe("docs/superpowers");
    expect(
      breadcrumbRevealPathForDiskSource({
        path,
        projectName: "pier",
        segmentIndex: segments.length - 1,
      })
    ).toBe(path);
  });

  it("maps segments without a project prefix", () => {
    expect(
      breadcrumbRevealPathForDiskSource({
        path,
        projectName: null,
        segmentIndex: 0,
      })
    ).toBe("docs");
    expect(
      breadcrumbRevealPathForDiskSource({
        path,
        projectName: null,
        segmentIndex: 1,
      })
    ).toBe("docs/superpowers");
    expect(
      breadcrumbRevealPathForDiskSource({
        path,
        projectName: null,
        segmentIndex: 4,
      })
    ).toBe(path);
  });
});

describe("breadcrumbSegmentsForPanelSource", () => {
  it("uses the disk root for outside-workspace files, not the project name", () => {
    expect(
      breadcrumbSegmentsForPanelSource(
        {
          kind: "disk",
          path: "config.yaml",
          root: "/Users/xyz/.config/goose",
        },
        "feat-bug-20260830",
        true
      )
    ).toEqual(["/Users/xyz/.config/goose", "config.yaml"]);
  });

  it("keeps the project prefix for in-workspace files", () => {
    expect(
      breadcrumbSegmentsForPanelSource(
        { kind: "disk", path: ".cursor/mcp.json", root: "/repo" },
        "repo",
        false
      )
    ).toEqual(["repo", ".cursor", "mcp.json"]);
  });
});
