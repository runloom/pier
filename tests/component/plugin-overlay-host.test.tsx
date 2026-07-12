import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PluginOverlayHost } from "@/components/common/plugin-overlay-host.tsx";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import {
  closeOverlaysForPlugin,
  openPluginOverlay,
  usePluginOverlayStore,
} from "@/stores/plugin-overlay.store.ts";

afterEach(() => {
  act(() => {
    closeOverlaysForPlugin("pier.git");
    closeOverlaysForPlugin("pier.other");
  });
  cleanup();
});

describe("PluginOverlayHost", () => {
  it("open 渲染内容并压入 blocking scope,close 清理", () => {
    render(<PluginOverlayHost />);
    act(() => {
      openPluginOverlay("pier.git", {
        id: "demo",
        render: ({ close, open }) => (
          <div data-open={open} data-testid="overlay-presentation">
            <button onClick={close} type="button">
              overlay-content
            </button>
          </div>
        ),
      });
    });
    expect(screen.getByText("overlay-content")).toBeInTheDocument();
    expect(
      useKeybindingScope
        .getState()
        .overlayStack.includes("overlay:plugin:pier.git:demo")
    ).toBe(true);

    act(() => {
      screen.getByText("overlay-content").click();
    });
    expect(screen.getByTestId("overlay-presentation")).toHaveAttribute(
      "data-open",
      "false"
    );
    expect(
      useKeybindingScope
        .getState()
        .overlayStack.includes("overlay:plugin:pier.git:demo")
    ).toBe(false);
  });

  it("新 open 顶替旧 overlay(单例语义)", () => {
    render(<PluginOverlayHost />);
    act(() => {
      openPluginOverlay("pier.git", {
        id: "a",
        render: ({ open }) => <p data-open={open}>first</p>,
      });
    });
    act(() => {
      openPluginOverlay("pier.other", {
        id: "b",
        render: ({ open }) => <p data-open={open}>second</p>,
      });
    });
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    const overlayStack = useKeybindingScope.getState().overlayStack;
    expect(overlayStack.includes("overlay:plugin:pier.git:a")).toBe(false);
    expect(overlayStack.includes("overlay:plugin:pier.other:b")).toBe(true);
  });

  it("closeOverlaysForPlugin 只清理该插件的 overlay", () => {
    render(<PluginOverlayHost />);
    act(() => {
      openPluginOverlay("pier.git", {
        id: "a",
        render: ({ open }) => <p data-open={open}>mine</p>,
      });
    });
    act(() => {
      closeOverlaysForPlugin("pier.other");
    });
    expect(screen.getByText("mine")).toBeInTheDocument();
    act(() => {
      closeOverlaysForPlugin("pier.git");
    });
    expect(screen.getByText("mine")).toHaveAttribute("data-open", "false");
    expect(usePluginOverlayStore.getState().current).toBeNull();
  });
});
