import { managedPluginSandboxAuditSchema } from "@shared/contracts/plugin/managed.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { ipcMain } from "electron";
import type {
  ManagedPluginOperationLog,
  ManagedPluginOperationLogRecord,
} from "../services/managed-plugins/operation-log.ts";
import { windowManager } from "../windows/manager.ts";

const MAX_AUDIT_RECORDS_PER_SENDER = 50;

/**
 * 沙箱轨审计 IPC（Phase 2 M3）：renderer 能力桥的 denied/frozen/disposed
 * 安全事件追加进插件操作日志。每窗口限流，防止恶意刷日志。
 */
export function registerSandboxAuditIpc(log: ManagedPluginOperationLog): void {
  const countsBySender = new Map<string, number>();
  ipcMain.handle(
    PIER.PLUGIN_SANDBOX_AUDIT,
    async (event, rawPayload: unknown) => {
      if (event.senderFrame !== event.sender.mainFrame) {
        throw new Error("sandbox audit sender is not the main frame");
      }
      const window = windowManager.fromWebContents(event.sender);
      const windowId = window
        ? windowManager.findInternalIdByWindow(window)
        : null;
      if (!windowId) {
        throw new Error("sandbox audit sender is not a Pier window");
      }
      const senderKey = String(event.sender.id);
      const count = countsBySender.get(senderKey) ?? 0;
      if (count >= MAX_AUDIT_RECORDS_PER_SENDER) {
        return;
      }
      countsBySender.set(senderKey, count + 1);

      const payload = managedPluginSandboxAuditSchema.parse(rawPayload);
      const operationByEvent = {
        "call-denied": "sandbox.call-denied",
        disposed: "sandbox.disposed",
        frozen: "sandbox.frozen",
      } as const;
      const record: ManagedPluginOperationLogRecord = {
        actorKind: "desktop-renderer",
        operation: operationByEvent[payload.event],
        pluginId: payload.pluginId,
        result:
          payload.event === "disposed"
            ? ("success" as const)
            : ("denied" as const),
        timestamp: Date.now(),
        ...(payload.detail
          ? { diagnosticId: payload.detail.slice(0, 200) }
          : {}),
        ...(payload.version ? { toVersion: payload.version } : {}),
      };
      await log.append(record);
    }
  );
}
