import {
  type PanelContext,
  type PanelTabChrome,
  panelContextSchema,
} from "@shared/contracts/panel.ts";
import type { TaskPanelMetadata } from "@shared/contracts/tasks.ts";
import type { TerminalPanelSessionSnapshot } from "@shared/contracts/terminal.ts";
import { effectiveTerminalFontSize } from "@shared/zoom.ts";
import type { IDockviewPanelProps } from "dockview-react";
import { SquareTerminal } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";
import { usePanelEventState } from "@/hooks/use-panel-event-state.ts";
import { popupContextMenuAt } from "@/lib/context-menu/use-context-menu.ts";
import { taskPanelMetadataFromParams } from "@/lib/workspace/task-panel-metadata.ts";
import {
  computeMonoFontFamily,
  computeMonoFontFamilyList,
  useFontStore,
} from "@/stores/font.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useTerminalResizeStore } from "@/stores/terminal.store.ts";
import {
  consumeFreshTerminalInitialInput,
  consumeFreshTerminalPanel,
  isFreshTerminalPanel,
} from "@/stores/terminal-panel-session-hints.store.ts";
import { useTerminalRelaunchRequest } from "@/stores/terminal-relaunch.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";
import { requestTerminalPresentation } from "./terminal-presentation-reconciler.ts";
import {
  RestoredAgentResultView,
  RestoredTaskResultView,
  restoredAgentResultFromSession,
  restoredTaskResultFromSession,
} from "./terminal-restored-result-view.tsx";
import { TerminalSearchBar } from "./terminal-search-bar.tsx";
import {
  shouldMountTerminalStatusBar,
  TerminalStatusBar,
  useTerminalStatusBarItems,
} from "./terminal-status-bar.tsx";
import { TerminalSurfacePlaceholder } from "./terminal-surface-placeholder.tsx";
import {
  activityTabChromeOverlay,
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

interface ActiveTerminalLaunch {
  context?: PanelContext | undefined;
  initialInput?: string | undefined;
  launchId?: string | undefined;
  sequence: number;
  tab?: PanelTabChrome | undefined;
  task?: TaskPanelMetadata | undefined;
}

export function TerminalPanel(props: IDockviewPanelProps) {
  const { api } = props;
  const panelId = api.id;
  const freshPanelRef = useRef<{ panelId: string; value: boolean }>({
    panelId,
    value: isFreshTerminalPanel(panelId),
  });
  if (freshPanelRef.current.panelId !== panelId) {
    freshPanelRef.current = { panelId, value: isFreshTerminalPanel(panelId) };
  }
  const [activeLaunch, setActiveLaunch] = useState<ActiveTerminalLaunch>(
    () => ({
      context: panelContextFromParams(props.params),
      initialInput: consumeFreshTerminalInitialInput(panelId),
      launchId: launchIdFromParams(props.params),
      sequence: 0,
      tab: tabChromeFromParams(props.params),
      task: taskPanelMetadataFromParams(props.params),
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
  const statusItems = useTerminalStatusBarItems();
  const pluginRegistryEntries = usePluginRegistryStore((s) => s.plugins);
  const [error, setError] = useState<string | null>(null);
  const [nativeTerminalReady, setNativeTerminalReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [savedSession, setSavedSession] = useState<
    TerminalPanelSessionSnapshot | null | undefined
  >(() => (freshPanelRef.current.value ? null : undefined));
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

  const sessionLoaded = savedSession !== undefined;
  const restoredTaskResult = restoredTaskResultFromSession(savedSession);
  const restoredAgentResult = restoredAgentResultFromSession(savedSession);
  const effectiveContext =
    runtimeContext ?? savedSession?.context ?? activeLaunch.context;
  const effectiveCwd = effectiveContext?.cwd ?? null;
  const effectiveTitle = sequenceTitle ?? savedSession?.title ?? null;
  const activity = useForegroundActivityStore((s) => s.activities[panelId]);
  // agent 会话呈现 overlay 叠在最外层：icon/status 换 agent, title 保留 agent
  // TUI 设置的终端标题；会话消失自动回退。
  // 2 层：base(持久化 tab, main 启动清算保证 restore 真相) → activity
  // overlay(task 终态常驻单源)。老 TERMINAL_TAB_CHROME_PATCHED 与
  // restore-patch 推断层均已下线。
  const effectiveTab = mergeTabChrome(
    savedSession?.tab ?? activeLaunch.tab,
    activityTabChromeOverlay(activity, effectiveTitle)
  );
  const statusContext = {
    context: effectiveContext,
    cwd: effectiveCwd,
    panelId,
    title: effectiveTitle,
  };
  // F4:与 TerminalStatusBar 组件的挂载判定同一实现(shouldMountTerminalStatusBar)—
  // 否则两处口径漂移会导致「容器已挂载但内容区没给它留 h-7」或反之的错位。
  const hasStatusBar = shouldMountTerminalStatusBar(
    statusItems,
    statusContext,
    pluginRegistryEntries
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
    if (
      freshPanelRef.current.panelId === panelId &&
      freshPanelRef.current.value
    ) {
      consumeFreshTerminalPanel(panelId);
      setSavedSession(null);
      return;
    }
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
          initialInput: relaunchRequest.initialInput,
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
    initialInput: activeLaunch.initialInput,
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
      popupContextMenuAt(
        "terminal/content",
        { x: req.x, y: req.y },
        {
          sourcePanelComponent: "terminal",
          ...(effectiveContext ? { sourcePanelContext: effectiveContext } : {}),
          sourcePanelId: panelId,
        }
      ).catch((err: unknown) => {
        console.error(`[terminal-panel] popup ${req.panelId} failed:`, err);
      });
    });
    return () => {
      unsubscribe?.();
    };
  }, [panelId, api.setActive, effectiveContext]);

  const terminalContentClassName = hasStatusBar
    ? "absolute inset-x-0 top-0 bottom-6"
    : "absolute inset-0";
  // 占位显示：终端首次就绪前，或窗口 resize 期间（见 TerminalSurfacePlaceholder）。
  const showPlaceholder =
    !error && (!nativeTerminalReady || resizePlaceholderVisible);
  let terminalBody: ReactNode;
  if (restoredTaskResult) {
    terminalBody = (
      <RestoredTaskResultView
        className={terminalContentClassName}
        fontFamily={computeMonoFontFamily(monoFontFamily)}
        fontSize={effectiveMonoFontSize}
        task={restoredTaskResult}
      />
    );
  } else if (restoredAgentResult) {
    terminalBody = (
      <RestoredAgentResultView
        agent={restoredAgentResult}
        className={terminalContentClassName}
        fontFamily={computeMonoFontFamily(monoFontFamily)}
        fontSize={effectiveMonoFontSize}
      />
    );
  } else {
    terminalBody = (
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
    );
  }
  return (
    <div
      className="relative h-full min-h-0 w-full min-w-0 overflow-hidden"
      data-testid="terminal-panel-root"
    >
      {terminalBody}
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
