import {
  breadcrumbRevealPathForDiskSource,
  breadcrumbSegmentsForSource,
} from "@plugins/builtin/files/renderer/file-panel-source.ts";
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
