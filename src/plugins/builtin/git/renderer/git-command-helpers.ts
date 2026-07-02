import type {
  RendererPluginContext,
  RendererPluginLoadingNotification,
} from "@plugins/api/renderer.ts";
import { pluginText } from "./git-plugin-text.ts";
import { activeGitTarget } from "./git-target.ts";

export function commandTitle(
  context: RendererPluginContext,
  id: string,
  fallback: string
): string {
  return context.i18n.commandTitle(id, fallback);
}

function toastOptions(detail?: string): { description: string } | undefined {
  const description = detail?.trim();
  return description ? { description } : undefined;
}

export type GitLoadingToast = RendererPluginLoadingNotification;

export function showLoading(
  context: RendererPluginContext,
  message: string
): GitLoadingToast {
  return context.notifications.loading(message);
}

export function showInfo(
  context: RendererPluginContext,
  _title: string,
  message: string,
  detail?: string
): void {
  context.notifications.info(message, toastOptions(detail));
}

export function showSuccess(
  context: RendererPluginContext,
  _title: string,
  message: string,
  detail?: string
): void {
  context.notifications.success(message, toastOptions(detail));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function showError(
  context: RendererPluginContext,
  title: string,
  error: unknown
): Promise<void> {
  return showUnavailable(context, title, errorMessage(error));
}

export function showUnavailable(
  context: RendererPluginContext,
  _title: string,
  detail?: string
): Promise<void> {
  return context.dialogs.alert({
    ...(detail ? { body: detail } : {}),
    title: pluginText(context, "gitErrorUnavailable", "Git operation failed"),
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
  detail?: string
): Promise<boolean> {
  return context.dialogs.confirm({
    body: [body, detail].filter(Boolean).join("\n\n"),
    confirmLabel,
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

export async function confirmOpenReview(
  context: RendererPluginContext,
  title: string,
  body: string,
  detail?: string
): Promise<void> {
  const sourceContext = context.panels.getActiveContext();
  const confirmed = await confirmDialog(
    context,
    title,
    body,
    pluginText(context, "gitConflictOpenReview", "Open Review"),
    detail
  );
  if (confirmed) {
    context.panels.open(
      "pier.git.changes",
      sourceContext ? { context: sourceContext } : undefined
    );
  }
}
