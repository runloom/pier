import type {
  RendererPluginContext,
  RendererPluginDialogIntent,
  RendererPluginDialogSize,
  RendererPluginLoadingNotification,
} from "@plugins/api/renderer.ts";
import { activeGitTarget } from "./git-target.ts";

export function commandTitle(
  context: RendererPluginContext,
  id: string,
  fallback: string
): string {
  return context.i18n.commandTitle(id, fallback);
}

export type GitLoadingToast = RendererPluginLoadingNotification;
export interface GitConfirmDialogOptions {
  intent?: RendererPluginDialogIntent;
  size?: RendererPluginDialogSize;
}

export function showLoading(
  context: RendererPluginContext,
  message: string
): GitLoadingToast {
  return context.notifications.loading(message);
}

export function showInfo(
  context: RendererPluginContext,
  _title: string,
  message: string
): void {
  context.notifications.info(message);
}

export function showSuccess(
  context: RendererPluginContext,
  _title: string,
  message: string
): void {
  context.notifications.success(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Non-blocking failure for ordinary git actions (stage/unstage/etc).
 * Prefer this over dialogs.alert for header/tree mutations.
 */
export function notifyError(
  context: RendererPluginContext,
  title: string,
  error?: unknown
): void {
  if (error !== undefined) {
    // Dev-facing only; users see the short toast title.
    console.error(title, error);
  }
  context.notifications.error(title);
}

/**
 * Blocking alert for rare "need to read the error" host flows.
 * Do not use for stage/unstage/header actions — use notifyError.
 */
export function showError(
  context: RendererPluginContext,
  title: string,
  error: unknown
): Promise<void> {
  return showUnavailable(context, title, errorMessage(error));
}

export function showUnavailable(
  context: RendererPluginContext,
  title: string,
  detail?: string
): Promise<void> {
  return context.dialogs.alert({
    ...(detail ? { body: detail } : {}),
    title,
  });
}

export function activeCwdOrMessage(
  context: RendererPluginContext,
  _title: string
): string | null {
  const target = activeGitTarget(context);
  if (!target.enabled) {
    context.notifications.error(target.reason);
    return null;
  }
  return target.target.cwd;
}

export function confirmDialog(
  context: RendererPluginContext,
  title: string,
  body: string,
  confirmLabel: string,
  detail?: string,
  options: GitConfirmDialogOptions = {}
): Promise<boolean> {
  return context.dialogs.confirm({
    body: [body, detail].filter(Boolean).join("\n\n"),
    confirmLabel,
    intent: options.intent ?? "default",
    size: options.size ?? "sm",
    title,
  });
}

export function enabledForActiveGit(context: RendererPluginContext): boolean {
  return activeGitTarget(context).enabled;
}

export function disabledReasonForActiveGit(
  context: RendererPluginContext
): null | string {
  const target = activeGitTarget(context);
  return target.enabled ? null : target.reason;
}

export function showConflictDetails(
  context: RendererPluginContext,
  title: string,
  body: string,
  detail?: string
): Promise<void> {
  return context.dialogs.alert({
    body: [body, detail].filter(Boolean).join("\n\n"),
    title,
  });
}
