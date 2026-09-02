import type {
  RendererPluginAction,
  RendererPluginPanelOpenOptions,
} from "@pier/plugin-api/renderer";
import { panelContextSchema } from "@shared/contracts/panel.ts";
import {
  projectPathActionDisabledReason,
  projectPathActionEnabled,
} from "@/lib/actions/project-path-action-gate.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { openPluginPanel } from "@/lib/plugins/host/panels-context.ts";

function resolveTitle(title: string | (() => string)): string {
  return typeof title === "function" ? title() : title;
}

export function registerExternalPluginAction(
  pluginId: string,
  action: RendererPluginAction
): () => void {
  const surfaces: Array<"command-palette" | "create-menu"> =
    action.surfaces && action.surfaces.length > 0
      ? [...action.surfaces]
      : ["command-palette"];
  const wantsCreateMenu = surfaces.includes("create-menu");
  return actionRegistry.register({
    category: action.category ?? (wantsCreateMenu ? "panel" : "run"),
    ...(wantsCreateMenu
      ? {
          disabledReason: projectPathActionDisabledReason,
          enabled: projectPathActionEnabled,
          metadata: {
            categoryKey: "panel" as const,
            group: "1_new",
            sortOrder: 40,
          },
        }
      : {}),
    handler: (invocation) =>
      Promise.resolve(
        action.invoke({
          ...(invocation?.sourcePanelGroupId
            ? { sourcePanelGroupId: invocation.sourcePanelGroupId }
            : {}),
          ...(invocation?.sourcePanelContext
            ? { sourcePanelContext: invocation.sourcePanelContext }
            : {}),
        })
      ).catch((err: unknown) => {
        console.error(`[${pluginId}] action ${action.id} failed:`, err);
        throw err;
      }),
    id: action.id,
    surfaces: [...surfaces],
    title: () => resolveTitle(action.title),
  });
}

export function openDeclaredPluginPanel(
  panelId: string,
  options?: RendererPluginPanelOpenOptions
): void {
  const parsed = options?.sourcePanelContext
    ? panelContextSchema.safeParse({
        ...options.sourcePanelContext,
        source: "command",
        updatedAt: Date.now(),
      })
    : null;
  openPluginPanel(panelId, {
    ...(parsed?.success ? { context: parsed.data } : {}),
    ...(options?.targetGroupId ? { targetGroupId: options.targetGroupId } : {}),
  });
}
