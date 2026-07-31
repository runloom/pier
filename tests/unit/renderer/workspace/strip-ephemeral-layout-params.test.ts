import { describe, expect, it } from "vitest";
import {
  EPHEMERAL_LAYOUT_PANEL_PARAM_KEYS,
  stripEphemeralLayoutParams,
} from "@/components/workspace/strip-ephemeral-layout-params.ts";

describe("stripEphemeralLayoutParams", () => {
  it("strips tabChangeSummary from panel params without mutating identity when absent", () => {
    const layout = {
      panels: {
        "git-1": {
          contentComponent: "pier.git.changes",
          id: "git-1",
          params: {
            source: { target: { kind: "uncommitted" } },
            tabChangeSummary: {
              changedFiles: 1,
              deletions: 0,
              excludedFiles: 0,
              insertions: 2,
              kind: "lineDelta",
            },
          },
          title: "repo",
        },
        "term-1": {
          contentComponent: "terminal",
          id: "term-1",
          params: { cwd: "/repo" },
          title: "Terminal",
        },
      },
    };

    const stripped = stripEphemeralLayoutParams(layout) as typeof layout;
    expect(stripped).not.toBe(layout);
    expect(stripped.panels["git-1"]?.params).toEqual({
      source: { target: { kind: "uncommitted" } },
    });
    expect(stripped.panels["term-1"]).toBe(layout.panels["term-1"]);
    expect(EPHEMERAL_LAYOUT_PANEL_PARAM_KEYS).toContain("tabChangeSummary");
  });

  it("returns the same reference when nothing ephemeral is present", () => {
    const layout = {
      panels: {
        a: { id: "a", params: { x: 1 } },
      },
    };
    expect(stripEphemeralLayoutParams(layout)).toBe(layout);
  });
});
