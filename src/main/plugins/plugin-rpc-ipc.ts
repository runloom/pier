import { pluginRpcInvokeRequestSchema } from "@shared/contracts/plugin-rpc.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { ipcMain } from "electron";
import { windowManager } from "../windows/window-manager.ts";
import type { PluginRpcBus } from "./plugin-rpc-bus.ts";

/**
 * Renderer → main plugin RPC IPC handler (plan Task 5 step 6).
 * Dedicated channel — NOT routed through PIER.COMMAND_EXECUTE, so CLI
 * local-control cannot invoke plugin RPC.
 *
 * Only renderer webContents owned by Pier BrowserWindows may invoke.
 */

export function registerPluginRpcIpc(rpcBus: PluginRpcBus): void {
  ipcMain.handle(PIER.PLUGIN_RPC_INVOKE, async (event, rawPayload: unknown) => {
    // Reject invocations from unauthorized frames.
    const sender = event.sender;
    if (
      event.senderFrame !== sender.mainFrame ||
      !windowManager.fromWebContents(sender)
    ) {
      return {
        error: { code: "invalid_request", message: "unrecognized webContents" },
        ok: false,
      };
    }
    const parsed = pluginRpcInvokeRequestSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return {
        error: { code: "invalid_request", message: parsed.error.message },
        ok: false,
      };
    }
    return rpcBus.invoke(parsed.data);
  });
}
