import { FilePanelLayout } from "@pier/ui/file/panel-layout.tsx";
import {
  FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY,
  resetFilePanelSidebarWidthListenersForTests,
} from "@pier/ui/file/panel-sidebar-width.ts";
import { act, cleanup, render } from "@testing-library/react";
import type {
  GroupProps,
  LayoutChangedMeta,
  PanelImperativeHandle,
  PanelProps,
  SeparatorProps,
} from "react-resizable-panels";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resizablePanelRuntime = vi.hoisted(() => ({
  groupElements: [] as HTMLDivElement[],
  handles: [] as PanelImperativeHandle[],
  hostWidths: [800, 800],
  onLayoutChanged: [] as NonNullable<GroupProps["onLayoutChanged"]>[],
  onResizeById: new Map<string, NonNullable<PanelProps["onResize"]>>(),
  resizeObserverCallbacks: [] as Array<() => void>,
}));

vi.mock("react-resizable-panels", async () => {
  const React = await import("react");

  function createHandle(): PanelImperativeHandle {
    let inPixels = 256;
    return {
      collapse: vi.fn(),
      expand: vi.fn(),
      getSize: vi.fn(() => ({ asPercentage: 0, inPixels })),
      isCollapsed: vi.fn(() => false),
      resize: vi.fn((size: number | string) => {
        if (typeof size === "string" && size.endsWith("px")) {
          const parsed = Number.parseInt(size, 10);
          if (Number.isFinite(parsed)) {
            inPixels = parsed;
          }
        }
      }),
    };
  }

  return {
    Group({
      children,
      className,
      elementRef,
      onLayoutChanged,
      orientation,
    }: GroupProps) {
      if (onLayoutChanged) {
        resizablePanelRuntime.onLayoutChanged.push(onLayoutChanged);
      }
      return (
        <div
          className={className}
          data-group=""
          data-orientation={orientation}
          ref={(node) => {
            if (typeof elementRef === "function") {
              elementRef(node);
            } else if (elementRef) {
              elementRef.current = node;
            }
            if (node) {
              resizablePanelRuntime.groupElements.push(node);
            }
          }}
        >
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
      const handle = React.useMemo(() => {
        const created = createHandle();
        resizablePanelRuntime.handles.push(created);
        return created;
      }, []);
      return React.useRef<PanelImperativeHandle>(handle);
    },
  };
});

const USER_LAYOUT_META: LayoutChangedMeta = { isUserInteraction: true };
const PROGRAMMATIC_LAYOUT_META: LayoutChangedMeta = {
  isUserInteraction: false,
};

afterEach(() => {
  cleanup();
  resizablePanelRuntime.groupElements.length = 0;
  resizablePanelRuntime.handles.length = 0;
  resizablePanelRuntime.hostWidths = [800, 800];
  resizablePanelRuntime.onLayoutChanged.length = 0;
  resizablePanelRuntime.onResizeById.clear();
  resizablePanelRuntime.resizeObserverCallbacks.length = 0;
  resetFilePanelSidebarWidthListenersForTests();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  resizablePanelRuntime.hostWidths = [800, 800];
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function clientWidth(this: HTMLElement) {
      const index = resizablePanelRuntime.groupElements.indexOf(
        this as HTMLDivElement
      );
      if (index >= 0) {
        return resizablePanelRuntime.hostWidths[index] ?? 0;
      }
      return 0;
    }
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizablePanelRuntime.resizeObserverCallbacks.push(() => {
          callback(
            [] as ResizeObserverEntry[],
            this as unknown as ResizeObserver
          );
        });
      }
      disconnect(): void {}
      observe(): void {}
      unobserve(): void {}
    }
  );
});

function renderSharedTrees(): void {
  render(
    <>
      <FilePanelLayout
        contentPanelId="files-content"
        header={<div>files-header</div>}
        onSidebarAutoCollapse={vi.fn()}
        sidebar={<aside>files-tree</aside>}
        sidebarPanelId="files-tree"
      >
        <main>files</main>
      </FilePanelLayout>
      <FilePanelLayout
        contentPanelId="git-review-diff"
        header={<div>git-header</div>}
        onSidebarAutoCollapse={vi.fn()}
        sidebar={<aside>git-tree</aside>}
        sidebarPanelId="git-review-tree"
      >
        <main>diff</main>
      </FilePanelLayout>
    </>
  );
}

function persistFilesUserWidth(widthPx: number): void {
  const filesHandle = resizablePanelRuntime.handles[0];
  const filesLayoutChanged = resizablePanelRuntime.onLayoutChanged[0];
  act(() => {
    filesHandle?.resize(`${widthPx}px`);
    filesLayoutChanged?.(
      { "files-tree": 40, "files-content": 60 },
      USER_LAYOUT_META
    );
  });
}

describe("FilePanelLayout shared tree width", () => {
  it("persists a user drag and resizes a laid-out sibling tree", () => {
    renderSharedTrees();
    persistFilesUserWidth(320);

    expect(localStorage.getItem(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY)).toBe(
      "320"
    );
    expect(resizablePanelRuntime.handles[1]?.resize).toHaveBeenCalledWith(
      "320px"
    );
  });

  it("does not persist constraint or hidden-tab resizes", () => {
    localStorage.setItem(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, "220");
    renderSharedTrees();

    const gitResize = resizablePanelRuntime.onResizeById.get("git-review-tree");
    const gitLayoutChanged = resizablePanelRuntime.onLayoutChanged[1];
    act(() => {
      gitResize?.({ asPercentage: 50, inPixels: 400 }, "git-review-tree", {
        asPercentage: 28,
        inPixels: 220,
      });
      gitLayoutChanged?.(
        { "git-review-tree": 50, "git-review-diff": 50 },
        PROGRAMMATIC_LAYOUT_META
      );
    });

    expect(localStorage.getItem(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY)).toBe(
      "220"
    );
  });

  it("does not resize a sibling whose host is not laid out", () => {
    resizablePanelRuntime.hostWidths = [800, 0];
    renderSharedTrees();
    persistFilesUserWidth(320);

    expect(localStorage.getItem(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY)).toBe(
      "320"
    );
    expect(resizablePanelRuntime.handles[1]?.resize).not.toHaveBeenCalled();
  });

  it("applies the stored width when a hidden host becomes laid out", () => {
    localStorage.setItem(FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY, "320");
    resizablePanelRuntime.hostWidths = [800, 0];
    renderSharedTrees();
    const gitHandle = resizablePanelRuntime.handles[1];
    expect(gitHandle?.resize).not.toHaveBeenCalled();

    resizablePanelRuntime.hostWidths = [800, 800];
    act(() => {
      for (const notify of resizablePanelRuntime.resizeObserverCallbacks) {
        notify();
      }
    });

    expect(gitHandle?.resize).toHaveBeenCalledWith("320px");
  });
});
