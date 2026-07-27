import { createLogger } from "@shared/logger.ts";
import {
  app,
  dialog,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
  type WebContents,
} from "electron";
import type { AppWindow } from "./app-window.ts";
import {
  buildRendererRecoveryCopy,
  isRendererRecoveryCloseUrl,
  isRendererRecoveryReloadUrl,
  loadRendererRecoveryPage,
  type RendererRecoveryKind,
} from "./renderer-recovery-page.ts";

export type RendererFailureKind = RendererRecoveryKind;

interface RendererFailure {
  detail: string;
  errorCode?: number | string;
  kind: RendererFailureKind;
}

export interface RendererFailureRecovery {
  report(failure: RendererFailure): void;
}

const log = createLogger("renderer.failure");

export function reportRendererLoadError(
  recovery: RendererFailureRecovery,
  error: unknown
): void {
  const errorCode =
    typeof error === "object" && error !== null
      ? Reflect.get(error, "code")
      : undefined;
  recovery.report({
    detail: String(error),
    ...(typeof errorCode === "number" || typeof errorCode === "string"
      ? { errorCode }
      : {}),
    kind: "load",
  });
}

interface InstallRendererFailureRecoveryArgs {
  beforeLoadFailure(): void;
  beforeRendererGone(): void;
  isContentVisible(): boolean;
  isQuitting(): boolean;
  /** Load the real app entry (not recovery data URL / not bare reload). */
  reloadAppEntry(): void;
  window: AppWindow;
}

function failureCopy(kind: RendererFailureKind): {
  message: string;
  title: string;
} {
  const copy = buildRendererRecoveryCopy({
    detail: "",
    isChinese: app.getLocale().toLowerCase().startsWith("zh"),
    kind,
  });
  return { message: copy.message, title: copy.title };
}

function failurePromptOptions(failure: RendererFailure): MessageBoxOptions {
  const copy = failureCopy(failure.kind);
  const isChinese = app.getLocale().toLowerCase().startsWith("zh");
  return {
    buttons: isChinese ? ["重试", "关闭窗口"] : ["Retry", "Close window"],
    cancelId: 1,
    defaultId: 0,
    detail: failure.detail.slice(0, 20_000),
    message: copy.message,
    noLink: true,
    title: copy.title,
    type: "error",
  };
}

function isExpectedFailure(
  failure: RendererFailure,
  window: AppWindow,
  isQuitting: () => boolean
): boolean {
  return (
    window.isDestroyed() ||
    isQuitting() ||
    (failure.kind === "load" &&
      (failure.errorCode === -3 || failure.errorCode === "ERR_ABORTED"))
  );
}

interface ResourceFailureTarget {
  isQuitting(): boolean;
  retry(): void;
  window: AppWindow;
}

/** load/preload 属于同一应用产物，多个恢复窗口共用一次提示与决定。 */
export class RendererResourceFailureCoordinator {
  private readonly affected = new Map<AppWindow, ResourceFailureTarget>();
  private promptPending = false;
  private readonly showMessageBox: (
    options: MessageBoxOptions
  ) => Promise<MessageBoxReturnValue>;

  constructor(
    showMessageBox: (
      options: MessageBoxOptions
    ) => Promise<MessageBoxReturnValue> = (options) =>
      dialog.showMessageBox(options)
  ) {
    this.showMessageBox = showMessageBox;
  }

  report(target: ResourceFailureTarget, failure: RendererFailure): void {
    if (isExpectedFailure(failure, target.window, target.isQuitting)) return;
    this.affected.set(target.window, target);
    if (this.promptPending) return;
    this.promptPending = true;
    this.showMessageBox(failurePromptOptions(failure))
      .then(({ response }) => this.applyDecision(response))
      .catch((error: unknown) => this.handlePromptFailure(error));
  }

  private applyDecision(response: number): void {
    const targets = [...this.affected];
    this.affected.clear();
    this.promptPending = false;
    for (const [window, target] of targets) {
      if (window.isDestroyed() || target.isQuitting()) continue;
      try {
        if (response === 0) target.retry();
        else window.destroy();
      } catch (error) {
        console.error("[renderer-failure-target] recovery failed:", error);
        if (response === 0 && !window.isDestroyed()) {
          try {
            window.destroy();
          } catch (destroyError) {
            console.error(
              "[renderer-failure-target] destroy fallback failed:",
              destroyError
            );
          }
        }
      }
    }
  }

  private handlePromptFailure(error: unknown): void {
    console.error("[renderer-failure-feedback] failed:", error);
    this.applyDecision(1);
  }
}

const rendererResourceFailures = new RendererResourceFailureCoordinator();

async function presentInPageRecovery(
  window: AppWindow,
  failure: RendererFailure
): Promise<boolean> {
  if (window.isDestroyed() || window.webContents.isDestroyed()) {
    return false;
  }
  try {
    const copy = buildRendererRecoveryCopy({
      detail: failure.detail,
      isChinese: app.getLocale().toLowerCase().startsWith("zh"),
      kind: failure.kind,
    });
    await loadRendererRecoveryPage(window.webContents, copy);
    log.info("recovery-page-loaded", {
      kind: failure.kind,
      windowId: window.id,
    });
    // Recovery page may be the only interactive surface; ensure the shell is
    // visible so the user can click Reload / Close.
    try {
      window.host.setOpacity(1);
      if (!window.isMinimized()) {
        window.host.show();
      }
      window.focus();
    } catch {
      // ignore chrome visibility failures; page may still be usable
    }
    return true;
  } catch (error) {
    log.error("recovery-page-load-failed", {
      kind: failure.kind,
      message: error instanceof Error ? error.message : String(error),
      windowId: window.id,
    });
    return false;
  }
}

/** renderer 尚未能渲染错误页时，由 main 提供唯一的重试/关窗兜底。 */
function createRendererFailureRecovery(
  window: AppWindow,
  isQuitting: () => boolean,
  isContentVisible: () => boolean,
  beforeLoadFailure: () => void,
  reloadAppEntry: () => void
): RendererFailureRecovery {
  let promptPending = false;
  let recoveryPagePending = false;

  const presentNative = (failure: RendererFailure): void => {
    if (promptPending || isExpectedFailure(failure, window, isQuitting)) {
      return;
    }
    promptPending = true;
    dialog
      .showMessageBox(failurePromptOptions(failure))
      .then(({ response }) => {
        promptPending = false;
        if (window.isDestroyed()) return;
        if (response === 0) {
          reloadAppEntry();
        } else {
          window.destroy();
        }
      })
      .catch((error: unknown) => {
        promptPending = false;
        console.error("[renderer-failure-feedback] failed:", error);
        if (!window.isDestroyed()) window.destroy();
      });
  };

  const present = (failure: RendererFailure): void => {
    log.error("renderer-failure", {
      detail: failure.detail.slice(0, 2000),
      kind: failure.kind,
      visible: isContentVisible(),
      windowId: window.id,
    });
    if (isExpectedFailure(failure, window, isQuitting)) {
      return;
    }

    // load/preload are shared product-bundle failures — keep multi-window
    // coalesced native prompt so one decision retries all affected shells.
    if (failure.kind === "load" || failure.kind === "preload") {
      beforeLoadFailure();
      rendererResourceFailures.report(
        { isQuitting, retry: reloadAppEntry, window },
        failure
      );
      return;
    }

    // crash / unresponsive: prefer in-page recovery when the shell is already
    // visible so users get Reload without depending on JS in the dead app.
    if (isContentVisible() && !recoveryPagePending) {
      recoveryPagePending = true;
      presentInPageRecovery(window, failure)
        .then((ok) => {
          recoveryPagePending = false;
          if (!ok) {
            presentNative(failure);
          }
        })
        .catch(() => {
          recoveryPagePending = false;
          presentNative(failure);
        });
      return;
    }

    presentNative(failure);
  };

  return {
    report(failure) {
      present(failure);
    },
  };
}

/**
 * Compose will-navigate: allow pier-recovery:// actions, deny everything else.
 * Call from window-manager so recovery page links work after load.
 */
export function installRendererNavigationGuard(
  webContents: WebContents,
  handlers: {
    onRecoveryClose(): void;
    onRecoveryReload(): void;
  }
): void {
  webContents.on("will-navigate", (event, url) => {
    if (isRendererRecoveryReloadUrl(url)) {
      event.preventDefault();
      handlers.onRecoveryReload();
      return;
    }
    if (isRendererRecoveryCloseUrl(url)) {
      event.preventDefault();
      handlers.onRecoveryClose();
      return;
    }
    event.preventDefault();
  });
}

export function installRendererFailureRecovery({
  beforeLoadFailure,
  beforeRendererGone,
  isContentVisible,
  isQuitting,
  reloadAppEntry,
  window,
}: InstallRendererFailureRecoveryArgs): RendererFailureRecovery {
  const recovery = createRendererFailureRecovery(
    window,
    isQuitting,
    isContentVisible,
    beforeLoadFailure,
    reloadAppEntry
  );

  installRendererNavigationGuard(window.webContents, {
    onRecoveryClose: () => {
      if (!(window.isDestroyed() || isQuitting())) {
        log.info("recovery-close-via-guard", { windowId: window.id });
        window.destroy();
      }
    },
    onRecoveryReload: () => {
      if (!(window.isDestroyed() || isQuitting())) {
        log.info("recovery-reload-via-guard", { windowId: window.id });
        reloadAppEntry();
      }
    },
  });

  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (
        isMainFrame === false ||
        errorCode === -3 ||
        isQuitting() ||
        window.isDestroyed()
      ) {
        return;
      }
      // Recovery data-URL navigations should not re-enter failure handling.
      if (
        typeof validatedUrl === "string" &&
        validatedUrl.startsWith("data:text/html")
      ) {
        return;
      }
      recovery.report({
        detail: `${errorCode}: ${errorDescription}\n${validatedUrl}`,
        errorCode,
        kind: "load",
      });
    }
  );
  window.webContents.on("render-process-gone", (_event, details) => {
    beforeRendererGone();
    if (
      details.reason !== "clean-exit" &&
      !(isQuitting() || window.isDestroyed())
    ) {
      recovery.report({
        detail: `${details.reason} (exit ${details.exitCode})`,
        kind: "crash",
      });
    }
  });
  window.webContents.on("unresponsive", () => {
    if (isQuitting() || window.isDestroyed()) {
      return;
    }
    log.error("renderer-unresponsive", { windowId: window.id });
    try {
      // Kill the hung process so we can load a recovery document that the
      // user can interact with (reload / close) without waiting forever.
      window.webContents.forcefullyCrashRenderer();
    } catch (error) {
      log.error("force-crash-failed", {
        message: error instanceof Error ? error.message : String(error),
        windowId: window.id,
      });
      recovery.report({
        detail: "renderer unresponsive (force crash failed)",
        kind: "unresponsive",
      });
    }
  });
  window.webContents.on("responsive", () => {
    log.info("renderer-responsive", { windowId: window.id });
  });
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    if (isQuitting() || window.isDestroyed()) return;
    console.error(
      "[pier-preload-error]",
      preloadPath,
      error instanceof Error ? error.message : String(error)
    );
    recovery.report({
      detail: `${preloadPath}\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      kind: "preload",
    });
  });
  return recovery;
}
