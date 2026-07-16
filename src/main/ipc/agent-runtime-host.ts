import type { PierEventBus } from "@main/app-core/event-bus.ts";
import type { AgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import type { IpcMain } from "electron";
import { registerAgentAttention } from "./agent-attention.ts";
import { registerAgentRuntimeIndexIpc } from "./agent-runtime-index.ts";
import {
  bindNotificationFocus,
  registerNotificationIpc,
} from "./notification.ts";

export interface RegisterAgentRuntimeHostIpcArgs {
  eventBus?: PierEventBus;
  index: AgentRuntimeIndexService;
}

/** Agent Runtime Index + Attention + system notification click→focus wiring. */
export function registerAgentRuntimeHostIpc(
  ipcMain: IpcMain,
  args: RegisterAgentRuntimeHostIpcArgs
): void {
  registerAgentRuntimeIndexIpc(ipcMain, args.index);
  registerAgentAttention({
    index: args.index,
    ...(args.eventBus ? { eventBus: args.eventBus } : {}),
  });
  registerNotificationIpc(ipcMain, bindNotificationFocus(args.index));
}
