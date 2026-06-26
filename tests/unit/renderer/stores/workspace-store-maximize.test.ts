import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function panel(maximized: boolean) {
  return {
    api: {
      exitMaximized: vi.fn(),
      isMaximized: vi.fn(() => maximized),
      maximize: vi.fn(),
      setActive: vi.fn(),
    },
    id: "terminal-1",
    title: "Terminal",
    view: { contentComponent: "terminal" },
  };
}

function setApi(activePanel: ReturnType<typeof panel> | null) {
  useWorkspaceStore.getState().setApi({
    activePanel,
  } as never);
}

function toggleActivePanelMaximized() {
  const state =
    useWorkspaceStore.getState() as typeof useWorkspaceStore extends {
      getState: () => infer T;
    }
      ? T & { toggleActivePanelMaximized: () => void }
      : never;
  state.toggleActivePanelMaximized();
}

describe("workspace.store panel maximize", () => {
  beforeEach(() => {
    useWorkspaceStore.getState().setApi(null);
  });

  it("maximizes the active panel group when it is not maximized", () => {
    const activePanel = panel(false);
    setApi(activePanel);

    toggleActivePanelMaximized();

    expect(activePanel.api.maximize).toHaveBeenCalledOnce();
    expect(activePanel.api.exitMaximized).not.toHaveBeenCalled();
  });

  it("exits maximized state when the active panel group is already maximized", () => {
    const activePanel = panel(true);
    setApi(activePanel);

    toggleActivePanelMaximized();

    expect(activePanel.api.exitMaximized).toHaveBeenCalledOnce();
    expect(activePanel.api.maximize).not.toHaveBeenCalled();
  });

  it("does nothing when there is no active panel", () => {
    setApi(null);

    expect(() => toggleActivePanelMaximized()).not.toThrow();
  });
});
