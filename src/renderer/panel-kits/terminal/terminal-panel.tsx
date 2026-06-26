import type { TerminalPanelSessionSnapshot } from "@shared/contracts/terminal.ts";
import type { IDockviewPanelProps } from "dockview-react";
import { SquareTerminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";
import { usePanelEventState } from "@/hooks/use-panel-event-state.ts";
import { popupContextMenuAt } from "@/lib/context-menu/use-context-menu.ts";
import { computeMonoFontFamily, useFontStore } from "@/stores/font.store.ts";
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

/**
 * 路径 basename — POSIX 形式 (终端始终在 macOS).
 * 末尾 '/' 容错: "/" → "/"; "/a/b/" → "b"; "/a/b" → "b"; "" → "Terminal".
 */
export function basename(path: string): string {
  if (path === "" || path === "/") {
    return path === "" ? "Terminal" : "/";
  }
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

function initialCwdFromParams(params: unknown): string | undefined {
  if (!params || typeof params !== "object" || !("cwd" in params)) {
    return;
  }
  const cwd = (params as { cwd?: unknown }).cwd;
  return typeof cwd === "string" && cwd.trim() === cwd && cwd !== ""
    ? cwd
    : undefined;
}

export function TerminalPanel(props: IDockviewPanelProps) {
  const { api } = props;
  const panelId = api.id;
  const initialCwd = initialCwdFromParams(props.params);
  const monoFontFamily = useFontStore((s) => s.monoFontFamily);
  const monoFontSize = useFontStore((s) => s.monoFontSize);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [nativeTerminalReady, setNativeTerminalReady] = useState(false);
  const [savedSession, setSavedSession] = useState<
    TerminalPanelSessionSnapshot | null | undefined
  >(undefined);

  // 订阅 swift OSC 7 → main → 这里. usePanelEventState 自动按 panelId 过滤 +
  // 空字符串忽略 (vim set notitle / tmux detach 等清空场景不污染上一次有效值).
  const cwd = usePanelEventState(
    window.pier.terminal.onCwdChange,
    panelId,
    (e) => e.cwd
  );
  const sequenceTitle = usePanelEventState(
    window.pier.terminal.onTitleChange,
    panelId,
    (e) => e.title
  );

  const sessionLoaded = savedSession !== undefined;
  const restoredCwd = savedSession?.cwd ?? initialCwd;
  const effectiveCwd = cwd ?? restoredCwd ?? null;
  const effectiveTitle = sequenceTitle ?? savedSession?.title ?? null;

  // descriptor 三字段优先级链:
  // - short: basename(cwd) — tab strip 始终显示目录, 不被 OSC 干扰 (稳定锚点)
  // - long:  sequenceTitle ?? cwd — sink 优先 OSC 自定义 ("Claude Code"),
  //          没 OSC 时 fallback cwd 完整路径
  // - path:  cwd — 真实 cwd, 不被 OSC override (breadcrumb / status bar 用)
  // hook input 接受 undefined; hook 内部按字段存在性条件 upsert 到 store.
  usePanelDescriptor(
    api,
    sessionLoaded
      ? {
          short: effectiveCwd ? basename(effectiveCwd) : "Terminal",
          long: effectiveTitle ?? effectiveCwd ?? undefined,
          path: effectiveCwd ?? undefined,
        }
      : null
  );

  const monoFontFamilyRef = useRef(monoFontFamily);
  const monoFontSizeRef = useRef(monoFontSize);
  monoFontFamilyRef.current = monoFontFamily;
  monoFontSizeRef.current = monoFontSize;

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
            size: monoFontSizeRef.current,
          },
          ...(initialCwd && { cwd: initialCwd }),
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
  }, [api, panelId, initialCwd]);

  useEffect(() => {
    window.pier.terminal.setFont(panelId, {
      family: computeMonoFontFamily(monoFontFamily),
      size: monoFontSize,
    });
  }, [panelId, monoFontFamily, monoFontSize]);

  // 订阅 swift 转发的右键: panel 的 NSView 吞掉 React 层 onContextMenu, 唯一拿到
  // 右键的方式是 swift NSEvent monitor 拦截 + IPC 转发. 这里按 panelId 过滤 (一个
  // terminal panel 的菜单只该响应它自己的右键).
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
  return (
    <div
      className="relative h-full min-h-0 w-full min-w-0 overflow-hidden"
      data-testid="terminal-panel-root"
    >
      <div className="terminal-anchor absolute inset-0" ref={anchorRef} />
      {nativeTerminalReady || error ? null : (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          data-testid="terminal-placeholder"
          style={terminalSurfaceStyle}
        />
      )}
      {error ? (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={terminalSurfaceStyle}
        >
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      ) : null}
    </div>
  );
}

export const terminalPanelKit = {
  component: TerminalPanel,
  icon: SquareTerminal,
  kind: "terminal",
} as const;
