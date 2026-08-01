import {
  type PanelContext,
  type PanelTabChrome,
  panelContextSchema,
} from "@shared/contracts/panel.ts";
import {
  type TaskOutputPanelParams,
  type TaskPanelMetadata,
  taskOutputPanelParamsSchema,
} from "@shared/contracts/tasks.ts";

export interface ActiveTerminalLaunch {
  context?: PanelContext | undefined;
  initialInput?: string | undefined;
  launchId?: string | undefined;
  sequence: number;
  tab?: PanelTabChrome | undefined;
  task?: TaskPanelMetadata | undefined;
  taskOutput?: TaskOutputPanelParams | undefined;
}

export function taskOutputFromParams(
  params: unknown
): TaskOutputPanelParams | undefined {
  if (!params || typeof params !== "object" || !("taskOutput" in params)) {
    return;
  }
  const parsed = taskOutputPanelParamsSchema.safeParse(params.taskOutput);
  return parsed.success ? parsed.data : undefined;
}

export function panelContextFromParams(
  params: unknown
): PanelContext | undefined {
  if (!params || typeof params !== "object" || !("context" in params)) {
    return;
  }
  const parsed = panelContextSchema.safeParse(params.context);
  return parsed.success ? parsed.data : undefined;
}

export function launchIdFromParams(params: unknown): string | undefined {
  if (!params || typeof params !== "object" || !("launchId" in params)) {
    return;
  }
  const launchId = params.launchId;
  return typeof launchId === "string" && launchId.length > 0
    ? launchId
    : undefined;
}
