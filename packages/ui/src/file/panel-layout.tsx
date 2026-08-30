import { FolderTree, Search } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { usePanelRef } from "react-resizable-panels";
import { Button } from "../button.tsx";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../resizable.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip.tsx";
import { cn } from "../utils.ts";
import {
  FILE_PANEL_DEFAULT_SIDEBAR_WIDTH_PX,
  FILE_PANEL_MIN_SIDEBAR_WIDTH_PX,
  FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY,
  persistMigratedSidebarWidth,
  readSidebarWidth,
  subscribeSidebarWidth,
  writeSidebarWidth,
} from "./panel-sidebar-width.ts";

export { FilePanelBreadcrumb } from "./panel-breadcrumb.tsx";
export {
  FILE_PANEL_DEFAULT_SIDEBAR_WIDTH_PX,
  FILE_PANEL_MIN_SIDEBAR_WIDTH_PX,
  FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY,
} from "./panel-sidebar-width.ts";

const MAC_PLATFORM_RE = /Mac|iPhone|iPad/i;

/**
 * Default display label for Mod+KeyB (tree sidebar toggle).
 * Matches DEFAULT_KEYMAP; does not read user remaps (plugin boundary).
 */
export function filePanelTreeToggleShortcutLabel(): string {
  if (typeof navigator === "undefined") {
    return "Ctrl+B";
  }
  return MAC_PLATFORM_RE.test(navigator.platform) ? "⌘B" : "Ctrl+B";
}

/** Files 与只读文件浏览类面板共用的稳定结构：顶部栏横跨侧栏和正文。 */
export function FilePanelLayout({
  children,
  contentPanelId,
  defaultSidebarWidth = FILE_PANEL_DEFAULT_SIDEBAR_WIDTH_PX,
  header,
  minSidebarWidth = FILE_PANEL_MIN_SIDEBAR_WIDTH_PX,
  onContentResize,
  onSidebarAutoCollapse,
  sidebar,
  sidebarPanelId,
  sidebarWidthStorageKey = FILE_PANEL_SIDEBAR_WIDTH_STORAGE_KEY,
}: {
  children: ReactNode;
  contentPanelId: string;
  defaultSidebarWidth?: number;
  header: ReactNode;
  minSidebarWidth?: number;
  onContentResize?: (widthPx: number) => void;
  onSidebarAutoCollapse: () => void;
  sidebar: ReactNode;
  sidebarPanelId: string;
  sidebarWidthStorageKey?: string;
}) {
  const sidebarPanelRef = usePanelRef();
  const groupElementRef = useRef<HTMLDivElement | null>(null);
  const applyingPreferenceRef = useRef(false);
  const sidebarVisible = sidebar != null;
  useLayoutEffect(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) {
      return;
    }

    const hostWidthPx = (): number => groupElementRef.current?.clientWidth ?? 0;

    const applyPreferenceWidth = (widthPx: number): void => {
      // 未选中 dockview tab 是 display:none，组宽为 0；此时灌像素会被夹成 50%，切回后树突然变宽。
      if (widthPx < minSidebarWidth || hostWidthPx() <= 0) {
        return;
      }
      const current = sidebarPanelRef.current;
      if (!current || current.isCollapsed()) {
        return;
      }
      try {
        if (Math.round(current.getSize().inPixels) === widthPx) {
          return;
        }
      } catch {
        // 尚未完成布局时仍尝试灌入目标宽度。
      }
      applyingPreferenceRef.current = true;
      try {
        current.resize(`${widthPx}px`);
      } finally {
        applyingPreferenceRef.current = false;
      }
    };

    const unsubscribe = subscribeSidebarWidth(
      sidebarWidthStorageKey,
      applyPreferenceWidth
    );

    const groupElement = groupElementRef.current;
    let lastHostWidth = groupElement?.clientWidth ?? 0;
    let observer: ResizeObserver | undefined;
    if (groupElement && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        const width = groupElement.clientWidth;
        const becameLaidOut = lastHostWidth <= 0 && width > 0;
        lastHostWidth = width;
        if (!(becameLaidOut && sidebarVisible)) {
          return;
        }
        applyPreferenceWidth(
          readSidebarWidth(
            sidebarWidthStorageKey,
            defaultSidebarWidth,
            minSidebarWidth
          )
        );
      });
      observer.observe(groupElement);
    }

    if (!sidebarVisible) {
      panel.collapse();
      return () => {
        unsubscribe();
        observer?.disconnect();
      };
    }

    persistMigratedSidebarWidth(sidebarWidthStorageKey, minSidebarWidth);
    panel.expand();
    const animationFrame = globalThis.requestAnimationFrame(() => {
      applyPreferenceWidth(
        readSidebarWidth(
          sidebarWidthStorageKey,
          defaultSidebarWidth,
          minSidebarWidth
        )
      );
    });
    return () => {
      globalThis.cancelAnimationFrame(animationFrame);
      unsubscribe();
      observer?.disconnect();
    };
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
      <ResizablePanelGroup
        className="min-h-0 flex-1"
        elementRef={groupElementRef}
        onLayoutChanged={(_layout, meta) => {
          if (!(meta.isUserInteraction && sidebarVisible)) {
            return;
          }
          if ((groupElementRef.current?.clientWidth ?? 0) <= 0) {
            return;
          }
          const size = sidebarPanelRef.current?.getSize();
          if (size !== undefined && size.inPixels >= minSidebarWidth) {
            writeSidebarWidth(sidebarWidthStorageKey, size.inPixels);
          }
        }}
        orientation="horizontal"
      >
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
            if (applyingPreferenceRef.current) {
              return;
            }
            if (
              sidebarVisible &&
              panelSize.inPixels < minSidebarWidth &&
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
          onResize={(panelSize) => {
            onContentResize?.(panelSize.inPixels);
          }}
        >
          <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            {children}
          </section>
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
        <div className="flex min-w-0 items-center">{leading}</div>
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
  /** User-visible shortcut (e.g. ⌘B), shown like panel maximize tooltip. */
  shortcut,
}: {
  collapseLabel: string;
  collapsed: boolean;
  expandLabel: string;
  hidden?: boolean;
  onToggle: () => void;
  shortcut?: string | undefined;
}) {
  if (hidden) {
    return null;
  }
  const label = collapsed ? expandLabel : collapseLabel;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-expanded={!collapsed}
          aria-label={label}
          onClick={onToggle}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <FolderTree aria-hidden="true" data-icon="inline-start" />
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {shortcut ? (
          <span className="text-background/70 tracking-wide">{shortcut}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function FilePanelSearchButton({
  disabled = false,
  label,
  onOpenSearch,
  shortcut,
}: {
  disabled?: boolean;
  label: string;
  onOpenSearch: () => void;
  /** Optional shortcut label when the action has a keybinding. */
  shortcut?: string | undefined;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          disabled={disabled}
          onClick={onOpenSearch}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <Search aria-hidden="true" data-icon="inline-start" />
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {shortcut ? (
          <span className="text-background/70 tracking-wide">{shortcut}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
