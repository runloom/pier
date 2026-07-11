import {
  app,
  dialog,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
} from "electron";
import type { AppWindow } from "./app-window.ts";

export type RendererFailureKind = "crash" | "load" | "preload";

interface RendererFailure {
  detail: string;
  errorCode?: number | string;
  kind: RendererFailureKind;
}

export interface RendererFailureRecovery {
  report(failure: RendererFailure): void;
}

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
  isQuitting(): boolean;
  retryRenderer(): void;
  window: AppWindow;
}

function failureCopy(kind: RendererFailureKind): {
  message: string;
  title: string;
} {
  const isChinese = app.getLocale().toLowerCase().startsWith("zh");
  const labels = isChinese
    ? {
        crash: "界面进程意外退出。",
        load: "界面资源加载失败。",
        preload: "安全桥接脚本加载失败。",
        title: "Pier 界面不可用",
      }
    : {
        crash: "The interface process exited unexpectedly.",
        load: "The interface resources failed to load.",
        preload: "The secure preload bridge failed to load.",
        title: "Pier interface unavailable",
      };
  return { message: labels[kind], title: labels.title };
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

/** renderer 尚未能渲染错误页时，由 main 提供唯一的重试/关窗兜底。 */
function createRendererFailureRecovery(
  window: AppWindow,
  isQuitting: () => boolean,
  beforeLoadFailure: () => void,
  retryRenderer: () => void
): RendererFailureRecovery {
  let promptPending = false;

  return {
    report(failure) {
      if (failure.kind !== "crash") {
        if (isExpectedFailure(failure, window, isQuitting)) return;
        beforeLoadFailure();
        rendererResourceFailures.report(
          { isQuitting, retry: retryRenderer, window },
          failure
        );
        return;
      }
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
            retryRenderer();
          } else {
            window.destroy();
          }
        })
        .catch((error: unknown) => {
          promptPending = false;
          console.error("[renderer-failure-feedback] failed:", error);
          if (!window.isDestroyed()) window.destroy();
        });
    },
  };
}

export function installRendererFailureRecovery({
  beforeLoadFailure,
  beforeRendererGone,
  isQuitting,
  retryRenderer,
  window,
}: InstallRendererFailureRecoveryArgs): RendererFailureRecovery {
  const recovery = createRendererFailureRecovery(
    window,
    isQuitting,
    beforeLoadFailure,
    retryRenderer
  );
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
