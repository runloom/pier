import { resolveRangeAtLine } from "@plugins/builtin/files/renderer/editor/git-markers.ts";
import { describe, expect, it } from "vitest";

describe("resolveRangeAtLine", () => {
  it("returns null when no range covers the line", () => {
    expect(resolveRangeAtLine([], 1)).toBeNull();
    expect(
      resolveRangeAtLine(
        [
          {
            id: "0:0",
            kind: "added",
            newLineFrom: 2,
            newLineTo: 3,
          },
        ],
        1
      )
    ).toBeNull();
  });

  it("prefers higher-priority kind when ranges overlap", () => {
    const ranges = [
      {
        id: "d",
        kind: "deleted" as const,
        newLineFrom: 5,
        newLineTo: 5,
      },
      {
        id: "m",
        kind: "modified" as const,
        newLineFrom: 5,
        newLineTo: 6,
      },
    ];
    expect(resolveRangeAtLine(ranges, 5)?.id).toBe("m");
  });
});
