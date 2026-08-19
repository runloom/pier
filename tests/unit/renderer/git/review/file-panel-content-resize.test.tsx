import { FilePanelLayout } from "@pier/ui/file/panel-layout.tsx";
import { act, cleanup, render } from "@testing-library/react";
import type {
  GroupProps,
  PanelImperativeHandle,
  PanelProps,
  SeparatorProps,
} from "react-resizable-panels";
import { afterEach, describe, expect, it, vi } from "vitest";

const resizablePanelRuntime = vi.hoisted(() => ({
  onResizeById: new Map<string, NonNullable<PanelProps["onResize"]>>(),
}));

vi.mock("react-resizable-panels", async () => {
  const React = await import("react");
  const panelHandle: PanelImperativeHandle = {
    collapse: vi.fn(),
    expand: vi.fn(),
    getSize: vi.fn(() => ({ asPercentage: 0, inPixels: 0 })),
    isCollapsed: vi.fn(() => false),
    resize: vi.fn(),
  };

  return {
    Group({ children, className, orientation }: GroupProps) {
      return (
        <div className={className} data-group="" data-orientation={orientation}>
          {children}
        </div>
      );
    },
    Panel({ children, className, id, onResize, ...props }: PanelProps) {
      const panelId = String(id);
      if (onResize) {
        resizablePanelRuntime.onResizeById.set(panelId, onResize);
      }
      return (
        <div
          aria-hidden={props["aria-hidden"]}
          className={className}
          data-panel=""
          data-testid={panelId}
        >
          {children}
        </div>
      );
    },
    Separator({ children, className, disabled, id }: SeparatorProps) {
      return (
        <div
          className={className}
          data-disabled={disabled}
          data-separator=""
          data-testid={id}
        >
          {children}
        </div>
      );
    },
    usePanelRef() {
      return React.useRef<PanelImperativeHandle>(panelHandle);
    },
  };
});

afterEach(() => {
  cleanup();
  resizablePanelRuntime.onResizeById.clear();
});

function renderFilePanelLayout(
  onContentResize?: (widthPx: number) => void
): void {
  render(
    <FilePanelLayout
      contentPanelId="git-review-diff"
      header={<div>header</div>}
      {...(onContentResize === undefined ? {} : { onContentResize })}
      onSidebarAutoCollapse={vi.fn()}
      sidebar={<aside>files</aside>}
      sidebarPanelId="git-review-tree"
      sidebarWidthStorageKey="test.git-review.tree-width"
    >
      <main>diff</main>
    </FilePanelLayout>
  );
}

describe("FilePanelLayout content resize", () => {
  it("reports the real content panel width in pixels", () => {
    const onContentResize = vi.fn();
    renderFilePanelLayout(onContentResize);

    const resizeContent =
      resizablePanelRuntime.onResizeById.get("git-review-diff");
    expect(resizeContent).toBeTypeOf("function");
    act(() => {
      resizeContent?.(
        { asPercentage: 64, inPixels: 899 },
        "git-review-diff",
        undefined
      );
    });

    expect(onContentResize).toHaveBeenCalledOnce();
    expect(onContentResize).toHaveBeenCalledWith(899);
  });

  it("allows the content resize callback to be omitted", () => {
    renderFilePanelLayout();

    const resizeContent =
      resizablePanelRuntime.onResizeById.get("git-review-diff");
    expect(resizeContent).toBeTypeOf("function");
    expect(() => {
      resizeContent?.(
        { asPercentage: 64, inPixels: 899 },
        "git-review-diff",
        undefined
      );
    }).not.toThrow();
  });
});
