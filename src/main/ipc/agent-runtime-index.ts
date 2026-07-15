import type { AgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import type { IpcMain } from "electron";
import { z } from "zod";
import { broadcastAgentRuntimeIndexChanged } from "../app-core/window-broadcasts.ts";
import { onForegroundActivityPublished } from "./foreground-activity.ts";

const log = createLogger("agent-runtime-index.ipc");

const focusRequestSchema = z
  .object({
    agentRef: z.string().min(1),
  })
  .strict();

const sortOptionsSchema = z
  .object({
    preferredProjectRootPath: z.string().min(1).optional(),
    preferredWindowId: z.string().min(1).max(32).optional(),
  })
  .strict();

/**
 * Agent Runtime Index IPC：
 * - list / focus / focusWaiting — 独立 invoke（不进 PierCommand）
 * - changed — FA 每次发布后对本机 Index 快照全窗 fan-out（双通道纪律）
 */
export function registerAgentRuntimeIndexIpc(
  ipcMain: IpcMain,
  index: AgentRuntimeIndexService
): void {
  ipcMain.handle(PIER.AGENT_RUNTIME_INDEX_LIST, () => index.listMachine());

  ipcMain.handle(PIER.AGENT_RUNTIME_INDEX_FOCUS, async (_event, payload) => {
    const parsed = focusRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        message: "invalid focus request",
        status: "error" as const,
      };
    }
    return index.focus(parsed.data.agentRef);
  });

  ipcMain.handle(PIER.AGENT_RUNTIME_INDEX_FOCUS_WAITING, (_event, payload) => {
    const parsed = sortOptionsSchema.safeParse(payload ?? {});
    return index.focusWaiting(parsed.success ? parsed.data : undefined);
  });

  onForegroundActivityPublished(() => {
    try {
      broadcastAgentRuntimeIndexChanged(index.listMachine());
    } catch (err) {
      log.error("index broadcast failed", { err });
    }
  });
}
