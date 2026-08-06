import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CloudDownload,
  RefreshCw,
  Upload,
} from "lucide-react";
import {
  commandTitle,
  disabledReasonForActiveGit,
  enabledForActiveGit,
  showError,
  showUnavailable,
} from "./command-helpers.ts";
import { pluginText } from "./plugin-text.ts";
import {
  mismatchMessageForCommand,
  type RemoteSyncActionId,
  resolvePushCommand,
  resolveRemoteSyncActionId,
} from "./remote-sync-policy.ts";
import {
  type GitRemoteSyncActionId,
  runRemoteSyncAction,
} from "./status-dropdown-actions.ts";
import { activeGitTarget } from "./target.ts";

async function gateExactAction(
  context: RendererPluginContext,
  cwd: string,
  expected: RemoteSyncActionId
): Promise<null | string> {
  try {
    const actual = resolveRemoteSyncActionId(await context.git.getStatus(cwd));
    const mismatch = mismatchMessageForCommand(expected, actual);
    if (!mismatch) {
      return null;
    }
    return pluginText(context, mismatch.key, mismatch.fallback);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Start remote sync under loading toast without awaiting completion.
 * Command palette closes when the handler returns; keeping await would pin
 * the palette open for the whole network round-trip (status dropdown already
 * dismisses first, then fire-and-forgets).
 */
function startRemoteSyncFromPalette(
  context: RendererPluginContext,
  actionId: GitRemoteSyncActionId,
  cwd: string,
  title: string
): void {
  // Fire-and-forget so the command palette closes immediately; errors surface
  // after runRemoteSyncAction dismisses its loading toast.
  runRemoteSyncAction(context, actionId, cwd).catch((err: unknown) => {
    showError(context, title, err).catch(() => undefined);
  });
}

function registerRemotePaletteAction(
  context: RendererPluginContext,
  options: {
    actionId: GitRemoteSyncActionId;
    commandId: string;
    /** 固定动作门控；omit = 仅需有 git 目标（如 fetch） */
    expectedGate?: RemoteSyncActionId;
    fallbackTitle: string;
    icon: typeof ArrowDownToLine;
    sortOrder: number;
  }
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(
        context,
        options.commandId,
        options.fallbackTitle
      );
      const target = activeGitTarget(context);
      if (!target.enabled) {
        return;
      }
      const cwd = target.target.cwd;
      if (options.expectedGate) {
        const blocked = await gateExactAction(
          context,
          cwd,
          options.expectedGate
        );
        if (blocked) {
          await showUnavailable(context, title, blocked);
          return;
        }
      }
      startRemoteSyncFromPalette(context, options.actionId, cwd, title);
    },
    id: options.commandId,
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: options.icon,
      sortOrder: options.sortOrder,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(context, options.commandId, options.fallbackTitle),
  });
}

function registerPushPaletteAction(context: RendererPluginContext): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(context, "pier.git.push", "Git: Push");
      const target = activeGitTarget(context);
      if (!target.enabled) {
        return;
      }
      const cwd = target.target.cwd;
      try {
        const resolved = resolvePushCommand(await context.git.getStatus(cwd));
        if (resolved.kind === "refuse") {
          await showUnavailable(
            context,
            title,
            pluginText(context, resolved.message.key, resolved.message.fallback)
          );
          return;
        }
        startRemoteSyncFromPalette(context, resolved.action, cwd, title);
      } catch (err) {
        await showError(context, title, err);
      }
    },
    id: "pier.git.push",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: ArrowUpFromLine,
      sortOrder: 22,
    },
    surfaces: ["command-palette"],
    title: () => commandTitle(context, "pier.git.push", "Git: Push"),
  });
}

export function registerGitRemotePaletteActions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    registerRemotePaletteAction(context, {
      actionId: "fetch",
      commandId: "pier.git.fetch",
      fallbackTitle: "Git: Fetch",
      icon: CloudDownload,
      sortOrder: 20,
    }),
    registerRemotePaletteAction(context, {
      actionId: "pull",
      commandId: "pier.git.pull",
      expectedGate: "pull",
      fallbackTitle: "Git: Pull",
      icon: ArrowDownToLine,
      sortOrder: 21,
    }),
    registerPushPaletteAction(context),
    registerRemotePaletteAction(context, {
      actionId: "publish",
      commandId: "pier.git.publish",
      expectedGate: "publish",
      fallbackTitle: "Git: Publish Branch",
      icon: Upload,
      sortOrder: 23,
    }),
    registerRemotePaletteAction(context, {
      actionId: "syncChanges",
      commandId: "pier.git.sync",
      expectedGate: "syncChanges",
      fallbackTitle: "Git: Sync",
      icon: RefreshCw,
      sortOrder: 24,
    }),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
