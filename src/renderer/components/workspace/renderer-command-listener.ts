import {
  isWorkspaceLifecycleCommand,
  runWorkspaceLifecycleCommand,
} from "./lifecycle-commands.ts";
import { runWorkspaceRendererCommand } from "./renderer-commands.ts";
import { runPanelTransferRendererCommand } from "./transfer/index.ts";

function isPanelTransferCommand(type: string): boolean {
  return (
    type === "panelTransfer.prepareSource" ||
    type === "panelTransfer.stageTarget" ||
    type === "panelTransfer.releaseSource" ||
    type === "panelTransfer.finalize" ||
    type === "panelTransfer.resolvePlacement" ||
    type === "panelTransfer.probeWorkspace"
  );
}

/**
 * renderer command listener 属于宿主启动链，不依赖 Dockview onReady。
 * Workspace 尚未就绪时命令会立即返回结构化失败，避免 main 等到 15 秒超时。
 * panelTransfer.* 命令走 panel-transfer 通道（需要 workspace api + runtime）。
 */
export function installWorkspaceRendererCommandListener(): () => void {
  return window.pier.rendererCommand.onCommand((envelope) => {
    if (isWorkspaceLifecycleCommand(envelope)) {
      runWorkspaceLifecycleCommand(envelope).catch((error) => {
        console.error("[workspace] lifecycle command failed:", error);
      });
      return;
    }
    if (isPanelTransferCommand(envelope.command.type)) {
      runPanelTransferRendererCommand(envelope).catch((error) => {
        const command = envelope.command as {
          transferId?: unknown;
          type: string;
        };
        const parts = [
          "[workspace] panelTransfer command failed:",
          `type=${command.type}`,
        ];
        if (typeof command.transferId === "string") {
          parts.push(`transferId=${command.transferId}`);
        }
        console.error(...parts, error);
      });
      return;
    }
    runWorkspaceRendererCommand(envelope);
  });
}
