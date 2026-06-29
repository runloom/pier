import { Button } from "@pier/ui/button.tsx";
import type {
  RendererPluginContext,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import type { GitStatus } from "@shared/contracts/git.ts";
import { GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
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

function baseLabel(
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

/**
 * 实时 git status 钩子。订阅主体 git.watch 广播,初值用 git.getStatus 拉一次。
 * 调用 unsubscribe 自动在 cleanup 阶段取消订阅(防止 webContents 内 listener 累积)。
 */
function useGitStatus(
  pluginContext: RendererPluginContext,
  gitRoot: string | undefined
): GitStatus | null {
  const [status, setStatus] = useState<GitStatus | null>(null);

  useEffect(() => {
    if (!gitRoot) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    pluginContext.git
      .getStatus(gitRoot)
      .then((next) => {
        if (!cancelled) {
          setStatus(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus(null);
        }
      });
    const unsubscribe = pluginContext.git.watch(gitRoot, () => {
      pluginContext.git
        .getStatus(gitRoot)
        .then((next) => {
          if (!cancelled) {
            setStatus(next);
          }
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [pluginContext, gitRoot]);

  return status;
}

function formatAheadBehind(status: GitStatus | null): string {
  if (!status) {
    return "";
  }
  const parts: string[] = [];
  if (status.branch.ahead > 0) {
    parts.push(`↑${status.branch.ahead}`);
  }
  if (status.branch.behind > 0) {
    parts.push(`↓${status.branch.behind}`);
  }
  return parts.length > 0 ? ` ${parts.join("")}` : "";
}

function formatChanges(status: GitStatus | null): string {
  if (!status || status.files.length === 0) {
    return "";
  }
  return ` ·${status.files.length}`;
}

function WorktreeStatusItem({
  context,
  cwd,
  pluginContext,
}: RendererTerminalStatusItemContext & {
  pluginContext: RendererPluginContext;
}) {
  const worktreePath = context?.worktreeRoot ?? context?.gitRoot;
  const status = useGitStatus(pluginContext, context?.gitRoot);
  if (!worktreePath) {
    return null;
  }
  const worktreeName = basename(worktreePath);
  if (!worktreeName) {
    return null;
  }
  const label = `${baseLabel(pluginContext, context, worktreeName)}${formatAheadBehind(status)}${formatChanges(status)}`;
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
