import type { PierCommandPlacement } from "@shared/contracts/commands.ts";
import type { TerminalLaunchOptions } from "@shared/contracts/terminal-launch.ts";
import { invokePierCommand } from "./ipc-envelope.ts";

/**
 * terminals 子命名空间 — 面向插件/宿主业务的「打开终端 panel」高层入口。
 * 与 window.pier.terminal（原生 surface 控制面）区分：这里走 PierCommand
 * `terminal.open`，由 main 侧解析 launch/profile/env 并路由到目标窗口。
 */

export interface TerminalOpenPanelRequest {
  focus?: boolean;
  launch?: TerminalLaunchOptions;
  placement?: PierCommandPlacement;
  windowId?: string;
}

export interface TerminalOpenPanelResult {
  panelId: string;
  windowId: string;
}

export interface PierTerminalsAPI {
  open(request?: TerminalOpenPanelRequest): Promise<TerminalOpenPanelResult>;
}

export const terminalsApi: PierTerminalsAPI = {
  open: (request = {}) =>
    invokePierCommand<TerminalOpenPanelResult>({
      ...(request.focus !== undefined && { focus: request.focus }),
      ...(request.launch && { launch: request.launch }),
      ...(request.placement && { placement: request.placement }),
      ...(request.windowId && { windowId: request.windowId }),
      type: "terminal.open",
    }),
};
