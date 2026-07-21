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
import { resolveSkillsLaunchBlock } from "@/lib/skills/launch-block.ts";
import {
  confirmTerminalLaunch,
  rejectTerminalLaunch,
} from "@/lib/workspace/terminal-launch-confirmation.ts";
import { computeMonoFontFamilyList } from "@/stores/font.store.ts";
import {
  registerTerminalLayoutAnchor,
  type TerminalLayoutRegistration,
} from "./terminal-layout-coordinator.ts";
import {
  disposeTerminalPanelLifecycleDebug,
  type TerminalLifecycleDebugPatch,
  updateTerminalPanelLifecycleDebug,
} from "./terminal-lifecycle-debug.ts";
import { requestTerminalPresentation } from "./terminal-presentation-reconciler.ts";
import { readTerminalAnchorFrame } from "./terminal-viewport.ts";

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

function waitForRealSize(
  anchor: HTMLDivElement,
  shouldStop: () => boolean
): Promise<CreateTerminalArgs["frame"] | null> {
  const { promise, resolve } = Promise.withResolvers<
    CreateTerminalArgs["frame"] | null
  >();
  const check = () => {
    if (shouldStop()) {
      resolve(null);
      return;
    }
    const frame = readTerminalAnchorFrame(anchor);
    if (frame) {
      resolve(frame);
      return;
    }
    requestAnimationFrame(check);
  };
  check();
  return promise;
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
    const subscriptions: Array<{ dispose(): void }> = [];
    let layoutRegistration: TerminalLayoutRegistration | null = null;
    let renderableAnchorObserver: ResizeObserver | null = null;
    let didCreateNativeTerminal = false;
    let createPromise: Promise<void> | null = null;
    let createAttemptCount = 0;
    let createFailureLatched = false;
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

    const sendFrameNow = () => {
      if (disposed || !didCreateNativeTerminal) {
        return;
      }
      layoutRegistration?.flushNow("dockview-dimensions");
    };

    const markCreateFailure = (message: string) => {
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
        const buildCreateArgs = (
          continuation?: string
        ): CreateTerminalArgs => ({
          panelId,
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
          ...(continuation && { skillsLaunchContinuation: continuation }),
        });
        let result = await window.pier.terminal.create(buildCreateArgs());
        if (!result.ok && result.skillsLaunchBlocked && !isDisposed()) {
          // Skills launch gate blocked this managed launch (design v8 §7.8):
          // three-way choice, then a degrade retries with the continuation
          // attempt id — admitted exactly once in the SPAWN_INTENT window.
          const continuation = await resolveSkillsLaunchBlock({
            blocked: result.skillsLaunchBlocked,
            t: translateRef.current,
          });
          if (continuation && !isDisposed()) {
            result = await window.pier.terminal.create(
              buildCreateArgs(continuation)
            );
          } else {
            // User cancelled / went to settings — show a readable panel
            // message instead of the raw gate error (design v8 §7.8).
            result = {
              ok: false,
              error: translateRef.current(
                "settings.skills.launchCancelledPanel"
              ),
            };
          }
        }
        if (!acceptCreateResult(result)) {
          return;
        }

        didCreateNativeTerminal = true;
        confirmTerminalLaunch(initialLaunchId);
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
