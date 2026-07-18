import { FolderTree, Search } from "lucide-react";
import { type ReactNode, useLayoutEffect } from "react";
import { usePanelRef } from "react-resizable-panels";
import { Button } from "./button.tsx";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./resizable.tsx";
import { cn } from "./utils.ts";

export { FilePanelBreadcrumb } from "./file-panel-breadcrumb.tsx";

export const FILE_PANEL_DEFAULT_SIDEBAR_WIDTH_PX = 256;
export const FILE_PANEL_MIN_SIDEBAR_WIDTH_PX = 170;

function readSidebarWidth(
  storageKey: string,
  defaultWidth: number,
  minWidth: number
): number {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey);
    const parsed = raw == null ? Number.NaN : Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= minWidth) {
      return parsed;
    }
  } catch {
    // localStorage 不可用时保持默认宽度。
  }
  return defaultWidth;
}

function writeSidebarWidth(storageKey: string, width: number): void {
  try {
    globalThis.localStorage?.setItem(storageKey, String(Math.round(width)));
  } catch {
    // 偏好持久化失败不影响面板使用。
  }
}

/** Files 与只读文件浏览类面板共用的稳定结构：顶部栏横跨侧栏和正文。 */
export function FilePanelLayout({
  children,
  contentPanelId,
  defaultSidebarWidth = FILE_PANEL_DEFAULT_SIDEBAR_WIDTH_PX,
  header,
  minSidebarWidth = FILE_PANEL_MIN_SIDEBAR_WIDTH_PX,
  onSidebarAutoCollapse,
  sidebar,
  sidebarPanelId,
  sidebarWidthStorageKey,
}: {
  children: ReactNode;
  contentPanelId: string;
  defaultSidebarWidth?: number;
  header: ReactNode;
  minSidebarWidth?: number;
  onSidebarAutoCollapse: () => void;
  sidebar: ReactNode;
  sidebarPanelId: string;
  sidebarWidthStorageKey: string;
}) {
  const sidebarPanelRef = usePanelRef();
  const sidebarVisible = sidebar != null;
  useLayoutEffect(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) {
      return;
    }
    if (sidebarVisible) {
      const restoredWidth = readSidebarWidth(
        sidebarWidthStorageKey,
        defaultSidebarWidth,
        minSidebarWidth
      );
      panel.expand();
      const animationFrame = globalThis.requestAnimationFrame(() => {
        sidebarPanelRef.current?.resize(`${restoredWidth}px`);
      });
      return () => {
        globalThis.cancelAnimationFrame(animationFrame);
      };
    }
    panel.collapse();
  }, [
    defaultSidebarWidth,
    minSidebarWidth,
    sidebarPanelRef,
    sidebarVisible,
    sidebarWidthStorageKey,
  ]);

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      data-slot="file-panel-layout"
    >
      {header}
      <ResizablePanelGroup className="min-h-0 flex-1" orientation="horizontal">
        <ResizablePanel
          aria-hidden={!sidebarVisible}
          className="min-h-0"
          collapsedSize="0px"
          collapsible
          defaultSize={String(
            readSidebarWidth(
              sidebarWidthStorageKey,
              defaultSidebarWidth,
              minSidebarWidth
            )
          ).concat("px")}
          groupResizeBehavior="preserve-pixel-size"
          id={sidebarPanelId}
          maxSize="50%"
          minSize={String(minSidebarWidth).concat("px")}
          onResize={(panelSize, _id, previousPanelSize) => {
            if (panelSize.inPixels >= minSidebarWidth) {
              writeSidebarWidth(sidebarWidthStorageKey, panelSize.inPixels);
            } else if (
              sidebarVisible &&
              previousPanelSize !== undefined &&
              sidebarPanelRef.current?.isCollapsed() === true
            ) {
              onSidebarAutoCollapse();
            }
          }}
          panelRef={sidebarPanelRef}
        >
          {sidebar}
        </ResizablePanel>
        <ResizableHandle
          className={cn(
            "data-[resize-handle-state=drag]:bg-primary data-[resize-handle-state=hover]:bg-primary/60",
            !sidebarVisible && "hidden"
          )}
          disabled={!sidebarVisible}
        />
        <ResizablePanel
          className="min-h-0"
          id={contentPanelId}
          key={contentPanelId}
        >
          <section className="flex h-full min-w-0 flex-col">{children}</section>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

export function FilePanelHeader({
  center,
  leading,
  trailing,
}: {
  center: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <header
      className="flex h-10 shrink-0 items-center gap-2 border-border border-b bg-background px-2"
      data-slot="file-panel-header"
    >
      {leading ? (
        <div className="flex shrink-0 items-center">{leading}</div>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center overflow-hidden">
        {center}
      </div>
      {trailing ? (
        <div className="flex shrink-0 items-center gap-1">{trailing}</div>
      ) : null}
    </header>
  );
}

export function FilePanelSidebarToggleButton({
  collapseLabel,
  collapsed,
  expandLabel,
  hidden = false,
  onToggle,
}: {
  collapseLabel: string;
  collapsed: boolean;
  expandLabel: string;
  hidden?: boolean;
  onToggle: () => void;
}) {
  if (hidden) {
    return null;
  }
  const label = collapsed ? expandLabel : collapseLabel;
  return (
    <Button
      aria-expanded={!collapsed}
      aria-label={label}
      onClick={onToggle}
      size="xs"
      type="button"
      variant="ghost"
    >
      <FolderTree aria-hidden="true" data-icon="inline-start" />
      <span className="sr-only">{label}</span>
    </Button>
  );
}

export function FilePanelSearchButton({
  disabled = false,
  label,
  onOpenSearch,
}: {
  disabled?: boolean;
  label: string;
  onOpenSearch: () => void;
}) {
  return (
    <Button
      aria-label={label}
      disabled={disabled}
      onClick={onOpenSearch}
      size="xs"
      type="button"
      variant="ghost"
    >
      <Search aria-hidden="true" data-icon="inline-start" />
      <span className="sr-only">{label}</span>
    </Button>
  );
}
