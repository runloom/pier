import { describe, expect, it } from "vitest";
import { sanitizeSavedLayout } from "@/components/workspace/sanitize-saved-layout.ts";

const known = new Set(["terminal", "welcome"]);

interface PanelEntry {
  contentComponent: string;
  id: string;
}

interface LeafSpec {
  activeView?: string;
  groupId: string;
  views: readonly string[];
}

function panelDict(entries: readonly PanelEntry[]) {
  return Object.fromEntries(
    entries.map(({ id, contentComponent }) => [
      id,
      {
        contentComponent,
        id,
        params: {},
        tabComponent: "default",
        title: id,
      },
    ])
  );
}

function leaf({ groupId, views, activeView }: LeafSpec) {
  const data: Record<string, unknown> = {
    id: groupId,
    views: [...views],
  };
  if (activeView !== undefined) {
    data.activeView = activeView;
  }
  return {
    data,
    size: 800,
    type: "leaf",
  };
}

function group(spec: LeafSpec, extra: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    id: spec.groupId,
    views: [...spec.views],
  };
  if (spec.activeView !== undefined) {
    data.activeView = spec.activeView;
  }
  return { data, ...extra };
}

function layout(opts: {
  panels: readonly PanelEntry[];
  leaves: readonly LeafSpec[];
  floatingGroups?: readonly LeafSpec[];
  popoutGroups?: readonly LeafSpec[];
}) {
  return {
    activeGroup: opts.leaves[0]?.groupId,
    floatingGroups: (opts.floatingGroups ?? []).map((spec) =>
      group(spec, {
        position: { left: 100, top: 100, width: 400, height: 300 },
      })
    ),
    grid: {
      height: 800,
      orientation: "HORIZONTAL",
      root: {
        data: opts.leaves.map(leaf),
        size: 1200,
        type: "branch",
      },
      width: 1200,
    },
    panels: panelDict(opts.panels),
    popoutGroups: (opts.popoutGroups ?? []).map((spec) =>
      group(spec, { url: "popout://" })
    ),
  };
}

describe("sanitizeSavedLayout", () => {
  it("keeps panels whose contentComponent is registered", () => {
    const result = sanitizeSavedLayout(
      layout({
        leaves: [
          { groupId: "1", views: ["terminal-1"] },
          { groupId: "2", views: ["welcome-1"] },
        ],
        panels: [
          { contentComponent: "terminal", id: "terminal-1" },
          { contentComponent: "welcome", id: "welcome-1" },
        ],
      }),
      known
    );
    expect(result).not.toBeNull();
    expect(Object.keys(result?.panels ?? {})).toEqual([
      "terminal-1",
      "welcome-1",
    ]);
    const branch = result?.grid.root as { data?: unknown[] };
    expect(branch.data?.length).toBe(2);
  });

  it("drops a leaf whose only view is unknown but keeps sibling leaves", () => {
    const result = sanitizeSavedLayout(
      layout({
        leaves: [
          { groupId: "1", views: ["git-changes"] },
          { groupId: "2", views: ["terminal-1"] },
        ],
        panels: [
          { contentComponent: "pier.git.changes", id: "git-changes" },
          { contentComponent: "terminal", id: "terminal-1" },
        ],
      }),
      known
    );
    expect(result).not.toBeNull();
    expect(Object.keys(result?.panels ?? {})).toEqual(["terminal-1"]);
    const branch = result?.grid.root as {
      data?: Array<{ data?: { id?: string } }>;
    };
    expect(branch.data?.length).toBe(1);
    expect(branch.data?.[0]?.data?.id).toBe("2");
  });

  it("prunes unknown panel id from a tabbed leaf's views and rewrites activeView", () => {
    const result = sanitizeSavedLayout(
      layout({
        leaves: [
          {
            activeView: "git-changes",
            groupId: "1",
            views: ["terminal-1", "git-changes"],
          },
        ],
        panels: [
          { contentComponent: "terminal", id: "terminal-1" },
          { contentComponent: "pier.git.changes", id: "git-changes" },
        ],
      }),
      known
    );
    expect(result).not.toBeNull();
    expect(Object.keys(result?.panels ?? {})).toEqual(["terminal-1"]);
    const branch = result?.grid.root as {
      data?: Array<{ data?: { views?: string[]; activeView?: string } }>;
    };
    expect(branch.data?.[0]?.data?.views).toEqual(["terminal-1"]);
    // activeView pointed to dropped panel → re-pinned to a surviving view.
    expect(branch.data?.[0]?.data?.activeView).toBe("terminal-1");
  });

  it("returns null when no panel survives sanitization", () => {
    const result = sanitizeSavedLayout(
      layout({
        leaves: [{ groupId: "1", views: ["git-changes"] }],
        panels: [{ contentComponent: "pier.git.changes", id: "git-changes" }],
      }),
      known
    );
    expect(result).toBeNull();
  });

  it("sanitizes floating groups the same way as the main grid", () => {
    const result = sanitizeSavedLayout(
      layout({
        floatingGroups: [
          { groupId: "f1", views: ["git-changes"] },
          {
            groupId: "f2",
            views: ["welcome-1", "git-changes"],
            activeView: "git-changes",
          },
        ],
        leaves: [{ groupId: "1", views: ["terminal-1"] }],
        panels: [
          { contentComponent: "terminal", id: "terminal-1" },
          { contentComponent: "welcome", id: "welcome-1" },
          { contentComponent: "pier.git.changes", id: "git-changes" },
        ],
      }),
      known
    );
    expect(result).not.toBeNull();
    const floating = (
      result as unknown as {
        floatingGroups: Array<{
          data?: { views?: string[]; activeView?: string };
        }>;
      }
    ).floatingGroups;
    expect(floating.length).toBe(1);
    expect(floating[0]?.data?.views).toEqual(["welcome-1"]);
    expect(floating[0]?.data?.activeView).toBe("welcome-1");
  });

  it("uses fallback activeView when the source group omits one", () => {
    const result = sanitizeSavedLayout(
      layout({
        leaves: [{ groupId: "1", views: ["terminal-1", "welcome-1"] }],
        panels: [
          { contentComponent: "terminal", id: "terminal-1" },
          { contentComponent: "welcome", id: "welcome-1" },
        ],
      }),
      known
    );
    expect(result).not.toBeNull();
    const branch = result?.grid.root as {
      data?: Array<{ data?: { activeView?: string } }>;
    };
    // 源里没声明 activeView → fallback 到 keptViews 最后一项("welcome-1")。
    expect(branch.data?.[0]?.data?.activeView).toBe("welcome-1");
  });

  it("sanitizes popoutGroups the same way as floatingGroups", () => {
    const result = sanitizeSavedLayout(
      layout({
        leaves: [{ groupId: "1", views: ["terminal-1"] }],
        panels: [
          { contentComponent: "terminal", id: "terminal-1" },
          { contentComponent: "welcome", id: "welcome-1" },
          { contentComponent: "pier.git.changes", id: "git-changes" },
        ],
        popoutGroups: [
          { groupId: "p1", views: ["git-changes"] },
          {
            activeView: "git-changes",
            groupId: "p2",
            views: ["welcome-1", "git-changes"],
          },
        ],
      }),
      known
    );
    expect(result).not.toBeNull();
    const popout = (
      result as unknown as {
        popoutGroups: Array<{
          data?: { activeView?: string; views?: string[] };
        }>;
      }
    ).popoutGroups;
    expect(popout.length).toBe(1);
    expect(popout[0]?.data?.views).toEqual(["welcome-1"]);
    expect(popout[0]?.data?.activeView).toBe("welcome-1");
  });

  it("returns null for malformed input", () => {
    expect(sanitizeSavedLayout(null, known)).toBeNull();
    expect(sanitizeSavedLayout({}, known)).toBeNull();
    expect(sanitizeSavedLayout({ panels: "no" }, known)).toBeNull();
  });
});
