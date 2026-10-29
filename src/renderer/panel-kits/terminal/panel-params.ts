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
import type { TerminalFrame } from "@shared/contracts/terminal.ts";

export interface ActiveTerminalLaunch {
  context?: PanelContext | undefined;
  initialInput?: string | undefined;
  initialInputSubmit?: boolean | undefined;
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

export function backgroundCreateFromParams(params: unknown): boolean {
  return (
    !!params &&
    typeof params === "object" &&
    "backgroundCreate" in params &&
    params.backgroundCreate === true
  );
}

/**
 * 后台隐藏面板（backgroundCreate 且不可见）surface 原生层 offscreen+hidden，
 * 无法等到真实可见帧，用合成 frame 先行 spawn 原生终端；真实 frame 由首次
 * applyTerminalWindowState 可见性快照贴上。
 */
export const SYNTHETIC_BACKGROUND_FRAME: TerminalFrame = {
  height: 800,
  width: 1200,
  x: 0,
  y: 0,
};
