import {
  type PanelContext,
  panelContextSchema,
} from "@shared/contracts/panel.ts";
import type { TerminalPanelSessionSnapshot } from "@shared/contracts/terminal.ts";
import { effectiveTerminalFontSize } from "@shared/zoom.ts";
import type { IDockviewPanelProps } from "dockview-react";
import { SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";
import { usePanelEventState } from "@/hooks/use-panel-event-state.ts";
import { popupContextMenuAt } from "@/lib/context-menu/use-context-menu.ts";
import { computeMonoFontFamily, useFontStore } from "@/stores/font.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";
import {
  readTerminalAnchorFrame,
  registerTerminalLayoutAnchor,
  type TerminalLayoutRegistration,
} from "./terminal-layout-coordinator.ts";
import {
  disposeTerminalPanelLifecycleDebug,
  type TerminalLifecycleDebugPatch,
  updateTerminalPanelLifecycleDebug,
} from "./terminal-lifecycle-debug.ts";
import { requestTerminalPresentation } from "./terminal-presentation-reconciler.ts";
import { TerminalSearchBar } from "./terminal-search-bar.tsx";
import {
  hasVisibleTerminalStatusItems,
  TerminalStatusBar,
  useTerminalStatusItems,
} from "./terminal-status-bar.tsx";
import {
  mergeTabChrome,
  tabChromeFromParams,
  terminalPanelDescriptor,
} from "./terminal-tab-chrome.ts";
import { useTerminalSearchKeyboardOpening } from "./use-terminal-search-keyboard-opening.ts";
import { useTerminalSearchOpen } from "./use-terminal-search-open.ts";

function waitForRealSize(anchor: HTMLDivElement): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const frame = readTerminalAnchorFrame(anchor);
      if (frame) {
        resolve();
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

function panelContextFromParams(params: unknown): PanelContext | undefined {
  if (!params || typeof params !== "object" || !("context" in params)) {
    return;
  }
  const parsed = panelContextSchema.safeParse(
    (params as { context?: unknown }).context
  );
  return parsed.success ? parsed.data : undefined;
}

function launchIdFromParams(params: unknown): string | undefined {
  if (!params || typeof params !== "object" || !("launchId" in params)) {
    return;
  }
  const launchId = (params as { launchId?: unknown }).launchId;
  return typeof launchId === "string" && launchId.length > 0
    ? launchId
    : undefined;
}

export function TerminalPanel(props: IDockviewPanelProps) {
  const { api } = props;
  const panelId = api.id;
  const [initialContext] = useState(() => panelContextFromParams(props.params));
  const [initialLaunchId] = useState(() => launchIdFromParams(props.params));
  const [initialTab] = useState(() => tabChromeFromParams(props.params));
  const monoFontFamily = useFontStore((s) => s.monoFontFamily);
  const monoFontSize = useFontStore((s) => s.monoFontSize);
  const windowZoomLevel = useZoomStore((s) => s.windowZoomLevel);
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

  const runtimeContext = usePanelEventState(
    window.pier.terminal.onCwdChange,
    panelId,
    (e) => e.context
  );
  const sequenceTitle = usePanelEventState(
    window.pier.terminal.onTitleChange,
    panelId,
    (e) => e.title
  );
  const tabPatch = usePanelEventState(
    window.pier.terminal.onTabChromePatch,
    panelId,
    (e) => e.tab
  );

  const sessionLoaded = savedSession !== undefined;
  const effectiveContext =
    runtimeContext ?? savedSession?.context ?? initialContext;
  const effectiveCwd = effectiveContext?.cwd ?? null;
  const effectiveTitle = sequenceTitle ?? savedSession?.title ?? null;
  const effectiveTab = mergeTabChrome(
    initialTab ?? savedSession?.tab,
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

  const monoFontFamilyRef = useRef(monoFontFamily);
  const effectiveMonoFontSizeRef = useRef(effectiveMonoFontSize);
  monoFontFamilyRef.current = monoFontFamily;
  effectiveMonoFontSizeRef.current = effectiveMonoFontSize;

  useEffect(() => {
    let disposed = false;
    setSavedSession(undefined);
    window.pier.terminal
      .readSession(panelId)
      .then((session) => {
        if (!disposed) {
          setSavedSession(session);
        }
      })
      .catch((err: unknown) => {
        console.error(`[terminal-panel] read session ${panelId} failed:`, err);
        if (!disposed) {
          setSavedSession(null);
        }
      });
    return () => {
      disposed = true;
    };
  }, [panelId]);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }

    let disposed = false;
    const subscriptions: Array<{ dispose(): void }> = [];
    let layoutRegistration: TerminalLayoutRegistration | null = null;
    let renderableAnchorObserver: ResizeObserver | null = null;
    let didCreateNativeTerminal = false;
    let createPromise: Promise<void> | null = null;
    let createAttemptCount = 0;
    let lifecycleError: string | null = null;
    let lifecycleNativeTerminalReady = false;
    setNativeTerminalReady(false);

    const markLifecycle = (patch: TerminalLifecycleDebugPatch): void => {
      if (patch.error !== undefined) {
        lifecycleError = patch.error;
      }
      if (patch.nativeTerminalReady !== undefined) {
        lifecycleNativeTerminalReady = patch.nativeTerminalReady;
      }
      updateTerminalPanelLifecycleDebug(panelId, {
        createAttemptCount,
        didCreateNativeTerminal,
        error: lifecycleError,
        hasRenderableAnchor: readTerminalAnchorFrame(anchor) !== null,
        nativeTerminalReady: lifecycleNativeTerminalReady,
        placeholderVisible: !(lifecycleNativeTerminalReady || lifecycleError),
        ...patch,
      });
    };

    markLifecycle({
      createPending: false,
      didCreateNativeTerminal: false,
      error: null,
      nativeTerminalReady: false,
      phase: "mounted",
    });

    const sendFrameNow = () => {
      if (disposed || !didCreateNativeTerminal) {
        return;
      }
      layoutRegistration?.flushNow("dockview-dimensions");
    };

    const logCreateError = (err: unknown) => {
      console.error(`[terminal-panel] create ${panelId} failed:`, err);
      markLifecycle({
        createPending: false,
        error: err instanceof Error ? err.message : String(err),
        phase: "error",
      });
    };

    const hasRenderableAnchor = () => readTerminalAnchorFrame(anchor) !== null;

    const shouldCreateNativeTerminal = () =>
      api.isVisible || api.isActive || hasRenderableAnchor();

    const ensureNativeTerminal = (): Promise<void> => {
      if (didCreateNativeTerminal) {
        return Promise.resolve();
      }
      if (createPromise) {
        return createPromise;
      }
      markLifecycle({
        createPending: true,
        phase: hasRenderableAnchor() ? "creating" : "waiting_for_anchor",
      });
      createPromise = (async () => {
        await waitForRealSize(anchor);
        if (disposed || didCreateNativeTerminal) {
          return;
        }

        const frame = readTerminalAnchorFrame(anchor);
        if (!frame) {
          const message = "无法获取面板坐标";
          setError(message);
          markLifecycle({
            createPending: false,
            error: message,
            phase: "error",
          });
          return;
        }

        createAttemptCount += 1;
        markLifecycle({
          createAttemptCount,
          createPending: true,
          phase: "creating",
        });
        const result = await window.pier.terminal.create({
          panelId,
          frame,
          font: {
            family: computeMonoFontFamily(monoFontFamilyRef.current),
            size: effectiveMonoFontSizeRef.current,
          },
          ...(initialContext && { context: initialContext }),
          ...(initialLaunchId && { launchId: initialLaunchId }),
          ...(initialTab && { tab: initialTab }),
        });
        if (!result.ok) {
          const message = result.error ?? "终端创建失败";
          setError(message);
          markLifecycle({
            createPending: false,
            error: message,
            phase: "error",
          });
          return;
        }

        didCreateNativeTerminal = true;
        setNativeTerminalReady(true);
        markLifecycle({
          createPending: false,
          didCreateNativeTerminal: true,
          error: null,
          nativeTerminalReady: true,
          phase: "ready",
        });
        layoutRegistration = registerTerminalLayoutAnchor(panelId, anchor);
        renderableAnchorObserver?.disconnect();
        renderableAnchorObserver = null;
        layoutRegistration.flushTrailing("visibility");
        requestTerminalPresentation("visibility");
      })().finally(() => {
        createPromise = null;
      });
      return createPromise;
    };

    const ensureNativeTerminalIfRenderable = () => {
      markLifecycle({
        hasRenderableAnchor: hasRenderableAnchor(),
      });
      if (!shouldCreateNativeTerminal()) {
        return;
      }
      ensureNativeTerminal().catch(logCreateError);
    };

    if (!(api.isVisible || api.isActive)) {
      renderableAnchorObserver = new ResizeObserver(() => {
        ensureNativeTerminalIfRenderable();
      });
      renderableAnchorObserver.observe(anchor);
    }

    subscriptions.push(
      api.onDidVisibilityChange((e) => {
        if (e.isVisible) {
          ensureNativeTerminal()
            .then(() => {
              if (!disposed && didCreateNativeTerminal) {
                layoutRegistration?.flushTrailing("visibility");
                requestTerminalPresentation("visibility");
              }
            })
            .catch(logCreateError);
        } else if (didCreateNativeTerminal) {
          layoutRegistration?.flushTrailing("visibility");
          requestTerminalPresentation("visibility");
        }
      })
    );

    subscriptions.push(
      api.onDidActiveChange((e) => {
        if (e.isActive) {
          ensureNativeTerminal()
            .then(() => {
              if (!disposed && didCreateNativeTerminal) {
                requestTerminalPresentation("dockview-active-panel");
              }
            })
            .catch(logCreateError);
        }
      })
    );

    subscriptions.push(
      api.onDidGroupChange(() => {
        if (!(api.isActive && api.isVisible)) {
          return;
        }
        ensureNativeTerminal()
          .then(() => {
            if (!disposed && didCreateNativeTerminal) {
              layoutRegistration?.flushTrailing("dockview-layout");
              requestTerminalPresentation("dockview-layout");
            }
          })
          .catch(logCreateError);
      })
    );

    subscriptions.push(
      api.onDidDimensionsChange(() => {
        ensureNativeTerminalIfRenderable();
        sendFrameNow();
      })
    );

    ensureNativeTerminalIfRenderable();
    requestAnimationFrame(() => {
      if (!disposed) {
        ensureNativeTerminalIfRenderable();
      }
    });

    return () => {
      disposed = true;
      disposeTerminalPanelLifecycleDebug(panelId);
      for (const s of subscriptions) {
        s.dispose();
      }
      renderableAnchorObserver?.disconnect();
      layoutRegistration?.dispose();
    };
  }, [api, panelId, initialContext, initialLaunchId, initialTab]);

  useEffect(() => {
    window.pier.terminal.setFont(panelId, {
      family: computeMonoFontFamily(monoFontFamily),
      size: effectiveMonoFontSize,
    });
  }, [panelId, monoFontFamily, effectiveMonoFontSize]);

  const { holdOpeningKeyboardFocus, releaseOpeningKeyboardFocus } =
    useTerminalSearchKeyboardOpening(panelId);
  const openTerminalSearch = useCallback(() => {
    holdOpeningKeyboardFocus();
    setSearchOpen(true);
    setSearchFocusRequest((value) => value + 1);
  }, [holdOpeningKeyboardFocus]);
  const closeTerminalSearch = useCallback(() => {
    releaseOpeningKeyboardFocus();
    setSearchOpen(false);
  }, [releaseOpeningKeyboardFocus]);
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

  const terminalSurfaceStyle = {
    backgroundColor: "var(--terminal-background, var(--background))",
  };
  const terminalContentClassName = hasStatusBar
    ? "absolute inset-x-0 top-0 bottom-6"
    : "absolute inset-0";
  return (
    <div
      className="relative h-full min-h-0 w-full min-w-0 overflow-hidden"
      data-testid="terminal-panel-root"
    >
      <div
        className={`terminal-anchor ${terminalContentClassName}`}
        ref={anchorRef}
      />
      {nativeTerminalReady || error ? null : (
        <div
          aria-hidden="true"
          className={`pointer-events-none ${terminalContentClassName}`}
          data-testid="terminal-placeholder"
          style={terminalSurfaceStyle}
        />
      )}
      {error ? (
        <div
          className={`${terminalContentClassName} flex items-center justify-center`}
          style={terminalSurfaceStyle}
        >
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      ) : null}
      <TerminalSearchBar
        focusRequest={searchFocusRequest}
        onClose={closeTerminalSearch}
        onKeyboardFocusReady={releaseOpeningKeyboardFocus}
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
