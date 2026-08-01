import {
  type PanelFloatingPosition,
  panelFloatingLayoutFromParams,
} from "@shared/contracts/panel-floating.ts";
import type { TerminalPanelSessionSnapshot } from "@shared/contracts/terminal.ts";
import { effectiveTerminalFontSize } from "@shared/zoom.ts";
import type { IDockviewPanelProps } from "dockview-react";
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
import { popupContextMenuAt } from "@/lib/context-menu/use-menu.ts";
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
import { TerminalComposer } from "./composer.tsx";
import { useAgentComposer } from "./hooks/use-agent-composer.ts";
import { useTerminalChildExitedInject } from "./hooks/use-child-exited-inject.ts";
import { useTerminalEndStateTab } from "./hooks/use-end-state-tab.ts";
import { useTerminalFloatingLayoutRevision } from "./hooks/use-floating-layout-revision.ts";
import { useNativeTerminalContextMenuPopup } from "./hooks/use-native-context-menu-popup.ts";
import { useTerminalNativeLifecycle } from "./hooks/use-native-lifecycle.ts";
import { useTerminalPanelDescriptor } from "./hooks/use-panel-descriptor.ts";
import { useTerminalRelaunch } from "./hooks/use-relaunch.ts";
import { useRestartRestoredAgent } from "./hooks/use-restart-restored-agent.ts";
import { useTerminalRunSelection } from "./hooks/use-run-selection.ts";
import { useTerminalRuntimeControlPresentation } from "./hooks/use-runtime-control-presentation.ts";
import { useTerminalSearchOpen } from "./hooks/use-search-open.ts";
import { useTerminalSurfaceClose } from "./hooks/use-surface-close.ts";
import { useTaskResultKeyboardRetain } from "./hooks/use-task-result-keyboard-retain.ts";
import { TerminalPanelBody } from "./panel-body.tsx";
import { TerminalPanelFloatingHost } from "./panel-floating-host.tsx";
import {
  type ActiveTerminalLaunch,
  launchIdFromParams,
  panelContextFromParams,
  taskOutputFromParams,
} from "./panel-params.ts";
import {
  restoredAgentResultFromSession,
  restoredTaskResultFromSession,
} from "./restored-result-view.tsx";
import { TerminalRuntimeControl } from "./runtime-control.tsx";
import { TerminalSearchBar } from "./search-bar.tsx";
import {
  shouldMountTerminalStatusBar,
  TerminalStatusBar,
  useTerminalStatusBarItems,
} from "./status-bar.tsx";
import { agentPanelDisplayPrimary, tabChromeFromParams } from "./tab-chrome.ts";
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
    (s) => s.placeholderVisible || s.suppressedPanelIds.has(panelId)
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
  const terminalTitle = sequenceTitle ?? savedSession?.title ?? null;
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
        (n) =>
          n.panelId === panelId &&
          n.status === "cancelled" &&
          n.termination === "force"
      )
  );
  const agentDisplayPrimary = agentPanelDisplayPrimary(activity, {
    cwd: effectiveCwd,
    projectRootPath: effectiveContext?.projectRootPath,
    sessionTitle: savedSession?.sessionTitle,
    sessionTitleSource: savedSession?.sessionTitleSource,
  });
  const { effectiveTab, endState } = useTerminalEndStateTab({
    activeLaunchTab: activeLaunch.tab,
    activeLaunchTask: activeLaunch.task,
    activity,
    currentTaskOutput,
    effectiveCwd,
    panelId,
    projectRootPath: effectiveContext?.projectRootPath,
    savedSession,
    selectedTaskRunId,
    taskRunsSnapshot,
  });
  const statusContext = {
    context: effectiveContext,
    cwd: effectiveCwd,
    getGroupId,
    panelId,
    title: agentDisplayPrimary ?? terminalTitle,
  };
  const hasStatusBar = shouldMountTerminalStatusBar(
    statusItems,
    statusContext,
    pluginRegistryEntries
  );
  const restored = Boolean(restoredAgentResult || restoredTaskResult);
  const {
    attachRequest,
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
      // 恢复结果是 DOM 文本，走 terminal/restored（共享 edit），勿用 native 终端 copy。
      popupContextMenuAt(
        "terminal/restored",
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
    displayPrimary: agentDisplayPrimary,
    effectiveContext,
    effectiveCwd,
    effectiveTab,
    sessionLoaded,
    terminalTitle,
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
  useTaskResultKeyboardRetain(
    panelId,
    props.params,
    api.isActive,
    panelRootRef,
    { hasAgentSession: savedSession?.agent != null }
  );
  useTerminalChildExitedInject(panelId, props.params, {
    agentIdHint:
      endState?.agentId ??
      savedSession?.agent?.agentId ??
      (activity?.kind === "agent" ? activity.agentId : undefined),
    titleHint: savedSession?.tab?.title ?? activeLaunch.tab?.title,
  });

  useNativeTerminalContextMenuPopup({
    api,
    effectiveContext,
    panelId,
  });

  const terminalContentClassName =
    "absolute inset-x-0 top-0 bottom-[var(--terminal-content-bottom)]";
  return (
    <div
      className="relative h-full min-h-0 w-full min-w-0 overflow-hidden outline-none"
      data-testid="terminal-panel-root"
      ref={panelRootRef}
      style={
        {
          "--terminal-content-bottom": `${terminalContentBottomPx}px`,
        } as CSSProperties
      }
      tabIndex={-1}
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
                    dismissRun={runtimeControl.dismissRun}
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
          agentKind={activity?.kind === "agent" ? activity.agentId : null}
          attachRequest={attachRequest}
          bottomOffsetPx={statusInsetPx}
          disabled={!nativeTerminalReady || Boolean(error)}
          focusRequest={composerFocusRequest}
          isActive={api.isActive}
          onClose={closeComposer}
          onHeightChange={onComposerHeightChange}
          panelId={panelId}
          projectRootPath={
            effectiveContext?.projectRootPath ?? effectiveContext?.cwd ?? null
          }
        />
      ) : null}
      <TerminalStatusBar {...statusContext} />
    </div>
  );
}
