import { Button } from "@pier/ui/button.tsx";
import type {
  RendererPluginContext,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import { GitBranch } from "lucide-react";
import { openWorktreeListQuickPick } from "./worktree-list-action.ts";

const PATH_SEPARATOR_RE = /[\\/]/;

function basename(path: null | string | undefined): string {
  if (!path) {
    return "";
  }
  const parts = path.split(PATH_SEPARATOR_RE).filter(Boolean);
  return parts.at(-1) ?? path;
}

function pluginText(
  context: RendererPluginContext,
  key: string,
  fallback: string,
  values?: Record<string, number | string>
): string {
  return context.i18n.t(`ui.${key}`, values, fallback);
}

function shortHead(head: string | undefined): string | undefined {
  return head ? head.slice(0, 7) : undefined;
}

function statusLabel(
  pluginContext: RendererPluginContext,
  panelContext: RendererTerminalStatusItemContext["context"],
  worktreeName: string
): string {
  if (panelContext?.branch) {
    return panelContext.branch;
  }
  const head = shortHead(panelContext?.head);
  if (head) {
    return pluginText(pluginContext, "detached", "detached {{head}}", {
      head,
    });
  }
  return worktreeName;
}

function WorktreeStatusItem({
  context,
  cwd,
  pluginContext,
}: RendererTerminalStatusItemContext & {
  pluginContext: RendererPluginContext;
}) {
  const worktreePath = context?.worktreeRoot ?? context?.gitRoot;
  if (!worktreePath) {
    return null;
  }
  const worktreeName = basename(worktreePath);
  if (!worktreeName) {
    return null;
  }
  const label = statusLabel(pluginContext, context, worktreeName);
  const title = [worktreeName, context?.branch, worktreePath, cwd]
    .filter(Boolean)
    .join(" · ");

  return (
    <Button
      aria-label={pluginText(
        pluginContext,
        "statusOpenLabel",
        "Open worktrees for {{name}}",
        { name: label }
      )}
      className="h-5"
      data-testid="worktree-status-trigger"
      onClick={() => {
        openWorktreeListQuickPick(pluginContext, worktreePath).catch(
          (err: unknown) => {
            console.error("[worktree-plugin] open worktree list failed:", err);
          }
        );
      }}
      size="xs"
      title={title}
      type="button"
      variant="outline"
    >
      <GitBranch />
      {label}
    </Button>
  );
}

export function registerWorktreeStatusItem(
  context: RendererPluginContext
): () => void {
  return context.terminalStatusItems.register({
    id: "pier.worktree.status",
    isVisible: ({ context: panelContext }) =>
      Boolean(
        panelContext?.worktreeRoot ??
          (panelContext?.worktreeSupported === false
            ? undefined
            : panelContext?.gitRoot)
      ),
    order: 10,
    render: (statusContext) => (
      <WorktreeStatusItem {...statusContext} pluginContext={context} />
    ),
  });
}
