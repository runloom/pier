import type { PierCommand } from "@shared/contracts/commands.ts";
import type { TerminalExitPresentation } from "@shared/contracts/ghostty-host-copy.ts";
import type { PanelContext, PanelTabChrome } from "@shared/contracts/panel.ts";
import type { RendererCommand } from "@shared/contracts/renderer-command.ts";
import type {
  TaskPanelMetadata,
  TaskPanelRef,
} from "@shared/contracts/tasks.ts";
import type { ProcessEnvironmentSource } from "../services/process-environment-service.ts";

export interface TerminalOpenOptions {
  clientEnv?: Record<string, string> | undefined;
  exitPresentation?: TerminalExitPresentation | undefined;
  initialInput?: string | undefined;
  initialInputSubmit?: boolean | undefined;
  reusePanel?: TaskPanelRef | undefined;
  source?: ProcessEnvironmentSource | undefined;
  tab?: PanelTabChrome;
  targetGroupId?: string | undefined;
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
    ...(args.options.exitPresentation && {
      exitPresentation: args.options.exitPresentation,
    }),
    ...(args.command.backgroundCreate && {
      backgroundCreate: args.command.backgroundCreate,
    }),
    focus: args.command.focus,
    ...(args.options.initialInput && {
      initialInput: args.options.initialInput,
    }),
    ...(args.options.initialInputSubmit !== undefined && {
      initialInputSubmit: args.options.initialInputSubmit,
    }),
    launchId: args.launchId,
    ...((args.options.reusePanel?.panelId ?? args.command.panelId)
      ? {
          panelId: args.options.reusePanel?.panelId ?? args.command.panelId,
        }
      : {}),
    ...(args.command.placement && { placement: args.command.placement }),
    ...(args.command.referencePanelId && {
      referencePanelId: args.command.referencePanelId,
    }),
    ...(args.options.tab && { tab: args.options.tab }),
    ...(args.options.task && { task: args.options.task }),
    ...(args.options.targetGroupId && {
      targetGroupId: args.options.targetGroupId,
    }),
    type: "terminal.open",
    windowId: args.windowId,
  };
}
