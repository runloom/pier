import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  WorktreeItem,
  WorktreeUnavailableReason,
} from "@shared/contracts/worktree.ts";

const PATH_SEPARATOR_RE = /[\\/]/;

export const WORKTREE_UNAVAILABLE_MESSAGES = {
  git_unavailable: {
    fallback: "Git is unavailable",
    key: "worktreeUnavailable.gitUnavailable",
  },
  invalid_name: {
    fallback: "The worktree name is invalid",
    key: "worktreeUnavailable.invalidName",
  },
  invalid_path: {
    fallback: "The worktree path is invalid",
    key: "worktreeUnavailable.invalidPath",
  },
  not_git_repo: {
    fallback: "The current directory is not a Git repository",
    key: "worktreeUnavailable.notGitRepository",
  },
} satisfies Record<
  WorktreeUnavailableReason,
  { fallback: string; key: string }
>;

export function basename(path: string): string {
  const parts = path.split(PATH_SEPARATOR_RE).filter(Boolean);
  return parts.at(-1) ?? path;
}

export function pluginText(
  context: RendererPluginContext,
  key: string,
  fallback: string,
  values?: Record<string, number | string>
): string {
  return context.i18n.t(`ui.${key}`, values, fallback);
}

export function unsupportedReason(context: RendererPluginContext): string {
  return pluginText(
    context,
    "unsupported",
    "Current directory does not support Git worktrees"
  );
}

export function operationFailedReason(context: RendererPluginContext): string {
  return pluginText(
    context,
    "worktreeOperationFailed",
    "Worktree operation failed"
  );
}

export function activeWorktreeTarget(
  context: RendererPluginContext
):
  | { enabled: true; path: string }
  | { enabled: false; path: null | string; reason: string } {
  const panelContext = context.panels.getActiveContext();
  const path =
    panelContext?.worktreeRoot ??
    panelContext?.gitRoot ??
    panelContext?.projectRootPath ??
    panelContext?.cwd ??
    null;
  if (!(path && (panelContext?.worktreeRoot || panelContext?.gitRoot))) {
    return { enabled: false, path, reason: unsupportedReason(context) };
  }
  if (panelContext.worktreeSupported === false) {
    return { enabled: false, path, reason: unsupportedReason(context) };
  }
  return { enabled: true, path };
}

export function itemLabel(worktree: WorktreeItem): string {
  return worktree.branch ?? basename(worktree.path);
}

export function worktreeSearchTerms(worktree: WorktreeItem): readonly string[] {
  return [
    worktree.path,
    basename(worktree.path),
    worktree.branch ?? "",
    worktree.head ?? "",
  ].filter(Boolean);
}

export function openUnavailablePick(
  context: RendererPluginContext,
  reason: string
): void {
  context.commandPalette.openQuickPick({
    items: [{ disabled: true, id: "worktree-unavailable", label: reason }],
    onAccept: () => undefined,
    placeholder: reason,
    title: pluginText(context, "title", "Worktrees"),
  });
}

export function showWorktreeMessage(
  context: RendererPluginContext,
  title: string,
  message: string,
  detail?: string
): void {
  context.commandPalette.openQuickPick({
    items: [
      {
        ...(detail ? { detail } : {}),
        disabled: true,
        id: "worktree-message",
        label: message,
      },
    ],
    onAccept: () => undefined,
    placeholder: message,
    title,
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function confirmQuickPick(
  context: RendererPluginContext,
  title: string,
  message: string,
  confirmLabel: string
): Promise<boolean> {
  return await new Promise((resolve) => {
    context.commandPalette.openQuickPick({
      items: [
        { id: "cancel", label: pluginText(context, "cancel", "Cancel") },
        // 两个调用方 (删除/清理 worktree) 都是破坏性操作, 确认项统一警示色。
        { id: "confirm", label: confirmLabel, variant: "destructive" },
      ],
      onAccept: (item) => {
        resolve(item.id === "confirm");
      },
      onDismiss: () => {
        resolve(false);
      },
      placeholder: message,
      title,
    });
  });
}
