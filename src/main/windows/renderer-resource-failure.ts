import {
  app,
  dialog,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
} from "electron";
import type { AppWindow } from "./app-window.ts";
import {
  buildRendererRecoveryCopy,
  type RendererRecoveryKind,
} from "./renderer-recovery-page.ts";

export type RendererFailureKind = RendererRecoveryKind;

export interface RendererFailure {
  detail: string;
  errorCode?: number | string;
  incidentId?: string;
  kind: RendererFailureKind;
}

export interface RendererFailureRecovery {
  report(failure: RendererFailure): void;
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

export function failurePromptOptions(
  failure: RendererFailure
): MessageBoxOptions {
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

export function isExpectedFailure(
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
