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
  const cwdName = basename(cwd);
  if (!worktreeName) {
    return null;
  }
  const branch = context?.branch;
  const cwdSuffix =
    cwdName && cwdName !== worktreeName ? (
      <span className="truncate text-muted-foreground/70">/{cwdName}</span>
    ) : null;

  return (
    <button
      aria-label={pluginContext.i18n.t(
        "ui.statusOpenLabel",
        { name: worktreeName },
        `Open worktrees for ${worktreeName}`
      )}
      className="flex min-w-0 items-center gap-1.5 rounded-sm px-1 text-left hover:bg-muted"
      onClick={() => {
        openWorktreeListQuickPick(pluginContext, worktreePath).catch(
          (err: unknown) => {
            console.error("[worktree-plugin] open worktree list failed:", err);
          }
        );
      }}
      title={`${worktreePath}${branch ? ` · ${branch}` : ""}${cwd ? ` · ${cwd}` : ""}`}
      type="button"
    >
      <GitBranch className="size-3.5 shrink-0 text-muted-foreground/70" />
      <span className="truncate font-medium text-foreground/80">
        {worktreeName}
      </span>
      {branch ? (
        <span className="truncate text-muted-foreground/80">{branch}</span>
      ) : null}
      {cwdSuffix}
    </button>
  );
}

export function registerWorktreeStatusItem(
  context: RendererPluginContext
): () => void {
  return context.terminalStatusItems.register({
    id: "pier.worktree.status",
    order: 10,
    render: (statusContext) => (
      <WorktreeStatusItem {...statusContext} pluginContext={context} />
    ),
  });
}
