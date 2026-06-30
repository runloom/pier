import { describe, expect, it } from "vitest";
import { sanitizeSavedLayout } from "@/components/workspace/sanitize-saved-layout.ts";

const known = new Set(["terminal", "welcome"]);

function layoutWith(panels: Record<string, { contentComponent: string }>) {
  return {
    activeGroup: "g1",
    grid: {
      height: 800,
      orientation: "HORIZONTAL",
      root: {
        data: Object.keys(panels).map((id) => ({
          data: { id, views: [id] },
          size: 800,
          type: "leaf",
        })),
        size: 1200,
        type: "branch",
      },
      width: 1200,
    },
    panels,
  };
}

describe("sanitizeSavedLayout", () => {
  it("keeps panels whose contentComponent is registered", () => {
    const result = sanitizeSavedLayout(
      layoutWith({
        "terminal-1": { contentComponent: "terminal" },
        "welcome-1": { contentComponent: "welcome" },
      }),
      known
    );
    expect(result).not.toBeNull();
    expect(Object.keys(result?.panels ?? {})).toEqual([
      "terminal-1",
      "welcome-1",
    ]);
  });

  it("drops panels whose contentComponent is unknown but keeps the rest", () => {
    const result = sanitizeSavedLayout(
      layoutWith({
        "git-changes": { contentComponent: "pier.git.changes" },
        "terminal-1": { contentComponent: "terminal" },
      }),
      known
    );
    expect(result).not.toBeNull();
    expect(Object.keys(result?.panels ?? {})).toEqual(["terminal-1"]);
    const root = result?.grid.root as { data?: unknown[] };
    expect(root.data?.length).toBe(1);
  });

  it("returns null when no panel survives sanitization", () => {
    const result = sanitizeSavedLayout(
      layoutWith({
        "git-changes": { contentComponent: "pier.git.changes" },
      }),
      known
    );
    expect(result).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(sanitizeSavedLayout(null, known)).toBeNull();
    expect(sanitizeSavedLayout({}, known)).toBeNull();
    expect(sanitizeSavedLayout({ panels: "no" }, known)).toBeNull();
  });
});
