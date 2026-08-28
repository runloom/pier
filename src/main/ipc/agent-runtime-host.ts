import type { PierEventBus } from "@main/app-core/event-bus.ts";
import type { PendingInteractionRegistry } from "@main/services/agent-attention/pending-interactions.ts";
import type { AgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import type { IpcMain } from "electron";
import { registerAgentAttention } from "./agent-attention.ts";
import { registerAgentRuntimeIndexIpc } from "./agent-runtime-index.ts";
import {
  bindNotificationFocus,
  registerNotificationIpc,
} from "./notification.ts";
import { bindNotificationCenterRuntimeIndex } from "./notification-center.ts";

export interface RegisterAgentRuntimeHostIpcArgs {
  eventBus?: PierEventBus;
  index: AgentRuntimeIndexService;
  /** M1：共享未决交互注册表（透传 registerAgentAttention）。 */
  pendingInteractions?: PendingInteractionRegistry;
}

/** Agent Runtime Index + Attention + system notification click→focus wiring. */
export function registerAgentRuntimeHostIpc(
  ipcMain: IpcMain,
  args: RegisterAgentRuntimeHostIpcArgs
): void {
  registerAgentRuntimeIndexIpc(ipcMain, args.index);
  bindNotificationCenterRuntimeIndex(args.index);
  registerAgentAttention({
    index: args.index,
    ...(args.eventBus ? { eventBus: args.eventBus } : {}),
    ...(args.pendingInteractions
      ? { pendingInteractions: args.pendingInteractions }
      : {}),
  });
  registerNotificationIpc(ipcMain, bindNotificationFocus(args.index));
}
