import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PANEL_LAYOUT_ACTION_CONTRIBUTIONS } from "@/lib/actions/panel-layout-contributions.ts";
import { focusedTabPanelId } from "@/lib/workspace/focused-tab.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const closeActiveContribution = PANEL_LAYOUT_ACTION_CONTRIBUTIONS.find(
  (contribution) => contribution.id === "pier.panel.closeActive"
);

if (!closeActiveContribution) {
  throw new Error("pier.panel.closeActive contribution is missing");
}

function mountTab(panelId: string): {
  group: HTMLElement;
  inner: HTMLElement;
  outer: HTMLElement;
} {
  const group = document.createElement("div");
  group.className = "dv-groupview dv-active-group";
  const header = document.createElement("div");
  header.className = "dv-tabs-and-actions-container";
  const tabs = document.createElement("div");
  tabs.className = "dv-tabs-container";
  const outer = document.createElement("div");
  outer.className = "dv-tab";
  const inner = document.createElement("div");
  inner.setAttribute("data-panel-tab-id", panelId);
  inner.tabIndex = 0;
  outer.append(inner);
  tabs.append(outer);
  header.append(tabs);
  group.append(header);
  document.body.append(group);
  return { group, inner, outer };
}

describe("focused tab close target", () => {
  const originalCloseActivePanel =
    useWorkspaceStore.getState().closeActivePanel;
  const originalClosePanel = useWorkspaceStore.getState().closePanel;

  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    useWorkspaceStore.setState({
      api: null,
      closeActivePanel: originalCloseActivePanel,
      closePanel: originalClosePanel,
    } as never);
  });

  it("resolves the panel id from the focused inner tab", () => {
    const { inner } = mountTab("focused-1");
    inner.focus();

    expect(focusedTabPanelId()).toBe("focused-1");
  });

  it("resolves the panel id when dockview's outer tab holds focus", () => {
    const { outer } = mountTab("focused-2");
    outer.tabIndex = 0;
    outer.focus();

    expect(focusedTabPanelId()).toBe("focused-2");
  });

  it("ignores focus outside the tab strip", () => {
    mountTab("focused-3");
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    expect(focusedTabPanelId()).toBeNull();
  });

  it("ignores stale tab focus while a native terminal owns the keyboard", () => {
    const { inner } = mountTab("focused-4");
    inner.focus();
    vi.mocked(document.hasFocus).mockReturnValue(false);

    expect(focusedTabPanelId()).toBeNull();
  });

  it("closes the focused inactive tab instead of the active one", async () => {
    const closePanel = vi.fn(async () => true);
    const closeActivePanel = vi.fn(async () => true);
    useWorkspaceStore.setState({
      api: { activePanel: { id: "active-1" } },
      closeActivePanel,
      closePanel,
    } as never);
    const { inner } = mountTab("focused-5");
    inner.focus();

    await closeActiveContribution.handler();

    expect(closePanel).toHaveBeenCalledWith("focused-5");
    expect(closeActivePanel).not.toHaveBeenCalled();
  });

  it("falls back to the active panel when content has focus", async () => {
    const closePanel = vi.fn(async () => true);
    const closeActivePanel = vi.fn(async () => true);
    useWorkspaceStore.setState({
      api: { activePanel: { id: "active-2" } },
      closeActivePanel,
      closePanel,
    } as never);
    mountTab("focused-6");
    const content = document.createElement("div");
    content.tabIndex = -1;
    document.body.append(content);
    content.focus();

    await closeActiveContribution.handler();

    expect(closeActivePanel).toHaveBeenCalledOnce();
    expect(closePanel).not.toHaveBeenCalled();
  });
});
