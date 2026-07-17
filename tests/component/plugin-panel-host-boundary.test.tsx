import type { PluginPanelRegistration } from "@plugins/api/renderer.ts";
import { act, render, waitFor } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { FileText } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  withPanelResourceBoundary,
  withPluginPanelHostBoundary,
} from "@/components/workspace/panel-resource-boundary.tsx";
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
      api: {
        id: "file-1",
        isVisible: true,
        onDidVisibilityChange: vi.fn(() => ({ dispose: vi.fn() })),
        setTitle,
        title: "file.ts",
      },
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

  it("keeps a panel rendered when focus moves to another Dockview group", () => {
    let active = true;
    let visible = true;
    let visibilityListener: (() => void) | undefined;
    const disposeVisibilitySubscription = vi.fn();
    const effectStarted = vi.fn();
    const effectStopped = vi.fn();
    const onDidActiveChange = vi.fn(() => ({ dispose: vi.fn() }));
    function StatefulReviewPanel() {
      const [instance] = useState("preserved");
      useEffect(() => {
        effectStarted(instance);
        return () => effectStopped(instance);
      }, [instance]);
      return <output data-instance={instance} data-testid="review-panel" />;
    }
    const registration: PluginPanelRegistration = {
      component: StatefulReviewPanel,
      icon: FileText,
      id: "pier.test.review",
      kind: "web",
      title: "Review",
    };
    const Panel = withPluginPanelHostBoundary(registration);
    const props = {
      api: {
        get isActive() {
          return active;
        },
        get isVisible() {
          return visible;
        },
        id: "review-1",
        onDidActiveChange,
        onDidVisibilityChange: (listener: () => void) => {
          visibilityListener = listener;
          return { dispose: disposeVisibilitySubscription };
        },
        setTitle: vi.fn(),
        title: "Review",
      },
      containerApi: {},
      params: {},
    } as unknown as IDockviewPanelProps;
    const view = render(<Panel {...props} />);

    expect(view.getByTestId("review-panel")).toBeVisible();
    expect(effectStarted).toHaveBeenCalledTimes(1);
    active = false;
    expect(view.getByTestId("review-panel")).toBeVisible();
    expect(onDidActiveChange).not.toHaveBeenCalled();
    expect(effectStopped).not.toHaveBeenCalled();

    act(() => {
      visible = false;
      visibilityListener?.();
    });
    expect(view.getByTestId("review-panel")).not.toBeVisible();
    expect(effectStopped).toHaveBeenCalledTimes(1);

    act(() => {
      visible = true;
      visibilityListener?.();
    });
    expect(view.getByTestId("review-panel")).toBeVisible();
    expect(view.getByTestId("review-panel")).toHaveAttribute(
      "data-instance",
      "preserved"
    );
    expect(effectStarted).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(effectStopped).toHaveBeenCalledTimes(2);
    expect(disposeVisibilitySubscription).toHaveBeenCalledTimes(1);
  });

  it("restores a core panel that is initially hidden in a saved layout", () => {
    let visible = false;
    let visibilityListener: (() => void) | undefined;
    const effectStarted = vi.fn();
    function CorePanel() {
      useEffect(() => {
        effectStarted();
      }, []);
      return <output data-testid="core-panel" />;
    }
    const Panel = withPanelResourceBoundary(CorePanel);
    const props = {
      api: {
        get isVisible() {
          return visible;
        },
        id: "core-1",
        onDidVisibilityChange: (listener: () => void) => {
          visibilityListener = listener;
          return { dispose: vi.fn() };
        },
      },
      containerApi: {},
      params: {},
    } as unknown as IDockviewPanelProps;
    const view = render(<Panel {...props} />);

    expect(view.getByTestId("core-panel")).not.toBeVisible();
    expect(effectStarted).not.toHaveBeenCalled();
    act(() => {
      visible = true;
      visibilityListener?.();
    });
    expect(view.getByTestId("core-panel")).toBeVisible();
    expect(effectStarted).toHaveBeenCalledTimes(1);
  });

  it("rechecks visibility after attaching the Dockview subscription", async () => {
    let visible = false;
    const Panel = withPanelResourceBoundary(() => (
      <output data-testid="subscription-panel" />
    ));
    const props = {
      api: {
        get isVisible() {
          return visible;
        },
        id: "subscription-1",
        onDidVisibilityChange: vi.fn(() => {
          visible = true;
          return { dispose: vi.fn() };
        }),
      },
      containerApi: {},
      params: {},
    } as unknown as IDockviewPanelProps;

    const view = render(<Panel {...props} />);

    await waitFor(() =>
      expect(view.getByTestId("subscription-panel")).toBeVisible()
    );
  });

  it("lets unmountWhenHidden panels stay mounted so they can own hide/close lifecycle", () => {
    let active = true;
    let visible = false;
    let visibilityListener: (() => void) | undefined;
    const registration: PluginPanelRegistration = {
      component: (props) => {
        const isVisible = useSyncExternalStore(
          (onStoreChange) => {
            const disposable = props.api.onDidVisibilityChange(onStoreChange);
            return () => disposable.dispose();
          },
          () => props.api.isVisible,
          () => false
        );
        return isVisible ? <output data-testid="heavy-panel" /> : null;
      },
      icon: FileText,
      id: "pier.test.heavy",
      kind: "web",
      resourcePolicy: "unmountWhenHidden",
      title: "Heavy",
    };
    const Panel = withPluginPanelHostBoundary(registration);
    const props = {
      api: {
        get isActive() {
          return active;
        },
        get isVisible() {
          return visible;
        },
        id: "heavy-1",
        onDidActiveChange: vi.fn(() => ({ dispose: vi.fn() })),
        onDidVisibilityChange: (listener: () => void) => {
          visibilityListener = listener;
          return { dispose: vi.fn() };
        },
        setTitle: vi.fn(),
        title: "Heavy",
      },
      containerApi: {},
      params: {},
    } as unknown as IDockviewPanelProps;
    const view = render(<Panel {...props} />);

    // host 不再代卸载：panel 自己按 isVisible 决定 body。
    expect(view.queryByTestId("heavy-panel")).not.toBeInTheDocument();
    active = false;
    expect(view.queryByTestId("heavy-panel")).not.toBeInTheDocument();

    act(() => {
      visible = true;
      visibilityListener?.();
    });
    expect(view.getByTestId("heavy-panel")).toBeInTheDocument();

    act(() => {
      active = true;
      visible = false;
      visibilityListener?.();
    });
    expect(view.queryByTestId("heavy-panel")).not.toBeInTheDocument();

    act(() => {
      visible = true;
      visibilityListener?.();
    });
    expect(view.getByTestId("heavy-panel")).toBeInTheDocument();
  });
});
