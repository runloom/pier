import {
  type PanelFloatingPosition,
  panelFloatingLayoutFromParams,
} from "@shared/contracts/panel-floating.ts";
import type { TerminalPanelSessionSnapshot } from "@shared/contracts/terminal.ts";
import { effectiveTerminalFontSize } from "@shared/zoom.ts";
import type { IDockviewPanelProps } from "dockview-react";
import { SquareTerminal } from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePanelEventState } from "@/hooks/use-panel-event-state.ts";
import { popupContextMenuAt } from "@/lib/context-menu/use-context-menu.ts";
import { cssPointToContentViewPoint } from "@/lib/window-zoom/coordinates.ts";
import { taskPanelMetadataFromParams } from "@/lib/workspace/task-panel-metadata.ts";
import {
  computeMonoFontFamilyList,
  useFontStore,
} from "@/stores/font.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import {
  taskRunsForPanel,
  useTaskRunsStore,
} from "@/stores/task-runs.store.ts";
import { useTerminalResizeStore } from "@/stores/terminal.store.ts";
import {
  consumeFreshTerminalInitialInput,
  consumeFreshTerminalPanel,
  isFreshTerminalPanel,
} from "@/stores/terminal-panel-session-hints.store.ts";
import { useTerminalRelaunchRequest } from "@/stores/terminal-relaunch.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";
import { TerminalComposer } from "./terminal-composer.tsx";
import { TerminalPanelBody } from "./terminal-panel-body.tsx";
import { TerminalPanelFloatingHost } from "./terminal-panel-floating-host.tsx";
import {
  type ActiveTerminalLaunch,
  launchIdFromParams,
  panelContextFromParams,
  taskOutputFromParams,
} from "./terminal-panel-params.ts";
import { requestTerminalPresentation } from "./terminal-presentation-reconciler.ts";
import {
  restoredAgentResultFromSession,
  restoredTaskResultFromSession,
} from "./terminal-restored-result-view.tsx";
import { TerminalRuntimeControl } from "./terminal-runtime-control.tsx";
import { TerminalSearchBar } from "./terminal-search-bar.tsx";
import {
  shouldMountTerminalStatusBar,
  TerminalStatusBar,
  useTerminalStatusBarItems,
} from "./terminal-status-bar.tsx";
import {
  activityTabChromeOverlay,
  mergeTabChrome,
  tabChromeFromParams,
  taskOutputTabChromeOverlay,
  taskRunTabChromeOverlay,
} from "./terminal-tab-chrome.ts";
import { useAgentComposer } from "./use-agent-composer.ts";
import { useRestartRestoredAgent } from "./use-restart-restored-agent.ts";
import { useTerminalFloatingLayoutRevision } from "./use-terminal-floating-layout-revision.ts";
import { useTerminalNativeLifecycle } from "./use-terminal-native-lifecycle.ts";
import { useTerminalPanelDescriptor } from "./use-terminal-panel-descriptor.ts";
import { useTerminalRelaunch } from "./use-terminal-relaunch.ts";
import { useTerminalRunSelection } from "./use-terminal-run-selection.ts";
import { useTerminalRuntimeControlPresentation } from "./use-terminal-runtime-control-presentation.ts";
import { useTerminalSearchOpen } from "./use-terminal-search-open.ts";
import { useTerminalSurfaceClose } from "./use-terminal-surface-close.ts";

export function TerminalPanel(props: IDockviewPanelProps) {
  const { api } = props;
  const panelId = api.id;
  const freshPanel = useMemo(
    () => ({ panelId, value: isFreshTerminalPanel(panelId) }),
    [panelId]
  );
  const [activeLaunch, setActiveLaunch] = useState<ActiveTerminalLaunch>(
    () => ({
      context: panelContextFromParams(props.params),
      initialInput: consumeFreshTerminalInitialInput(panelId),
      launchId: launchIdFromParams(props.params),
      sequence: 0,
      tab: tabChromeFromParams(props.params),
      task: taskPanelMetadataFromParams(props.params),
      taskOutput: taskOutputFromParams(props.params),
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
  const panelRootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const statusItems = useTerminalStatusBarItems();
  const pluginRegistryEntries = usePluginRegistryStore((s) => s.plugins);
  const [error, setError] = useState<string | null>(null);
  const [errorRetryable, setErrorRetryable] = useState(false);
  const [nativeTerminalReady, setNativeTerminalReady] = useState(false);
  const [terminalRetryNonce, setTerminalRetryNonce] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const getGroupId = useCallback(() => api.group?.id ?? null, [api]);
  const floatingLayoutRevision = useTerminalFloatingLayoutRevision(api);
  const floatingLayout = useMemo(
    () => panelFloatingLayoutFromParams(props.params),
    [props.params]
  );
  const [savedSession, setSavedSession] = useState<
    TerminalPanelSessionSnapshot | null | undefined
  >(() => (freshPanel.value ? null : undefined));
  const sessionReadVersionRef = useRef(0);
  const clearTerminalError = useCallback(() => {
    setError(null);
    setErrorRetryable(false);
  }, []);
  const showRetryableTerminalError = useCallback((message: string) => {
    setError(message);
    setErrorRetryable(true);
  }, []);
  const showTerminalError = useCallback((message: string) => {
    setError(message);
    setErrorRetryable(false);
  }, []);

  const retryTerminalCreate = useCallback(() => {
    clearTerminalError();
    setNativeTerminalReady(false);
    setTerminalRetryNonce((value) => value + 1);
  }, [clearTerminalError]);

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

  const restartRestoredAgent = useRestartRestoredAgent({
    activeLaunch,
    panelId,
    restoredAgentResult,
    savedSession,
  });

  const effectiveContext =
    runtimeContext ?? savedSession?.context ?? activeLaunch.context;
  const effectiveCwd = effectiveContext?.cwd ?? null;
  const effectiveTitle = sequenceTitle ?? savedSession?.title ?? null;
  const activity = useForegroundActivityStore((s) => s.activities[panelId]);
  const taskRunsSnapshot = useTaskRunsStore((state) => state.snapshot);
  const panelTaskRuns = useMemo(
    () => taskRunsForPanel(taskRunsSnapshot, panelId),
    [panelId, taskRunsSnapshot]
  );
  const { selectedRunId: selectedTaskRunId } = useTerminalRunSelection(
    panelId,
    panelTaskRuns
  );
  const currentTaskOutput =
    taskOutputFromParams(props.params) ?? activeLaunch.taskOutput;
  const runtimeControl = useTerminalRuntimeControlPresentation(panelId);
  const forceStoppedRun = taskRunsForPanel(taskRunsSnapshot, panelId).find(
    (run) =>
      Object.values(run.nodes).some(
        (node) =>
          node.panelId === panelId &&
          node.status === "cancelled" &&
          node.termination === "force"
      )
  );
  // agent 会话呈现 overlay 叠在最外层：icon/status 换 agent；tab 短标题用短 OSC
  // 或 catalog label（超长 prompt 不进 tab，完整 OSC 仍在 display.long / tooltip）。
  // 会话消失自动回退。
  const effectiveTab = mergeTabChrome(
    mergeTabChrome(
      mergeTabChrome(
        savedSession?.tab ?? activeLaunch.tab,
        activityTabChromeOverlay(activity, effectiveTitle, taskRunsSnapshot)
      ),
      taskRunTabChromeOverlay(
        panelId,
        taskRunsSnapshot,
        savedSession?.task ?? activeLaunch.task,
        selectedTaskRunId
      )
    ),
    taskOutputTabChromeOverlay(currentTaskOutput, taskRunsSnapshot)
  );
  const statusContext = {
    context: effectiveContext,
    cwd: effectiveCwd,
    getGroupId,
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
  const restored = Boolean(restoredAgentResult || restoredTaskResult);
  const {
    closeComposer,
    composerFocusRequest,
    composerMounted,
    onComposerHeightChange,
    statusInsetPx,
    terminalContentBottomPx,
  } = useAgentComposer({
    activityKind: activity?.kind,
    api,
    hasStatusBar,
    panelId,
    restored,
  });
  const openTaskResultContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      api.setActive();
      popupContextMenuAt(
        "terminal/content",
        cssPointToContentViewPoint(
          { x: event.clientX, y: event.clientY },
          windowZoomLevel
        ),
        {
          sourcePanelComponent: "terminal",
          ...(effectiveContext ? { sourcePanelContext: effectiveContext } : {}),
          ...(typeof api.group?.id === "string"
            ? { sourcePanelGroupId: api.group.id }
            : {}),
          sourcePanelId: panelId,
        }
      ).catch((err: unknown) => {
        console.error(
          `[terminal-panel] popup restored task ${panelId} failed:`,
          err
        );
      });
    },
    [api, effectiveContext, panelId, windowZoomLevel]
  );

  useTerminalPanelDescriptor(api, {
    effectiveContext,
    effectiveCwd,
    effectiveTab,
    effectiveTitle,
    sessionLoaded,
  });

  useEffect(() => {
    if (freshPanel.panelId === panelId && freshPanel.value) {
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
  }, [freshPanel, panelId]);

  useTerminalRelaunch({
    activeSequence: activeLaunch.sequence,
    clearTerminalError,
    panelId,
    relaunchRequest,
    sessionReadVersionRef,
    setActiveLaunch,
    setNativeTerminalReady,
    setSavedSession,
    showTerminalError,
  });

  useTerminalNativeLifecycle({
    api,
    anchorRef,
    effectiveMonoFontSize,
    initialInput: activeLaunch.initialInput,
    initialContext: activeLaunch.context,
    initialLaunchId: activeLaunch.launchId,
    initialTab: activeLaunch.tab,
    initialTask: activeLaunch.task,
    initialTaskOutput: activeLaunch.taskOutput,
    monoFontFamily,
    panelId,
    retryNonce: terminalRetryNonce,
    sessionLoaded,
    skipNativeCreate: Boolean(restoredAgentResult),
    setCreateError: showRetryableTerminalError,
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
  useTerminalSurfaceClose(panelId, props.params);

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
          ...(typeof api.group?.id === "string"
            ? { sourcePanelGroupId: api.group.id }
            : {}),
          sourcePanelId: panelId,
        }
      ).catch((err: unknown) => {
        console.error(`[terminal-panel] popup ${req.panelId} failed:`, err);
      });
    });
    return () => {
      unsubscribe?.();
    };
  }, [panelId, api, effectiveContext]);

  const terminalContentClassName =
    "absolute inset-x-0 top-0 bottom-[var(--terminal-content-bottom)]";
  return (
    <div
      className="relative h-full min-h-0 w-full min-w-0 overflow-hidden"
      data-testid="terminal-panel-root"
      ref={panelRootRef}
      style={
        {
          "--terminal-content-bottom": `${terminalContentBottomPx}px`,
        } as CSSProperties
      }
    >
      <TerminalPanelBody
        activeTask={activeLaunch.task}
        anchorRef={anchorRef}
        effectiveMonoFontSize={effectiveMonoFontSize}
        error={error}
        errorRetryable={errorRetryable}
        forceStoppedRun={forceStoppedRun}
        monoFontFamily={monoFontFamily}
        nativeTerminalReady={nativeTerminalReady}
        onContextMenu={openTaskResultContextMenu}
        onRestartAgent={restartRestoredAgent}
        onRetry={retryTerminalCreate}
        resizePlaceholderVisible={resizePlaceholderVisible}
        restoredAgentResult={restoredAgentResult}
        restoredTaskResult={restoredTaskResult}
        terminalContentClassName={terminalContentClassName}
      />
      <TerminalPanelFloatingHost
        layout={floatingLayout}
        layoutRevision={floatingLayoutRevision}
        onPositionCommit={(itemId: string, position: PanelFloatingPosition) => {
          api.updateParameters({
            ...((props.params as Record<string, unknown> | undefined) ?? {}),
            floatingLayout: {
              positions: {
                ...floatingLayout.positions,
                [itemId]: position,
              },
              version: 1,
            },
          });
        }}
        panelId={panelId}
        panelRootRef={panelRootRef}
        primary={
          runtimeControl.mounted
            ? {
                content: (
                  <TerminalRuntimeControl
                    now={runtimeControl.now}
                    panelId={panelId}
                    runs={runtimeControl.runs}
                  />
                ),
                id: "runtime-controls",
                onInteractionChange: runtimeControl.setAutoExitPause,
                phase: runtimeControl.phase,
              }
            : undefined
        }
        utility={
          searchOpen
            ? [
                {
                  content: (
                    <TerminalSearchBar
                      focusRequest={searchFocusRequest}
                      onClose={closeTerminalSearch}
                      panelId={panelId}
                      visible
                    />
                  ),
                  id: "terminal-search",
                },
              ]
            : []
        }
      />
      {composerMounted ? (
        <TerminalComposer
          bottomOffsetPx={statusInsetPx}
          disabled={!nativeTerminalReady || Boolean(error)}
          focusRequest={composerFocusRequest}
          isActive={api.isActive}
          onClose={closeComposer}
          onHeightChange={onComposerHeightChange}
          panelId={panelId}
        />
      ) : null}
      <TerminalStatusBar {...statusContext} />
    </div>
  );
}

export const terminalPanelKit = {
  component: TerminalPanel,
  icon: SquareTerminal,
  kind: "terminal",
} as const;
