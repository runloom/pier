import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useContextMenu } from "@/lib/context-menu/use-context-menu.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

const buildMenuEntriesMock = vi.hoisted(() =>
  vi.fn(() => [{ id: "panel.close", label: "Close", type: "action" }])
);

vi.mock("@/lib/context-menu/build-entries.ts", () => ({
  buildMenuEntries: buildMenuEntriesMock,
}));

vi.mock("@/lib/actions/registry.ts", () => ({
  actionRegistry: {
    get: vi.fn(() => null),
  },
}));

function ContextMenuTarget() {
  const onContextMenu = useContextMenu("dockview-tab");
  return (
    <button onContextMenu={onContextMenu} type="button">
      tab
    </button>
  );
}

describe("useContextMenu", () => {
  beforeEach(() => {
    buildMenuEntriesMock.mockClear();
    useZoomStore.setState({ windowZoomLevel: 0 });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        menu: {
          popup: vi.fn(async () => ({ actionId: null })),
        },
      },
    });
  });

  it("converts React client coordinates to BrowserWindow coordinates under page zoom", async () => {
    useZoomStore.setState({ windowZoomLevel: 2 });
    const { getByRole } = render(<ContextMenuTarget />);

    fireEvent.contextMenu(getByRole("button"), {
      clientX: 10,
      clientY: 20,
    });

    await waitFor(() => {
      expect(window.pier.menu.popup).toHaveBeenCalledWith(
        [{ id: "panel.close", label: "Close", type: "action" }],
        { x: 14.4, y: 28.8 }
      );
    });
  });
});
