import type { PierCommand } from "@shared/contracts/commands.ts";
import type { PanelContext, PanelTabChrome } from "@shared/contracts/panel.ts";
import type { RendererCommand } from "@shared/contracts/renderer-command.ts";
import type {
  TaskPanelMetadata,
  TaskPanelRef,
} from "@shared/contracts/tasks.ts";
import type { ProcessEnvironmentSource } from "../services/process-environment-service.ts";

export interface TerminalOpenOptions {
  clientEnv?: Record<string, string> | undefined;
  initialInput?: string | undefined;
  reusePanel?: TaskPanelRef | undefined;
  source?: ProcessEnvironmentSource | undefined;
  tab?: PanelTabChrome;
  task?: TaskPanelMetadata;
}

export function rendererTerminalOpenCommand(args: {
  command: Extract<PierCommand, { type: "terminal.open" }>;
  context: PanelContext | undefined;
  launchId: string;
  options: TerminalOpenOptions;
  windowId: string;
}): Extract<RendererCommand, { type: "terminal.open" }> {
  return {
    ...(args.context && { context: args.context }),
    focus: args.command.focus,
    ...(args.options.initialInput && {
      initialInput: args.options.initialInput,
    }),
    launchId: args.launchId,
    ...(args.options.reusePanel
      ? { panelId: args.options.reusePanel.panelId }
      : {}),
    ...(args.command.placement && { placement: args.command.placement }),
    ...(args.options.tab && { tab: args.options.tab }),
    ...(args.options.task && { task: args.options.task }),
    type: "terminal.open",
    windowId: args.windowId,
  };
}
