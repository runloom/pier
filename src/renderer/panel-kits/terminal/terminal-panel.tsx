import {
  type PanelContext,
  type PanelTabChrome,
  panelContextSchema,
} from "@shared/contracts/panel.ts";
import {
  type TaskPanelMetadata,
  taskPanelMetadataSchema,
} from "@shared/contracts/tasks.ts";
import type { TerminalPanelSessionSnapshot } from "@shared/contracts/terminal.ts";
import { effectiveTerminalFontSize } from "@shared/zoom.ts";
import type { IDockviewPanelProps } from "dockview-react";
import { SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";
import { usePanelEventState } from "@/hooks/use-panel-event-state.ts";
import { popupContextMenuAt } from "@/lib/context-menu/use-context-menu.ts";
import {
  computeMonoFontFamily,
  computeMonoFontFamilyList,
  useFontStore,
} from "@/stores/font.store.ts";
import { useTerminalRelaunchRequest } from "@/stores/terminal-relaunch.store.ts";
import { useTerminalResizeStore } from "@/stores/terminal-resize.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";
import { requestTerminalPresentation } from "./terminal-presentation-reconciler.ts";
import { TerminalSearchBar } from "./terminal-search-bar.tsx";
import {
  hasVisibleTerminalStatusItems,
  TerminalStatusBar,
  useTerminalStatusItems,
} from "./terminal-status-bar.tsx";
import { TerminalSurfacePlaceholder } from "./terminal-surface-placeholder.tsx";
import {
  mergeTabChrome,
  tabChromeFromParams,
  terminalPanelDescriptor,
} from "./terminal-tab-chrome.ts";
import { useTerminalNativeLifecycle } from "./use-terminal-native-lifecycle.ts";
import { useTerminalSearchOpen } from "./use-terminal-search-open.ts";

function panelContextFromParams(params: unknown): PanelContext | undefined {
  if (!params || typeof params !== "object" || !("context" in params)) {
    return;
  }
  const parsed = panelContextSchema.safeParse(params.context);
  return parsed.success ? parsed.data : undefined;
}

function launchIdFromParams(params: unknown): string | undefined {
  if (!params || typeof params !== "object" || !("launchId" in params)) {
    return;
  }
  const launchId = params.launchId;
  return typeof launchId === "string" && launchId.length > 0
    ? launchId
    : undefined;
}

function taskFromParams(params: unknown): TaskPanelMetadata | undefined {
  if (!params || typeof params !== "object" || !("task" in params)) {
    return;
  }
  const parsed = taskPanelMetadataSchema.safeParse(params.task);
  return parsed.success ? parsed.data : undefined;
}

interface ActiveTerminalLaunch {
  context?: PanelContext | undefined;
  launchId?: string | undefined;
  sequence: number;
  tab?: PanelTabChrome | undefined;
  task?: TaskPanelMetadata | undefined;
}

function RestoredTaskResultView({
  className,
  fontFamily,
  fontSize,
  task,
}: {
  className: string;
  fontFamily: string;
  fontSize: number;
  task: TaskPanelMetadata;
}) {
  const rows = [
    ["Task", task.label],
    ["Status", task.status],
    ["Command", task.rawCommand],
    ["CWD", task.cwd],
  ] as const;

  return (
    <div
      className={`${className} overflow-auto bg-[var(--terminal-background,var(--background))] px-2 py-1.5 font-mono text-[var(--terminal-foreground,var(--foreground))] leading-[1.35]`}
      data-testid="terminal-task-result"
      style={{ fontFamily, fontSize }}
    >
      <p className="mb-1 text-muted-foreground">[pier] restored task</p>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div className="contents" key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
        {task.exitCode === undefined ? null : (
          <div className="contents">
            <dt className="text-muted-foreground">Exit code</dt>
            <dd>{task.exitCode}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function restoredTaskResultFromSession(
  task: TaskPanelMetadata | undefined
): TaskPanelMetadata | undefined {
  if (!task) {
    return;
  }
  return task.status === "running" ? { ...task, status: "cancelled" } : task;
}

function restoredTaskTabPatch(
  task: TaskPanelMetadata | undefined
): Partial<PanelTabChrome> | null {
  return task?.status === "running" || task?.status === "cancelled"
    ? {
        state: {
          colorToken: "warning",
          label: "Cancelled",
          status: "cancelled",
        },
      }
    : null;
}

export function TerminalPanel(props: IDockviewPanelProps) {
  const { api } = props;
  const panelId = api.id;
  const [activeLaunch, setActiveLaunch] = useState<ActiveTerminalLaunch>(
    () => ({
      context: panelContextFromParams(props.params),
      launchId: launchIdFromParams(props.params),
      sequence: 0,
      tab: tabChromeFromParams(props.params),
      task: taskFromParams(props.params),
    })
  );
  const relaunchRequest = useTerminalRelaunchRequest(panelId);
  const monoFontFamily = useFontStore((s) => s.monoFontFamily);
  const monoFontSize = useFontStore((s) => s.monoFontSize);
  const windowZoomLevel = useZoomStore((s) => s.windowZoomLevel);
  const resizePlaceholderVisible = useTerminalResizeStore(
    (s) => s.placeholderVisible
  );
  const effectiveMonoFontSize = effectiveTerminalFontSize(
    monoFontSize,
    windowZoomLevel
  );
  const anchorRef = useRef<HTMLDivElement>(null);
  const statusItems = useTerminalStatusItems();
  const [error, setError] = useState<string | null>(null);
  const [nativeTerminalReady, setNativeTerminalReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [savedSession, setSavedSession] = useState<
    TerminalPanelSessionSnapshot | null | undefined
  >(undefined);
  const sessionReadVersionRef = useRef(0);

  const runtimeContext = usePanelEventState(
    window.pier.terminal.onCwdChange,
    panelId,
    (e) => e.context,
    activeLaunch.sequence
  );
  const sequenceTitle = usePanelEventState(
    window.pier.terminal.onTitleChange,
    panelId,
    (e) => e.title,
    activeLaunch.sequence
  );
  const tabPatch = usePanelEventState(
    window.pier.terminal.onTabChromePatch,
    panelId,
    (e) => e.tab,
    activeLaunch.sequence
  );

  const sessionLoaded = savedSession !== undefined;
  const restoredTaskResult = restoredTaskResultFromSession(savedSession?.task);
  const effectiveContext =
    runtimeContext ?? savedSession?.context ?? activeLaunch.context;
  const effectiveCwd = effectiveContext?.cwd ?? null;
  const effectiveTitle = sequenceTitle ?? savedSession?.title ?? null;
  const effectiveTab = mergeTabChrome(
    mergeTabChrome(
      savedSession?.tab ?? activeLaunch.tab,
      restoredTaskTabPatch(savedSession?.task)
    ),
    tabPatch
  );
  const statusContext = {
    context: effectiveContext,
    cwd: effectiveCwd,
    panelId,
    title: effectiveTitle,
  };
  const hasStatusBar = hasVisibleTerminalStatusItems(
    statusItems,
    statusContext
  );

  usePanelDescriptor(
    api,
    terminalPanelDescriptor({
      effectiveContext,
      effectiveCwd,
      effectiveTab,
      effectiveTitle,
      sessionLoaded,
    })
  );

  useEffect(() => {
    let disposed = false;
    const readVersion = sessionReadVersionRef.current + 1;
    sessionReadVersionRef.current = readVersion;
    setSavedSession(undefined);
    window.pier.terminal
      .readSession(panelId)
      .then((session) => {
        if (!disposed && sessionReadVersionRef.current === readVersion) {
          setSavedSession(session);
        }
      })
      .catch((err: unknown) => {
        console.error(`[terminal-panel] read session ${panelId} failed:`, err);
        if (!disposed && sessionReadVersionRef.current === readVersion) {
          setSavedSession(null);
        }
      });
    return () => {
      disposed = true;
    };
  }, [panelId]);

  useEffect(() => {
    if (
      !relaunchRequest ||
      relaunchRequest.sequence === activeLaunch.sequence
    ) {
      return;
    }
    let disposed = false;
    sessionReadVersionRef.current += 1;
    setError(null);
    setNativeTerminalReady(false);
    setSavedSession(null);
    window.pier.terminal
      .close(panelId, { reason: "relaunch" })
      .then(() => {
        if (disposed) {
          return;
        }
        setActiveLaunch({
          context: relaunchRequest.context,
          launchId: relaunchRequest.launchId,
          sequence: relaunchRequest.sequence,
          tab: relaunchRequest.tab,
          task: relaunchRequest.task,
        });
      })
      .catch((err: unknown) => {
        console.error(`[terminal-panel] relaunch ${panelId} failed:`, err);
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      disposed = true;
    };
  }, [activeLaunch.sequence, panelId, relaunchRequest]);

  useTerminalNativeLifecycle({
    api,
    anchorRef,
    effectiveMonoFontSize,
    initialContext: activeLaunch.context,
    initialLaunchId: activeLaunch.launchId,
    initialTab: activeLaunch.tab,
    initialTask: activeLaunch.task,
    monoFontFamily,
    panelId,
    sessionLoaded,
    setError,
    setNativeTerminalReady,
  });

  useEffect(() => {
    window.pier.terminal.setFont(panelId, {
      family: computeMonoFontFamilyList(monoFontFamily),
      size: effectiveMonoFontSize,
    });
  }, [panelId, monoFontFamily, effectiveMonoFontSize]);

  const openTerminalSearch = useCallback(() => {
    setSearchOpen(true);
    setSearchFocusRequest((value) => value + 1);
  }, []);
  const closeTerminalSearch = useCallback(() => {
    setSearchOpen(false);
  }, []);
  const activatePanel = useCallback(() => {
    api.setActive();
  }, [api]);
  useTerminalSearchOpen({
    onOpen: openTerminalSearch,
    panelId,
    setActive: activatePanel,
  });

  useEffect(() => {
    const unsubscribe = window.pier?.terminal?.onContextMenuRequest?.((req) => {
      if (req.panelId !== panelId) {
        return;
      }
      api.setActive();
      requestTerminalPresentation("dockview-active-panel");
      popupContextMenuAt("terminal/content", { x: req.x, y: req.y }).catch(
        (err: unknown) => {
          console.error(`[terminal-panel] popup ${req.panelId} failed:`, err);
        }
      );
    });
    return () => {
      unsubscribe?.();
    };
  }, [panelId, api.setActive]);

  const terminalContentClassName = hasStatusBar
    ? "absolute inset-x-0 top-0 bottom-6"
    : "absolute inset-0";
  // 占位显示：终端首次就绪前，或窗口 resize 期间（见 TerminalSurfacePlaceholder）。
  const showPlaceholder =
    !error && (!nativeTerminalReady || resizePlaceholderVisible);
  return (
    <div
      className="relative h-full min-h-0 w-full min-w-0 overflow-hidden"
      data-testid="terminal-panel-root"
    >
      {restoredTaskResult ? (
        <RestoredTaskResultView
          className={terminalContentClassName}
          fontFamily={computeMonoFontFamily(monoFontFamily)}
          fontSize={effectiveMonoFontSize}
          task={restoredTaskResult}
        />
      ) : (
        <>
          <div
            className={`terminal-anchor ${terminalContentClassName}`}
            ref={anchorRef}
          />
          {showPlaceholder ? (
            <TerminalSurfacePlaceholder className={terminalContentClassName} />
          ) : null}
          {error ? (
            <div
              className={`${terminalContentClassName} flex items-center justify-center bg-[var(--terminal-background,var(--background))]`}
            >
              <p className="text-muted-foreground text-sm">{error}</p>
            </div>
          ) : null}
        </>
      )}
      <TerminalSearchBar
        focusRequest={searchFocusRequest}
        onClose={closeTerminalSearch}
        panelId={panelId}
        visible={searchOpen}
      />
      <TerminalStatusBar
        context={effectiveContext}
        cwd={effectiveCwd}
        panelId={panelId}
        title={effectiveTitle}
      />
    </div>
  );
}

export const terminalPanelKit = {
  component: TerminalPanel,
  icon: SquareTerminal,
  kind: "terminal",
} as const;
