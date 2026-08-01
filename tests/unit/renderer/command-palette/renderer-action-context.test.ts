import { beforeEach, describe, expect, it, vi } from "vitest";
import { rendererActionContext } from "@/lib/actions/renderer-action-runtime.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

describe("rendererActionContext", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ api: null });
  });

  it("counts panels in the source panel group, not the active group", () => {
    const active = {
      api: { setActive: vi.fn() },
      id: "terminal-active",
      view: { contentComponent: "terminal" },
    };
    const sourceA = {
      api: { setActive: vi.fn() },
      id: "file-a",
      view: { contentComponent: "pier.files.filePanel" },
    };
    const sourceB = {
      api: { setActive: vi.fn() },
      id: "file-b",
      view: { contentComponent: "pier.files.filePanel" },
    };
    useWorkspaceStore.setState({
      api: {
        activeGroup: { panels: [active] },
        activePanel: active,
        groups: [{ panels: [active] }, { panels: [sourceA, sourceB] }],
        panels: [active, sourceA, sourceB],
      } as never,
    });

    const context = rendererActionContext({
      sourcePanelId: "file-a",
      surface: "dockview-tab",
    });

    expect(context.workspace.activeGroupPanelCount).toBe(2);
    expect(context.workspace.hasActivePanel).toBe(true);
  });
});
