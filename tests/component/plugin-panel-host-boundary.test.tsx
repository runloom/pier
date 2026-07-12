import type { PluginPanelRegistration } from "@plugins/api/renderer.ts";
import { render, waitFor } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { FileText } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withPluginPanelHostBoundary } from "@/components/workspace/panel-resource-boundary.tsx";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";

describe("plugin panel host boundary", () => {
  afterEach(() => {
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
  });

  it("rebuilds plugin tab chrome from restored panel params", async () => {
    const registration: PluginPanelRegistration = {
      component: () => null,
      icon: FileText,
      id: "pier.test.panel",
      kind: "web",
      resolveTab: ({ params }) => ({
        icon: { id: `pier.file:${String(params.fileName)}` },
      }),
      title: "File",
    };
    const Panel = withPluginPanelHostBoundary(registration);
    const setTitle = vi.fn();
    const props = {
      api: { id: "file-1", setTitle, title: "file.ts" },
      containerApi: {},
      params: { fileName: "file.ts" },
    } as unknown as IDockviewPanelProps;

    const view = render(<Panel {...props} />);

    await waitFor(() =>
      expect(usePanelDescriptorStore.getState().descriptors["file-1"]).toEqual({
        display: { short: "file.ts" },
        tab: { icon: { id: "pier.file:file.ts" } },
      })
    );
    expect(setTitle).toHaveBeenCalledWith("file.ts");

    view.unmount();
    expect(
      usePanelDescriptorStore.getState().descriptors["file-1"]
    ).toBeUndefined();
  });
});
