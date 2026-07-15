import type { AgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import type { IpcMain } from "electron";
import { registerAgentAttention } from "./agent-attention.ts";
import { registerAgentRuntimeIndexIpc } from "./agent-runtime-index.ts";
import {
  bindNotificationFocus,
  registerNotificationIpc,
} from "./notification.ts";

/** Agent Runtime Index + Attention + system notification click→focus wiring. */
export function registerAgentRuntimeHostIpc(
  ipcMain: IpcMain,
  index: AgentRuntimeIndexService
): void {
  registerAgentRuntimeIndexIpc(ipcMain, index);
  registerAgentAttention({ index });
  registerNotificationIpc(ipcMain, bindNotificationFocus(index));
}
