import {
  isWorkspaceLifecycleCommand,
  runWorkspaceLifecycleCommand,
} from "./workspace-lifecycle-commands.ts";
import { runWorkspaceRendererCommand } from "./workspace-renderer-commands.ts";

/**
 * renderer command listener 属于宿主启动链，不依赖 Dockview onReady。
 * Workspace 尚未就绪时命令会立即返回结构化失败，避免 main 等到 15 秒超时。
 */
export function installWorkspaceRendererCommandListener(): () => void {
  return window.pier.rendererCommand.onCommand((envelope) => {
    if (isWorkspaceLifecycleCommand(envelope)) {
      runWorkspaceLifecycleCommand(envelope).catch((error) => {
        console.error("[workspace] lifecycle command failed:", error);
      });
      return;
    }
    runWorkspaceRendererCommand(envelope);
  });
}
