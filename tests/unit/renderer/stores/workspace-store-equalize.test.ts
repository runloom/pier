import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

type Orientation = "HORIZONTAL" | "VERTICAL";

interface SplitviewProbe {
  calls: Array<{ index: number; size: number }>;
  contentSize: number;
  distributeViewSizes: ReturnType<typeof vi.fn>;
  getViewSize: (index: number) => number;
  resizeView: ReturnType<typeof vi.fn>;
}

interface BranchProbe {
  children: unknown[];
  orientation: Orientation;
  splitview: SplitviewProbe;
}

function createSplitview(sizes: number[]): SplitviewProbe {
  const currentSizes = [...sizes];
  const calls: Array<{ index: number; size: number }> = [];
  return {
    calls,
    contentSize: sizes.reduce((sum, size) => sum + size, 0),
    distributeViewSizes: vi.fn(),
    getViewSize: (index) => currentSizes[index] ?? 0,
    resizeView: vi.fn((index: number, size: number) => {
      calls.push({ index, size });
      currentSizes[index] = size;
    }),
  };
}

function branch(
  orientation: Orientation,
  children: unknown[],
  sizes: number[]
) {
  return {
    children,
    orientation,
    splitview: createSplitview(sizes),
  } satisfies BranchProbe;
}

function leaf() {
  return {};
}

function setDockviewRoot(root: BranchProbe, maximized = false) {
  const exitMaximizedGroup = vi.fn();
  useWorkspaceStore.getState().setApi({
    component: {
      gridview: { root },
    },
    exitMaximizedGroup,
    groups: [{ id: "group-1" }, { id: "group-2" }],
    hasMaximizedGroup: vi.fn(() => maximized),
  } as never);
  return { exitMaximizedGroup };
}

function equalizeSplits() {
  const state =
    useWorkspaceStore.getState() as typeof useWorkspaceStore extends {
      getState: () => infer T;
    }
      ? T & { equalizeSplits: () => void }
      : never;
  state.equalizeSplits();
}

describe("workspace.store split equalization", () => {
  beforeEach(() => {
    useWorkspaceStore.getState().setApi(null);
  });

  it("distributes sibling split views evenly", () => {
    const root = branch(
      "HORIZONTAL",
      [leaf(), leaf(), leaf()],
      [120, 280, 500]
    );
    setDockviewRoot(root);

    equalizeSplits();

    expect(root.splitview.calls).toEqual([
      { index: 0, size: 300 },
      { index: 1, size: 300 },
      { index: 2, size: 300 },
    ]);
  });

  it("weights same-axis nested branches so repeated splits become equal columns", () => {
    const nested = branch("HORIZONTAL", [leaf(), leaf()], [220, 380]);
    const root = branch("HORIZONTAL", [nested, leaf()], [740, 160]);
    setDockviewRoot(root);

    equalizeSplits();

    expect(root.splitview.calls).toEqual([
      { index: 0, size: 600 },
      { index: 1, size: 300 },
    ]);
    expect(nested.splitview.calls).toEqual([
      { index: 0, size: 300 },
      { index: 1, size: 300 },
    ]);
  });

  it("exits maximized state before resizing split views", () => {
    const root = branch("HORIZONTAL", [leaf(), leaf()], [100, 500]);
    const { exitMaximizedGroup } = setDockviewRoot(root, true);

    equalizeSplits();

    expect(exitMaximizedGroup).toHaveBeenCalledOnce();
    expect(exitMaximizedGroup.mock.invocationCallOrder[0]).toBeLessThan(
      root.splitview.resizeView.mock.invocationCallOrder[0] ?? Number.MAX_VALUE
    );
  });
});
