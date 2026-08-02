import type { PanelContext } from "@shared/contracts/panel.ts";
import type {
  TaskOutputPanelParams,
  TaskPanelMetadata,
} from "@shared/contracts/tasks.ts";
import type {
  CreateTerminalArgs,
  CreateTerminalResult,
} from "@shared/contracts/terminal.ts";
import type { IDockviewPanelProps } from "dockview-react";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { useT } from "@/i18n/use-t.ts";
import { isWindowKeyFocused } from "@/lib/window-focus-attribute.ts";
import {
  confirmTerminalLaunch,
  rejectTerminalLaunch,
} from "@/lib/workspace/terminal-launch-confirmation.ts";
import { computeMonoFontFamilyList } from "@/stores/font.store.ts";
import {
  registerTerminalLayoutAnchor,
  type TerminalLayoutRegistration,
} from "../layout-coordinator.ts";
import {
  disposeTerminalPanelLifecycleDebug,
  type TerminalLifecycleDebugPatch,
  updateTerminalPanelLifecycleDebug,
} from "../lifecycle-debug.ts";
import {
  allocateTerminalPresentationId,
  TerminalNativeFrameGate,
} from "../native-frame-gate.ts";
import { waitForRealSize } from "../native-frame-wait.ts";
import { requestTerminalPresentation } from "../presentation-reconciler.ts";
import { readTerminalAnchorFrame } from "../viewport.ts";

const TERMINAL_FRAME_COMMIT_TIMEOUT_MS = 10_000;

interface UseTerminalNativeLifecycleArgs {
  anchorRef: RefObject<HTMLDivElement | null>;
  api: IDockviewPanelProps["api"];
  effectiveMonoFontSize: number;
  initialContext: PanelContext | undefined;
  initialInput: string | undefined;
  initialLaunchId: string | undefined;
  initialTab: CreateTerminalArgs["tab"] | undefined;
  initialTask: TaskPanelMetadata | undefined;
  initialTaskOutput: TaskOutputPanelParams | undefined;
  monoFontFamily: string;
  panelId: string;
  retryNonce: number;
  sessionLoaded: boolean;
  setCreateError: (error: string) => void;
  setNativeTerminalReady: (ready: boolean) => void;
  skipNativeCreate: boolean;
}

export function useTerminalNativeLifecycle({
  api,
  anchorRef,
  effectiveMonoFontSize,
  initialContext,
  initialInput,
  initialLaunchId,
  initialTab,
  initialTask,
  initialTaskOutput,
  monoFontFamily,
  panelId,
  retryNonce,
  skipNativeCreate,
  sessionLoaded,
  setCreateError,
  setNativeTerminalReady,
}: UseTerminalNativeLifecycleArgs): void {
  const monoFontFamilyRef = useRef(monoFontFamily);
  const effectiveMonoFontSizeRef = useRef(effectiveMonoFontSize);
  const t = useT();
  const translateRef = useRef(t);
  useLayoutEffect(() => {
    monoFontFamilyRef.current = monoFontFamily;
    effectiveMonoFontSizeRef.current = effectiveMonoFontSize;
    translateRef.current = t;
  }, [effectiveMonoFontSize, monoFontFamily, t]);
  const lifecycleVersionRef = useRef(0);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }
    let disposed = false;
    const lifecycleVersion = lifecycleVersionRef.current + retryNonce + 1;
    lifecycleVersionRef.current = lifecycleVersion;
    const presentationId = allocateTerminalPresentationId();
    const frameGate = new TerminalNativeFrameGate(panelId, presentationId);
    const subscriptions: Array<{ dispose(): void }> = [];
    let layoutRegistration: TerminalLayoutRegistration | null = null;
    let renderableAnchorObserver: ResizeObserver | null = null;
    let didCreateNativeTerminal = false;
    let createPromise: Promise<void> | null = null;
    let createAttemptCount = 0;
    let createFailureLatched = false;
    let frameCommitTimeout: ReturnType<typeof setTimeout> | null = null;
    let frameCommitWaiting = false;
    let lifecycleError: string | null = null;
    let lifecycleNativeTerminalReady = false;
    let panelVisible = api.isVisible;
    let windowFocused = isWindowKeyFocused();
    setNativeTerminalReady(false);

    const clearFrameCommitTimeout = (): void => {
      if (!frameCommitTimeout) {
        return;
      }
      clearTimeout(frameCommitTimeout);
      frameCommitTimeout = null;
    };

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

    const markNativeTerminalReady = (): void => {
      if (disposed || createFailureLatched || lifecycleNativeTerminalReady) {
        return;
      }
      frameCommitWaiting = false;
      clearFrameCommitTimeout();
      setNativeTerminalReady(true);
      markLifecycle({
        createPending: false,
        didCreateNativeTerminal: true,
        error: null,
        nativeTerminalReady: true,
        phase: "ready",
      });
    };

    markLifecycle({
      createPending: false,
      didCreateNativeTerminal: false,
      error: null,
      nativeTerminalReady: false,
      phase: "mounted",
      presentationId,
    });

    if (!sessionLoaded) {
      markLifecycle({
        createPending: false,
        phase: "waiting_for_session",
      });
      return () => {
        disposed = true;
        disposeTerminalPanelLifecycleDebug(panelId);
      };
    }

    if (skipNativeCreate) {
      markLifecycle({
        createPending: false,
        phase: "skipped_restored_result",
      });
      return () => {
        disposed = true;
        disposeTerminalPanelLifecycleDebug(panelId);
      };
    }

    subscriptions.push({
      dispose: window.pier.terminal.onFrameCommitted((event) => {
        if (frameGate.acceptFrame(event)) {
          markNativeTerminalReady();
        }
      }),
    });

    const sendFrameNow = () => {
      if (disposed || !didCreateNativeTerminal) {
        return;
      }
      layoutRegistration?.flushNow("dockview-dimensions");
    };

    const markCreateFailure = (message: string) => {
      frameCommitWaiting = false;
      clearFrameCommitTimeout();
      createFailureLatched = true;
      rejectTerminalLaunch(initialLaunchId, message);
      setCreateError(message);
      markLifecycle({
        createPending: false,
        error: message,
        phase: "error",
      });
    };

    const logCreateError = (err: unknown) => {
      console.error(`[terminal-panel] create ${panelId} failed:`, err);
      markCreateFailure(err instanceof Error ? err.message : String(err));
    };

    const hasRenderableAnchor = () => readTerminalAnchorFrame(anchor) !== null;

    const canWaitForCommittedFrame = (): boolean =>
      panelVisible &&
      windowFocused &&
      document.visibilityState !== "hidden" &&
      hasRenderableAnchor();

    const syncFrameCommitTimeout = (): void => {
      if (
        disposed ||
        createFailureLatched ||
        lifecycleNativeTerminalReady ||
        !frameCommitWaiting ||
        !canWaitForCommittedFrame()
      ) {
        clearFrameCommitTimeout();
        return;
      }
      if (frameCommitTimeout) {
        return;
      }
      frameCommitTimeout = setTimeout(() => {
        frameCommitTimeout = null;
        if (!canWaitForCommittedFrame()) {
          return;
        }
        markCreateFailure(translateRef.current("terminal.frameWaitFailed"));
      }, TERMINAL_FRAME_COMMIT_TIMEOUT_MS);
    };

    subscriptions.push({
      dispose: window.pier.window.onFocusChanged(({ focused }) => {
        windowFocused = focused;
        syncFrameCommitTimeout();
      }),
    });

    const isDisposed = () =>
      disposed || lifecycleVersionRef.current !== lifecycleVersion;

    const shouldCreateNativeTerminal = () =>
      !createFailureLatched && (api.isVisible || api.isActive);

    const acceptCreateResult = (result: CreateTerminalResult): boolean => {
      if (isDisposed()) {
        return false;
      }
      if (!result.ok) {
        markCreateFailure(result.error ?? "终端创建失败");
        return false;
      }
      return true;
    };

    const ensureNativeTerminal = (): Promise<void> => {
      if (didCreateNativeTerminal || createFailureLatched) {
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
        const frame = await waitForRealSize(anchor, isDisposed);
        if (!frame || isDisposed() || didCreateNativeTerminal) {
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
          presentationId,
          frame,
          font: {
            family: computeMonoFontFamilyList(monoFontFamilyRef.current),
            size: effectiveMonoFontSizeRef.current,
          },
          ...(initialContext && { context: initialContext }),
          ...(initialInput && { initialInput }),
          ...(initialLaunchId && { launchId: initialLaunchId }),
          ...(initialTab && { tab: initialTab }),
          ...(initialTask && { task: initialTask }),
          ...(initialTaskOutput && { taskOutput: initialTaskOutput }),
        });
        // Skills never gate terminal create — no launch-block dialog.
        if (!acceptCreateResult(result)) {
          return;
        }

        didCreateNativeTerminal = true;
        confirmTerminalLaunch(initialLaunchId);
        layoutRegistration = registerTerminalLayoutAnchor(panelId, anchor);
        renderableAnchorObserver?.disconnect();
        renderableAnchorObserver = null;
        layoutRegistration.flushTrailing("visibility");
        requestTerminalPresentation("visibility");
        if (frameGate.markCreated()) {
          markNativeTerminalReady();
        } else {
          frameCommitWaiting = true;
          markLifecycle({
            createPending: false,
            didCreateNativeTerminal: true,
            error: null,
            nativeTerminalReady: false,
            phase: "waiting_for_frame",
          });
          syncFrameCommitTimeout();
        }
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
        panelVisible = e.isVisible;
        syncFrameCommitTimeout();
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
        syncFrameCommitTimeout();
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
        syncFrameCommitTimeout();
        ensureNativeTerminalIfRenderable();
        sendFrameNow();
      })
    );

    const handleDocumentVisibilityChange = (): void => {
      syncFrameCommitTimeout();
    };
    document.addEventListener(
      "visibilitychange",
      handleDocumentVisibilityChange,
      true
    );

    ensureNativeTerminalIfRenderable();
    requestAnimationFrame(() => {
      if (!isDisposed()) {
        ensureNativeTerminalIfRenderable();
      }
    });

    return () => {
      disposed = true;
      if (!didCreateNativeTerminal) {
        rejectTerminalLaunch(
          initialLaunchId,
          "terminal panel closed before creation completed"
        );
      }
      disposeTerminalPanelLifecycleDebug(panelId);
      frameCommitWaiting = false;
      clearFrameCommitTimeout();
      document.removeEventListener(
        "visibilitychange",
        handleDocumentVisibilityChange,
        true
      );
      for (const s of subscriptions) {
        s.dispose();
      }
      renderableAnchorObserver?.disconnect();
      layoutRegistration?.dispose();
    };
  }, [
    api,
    anchorRef,
    initialContext,
    initialInput,
    initialLaunchId,
    initialTab,
    initialTask,
    initialTaskOutput,
    panelId,
    retryNonce,
    sessionLoaded,
    skipNativeCreate,
    setCreateError,
    setNativeTerminalReady,
  ]);
}
