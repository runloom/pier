import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type { ForegroundActivityBroadcast } from "@shared/contracts/foreground-activity.ts";
import { createLogger } from "@shared/logger.ts";
import {
  buildTerminalEscapeCancelEvent,
  shouldCancelAgentOnTerminalEscape,
} from "../../services/agents/terminal-escape-cancel.ts";
import type { AgentEventIngestOptions } from "../../services/foreground-activity/types.ts";
import { findAppWindowByElectronId } from "../../windows/identity.ts";
import { foregroundActivityService } from "../foreground-activity.ts";
import { recordNativeTerminalRoute } from "./debug.ts";
import type { NativeAddon } from "./native-addon.ts";
import { fromNativePanelKey } from "./panel-id.ts";

const log = createLogger("terminal-agent-escape-cancel");

export interface TerminalAgentEscapeCancelHost {
  ingestAgentEvent(
    event: AgentHookEventPayload,
    options: AgentEventIngestOptions
  ): boolean;
  snapshot(windowId?: string): ForegroundActivityBroadcast;
}

/**
 * 裸 Esc → 若该 panel 智能体在 processing/tool/running，注入 TurnInterrupted。
 *
 * 解决 Claude Esc 常不写 transcript 中断标记、也不打 Stop 时底栏卡「思考中」。
 * 不消费 Esc：原生仍把键交给 TUI。
 *
 * FA / hook 键约定：windowId = `String(BrowserWindow.id)`（与 PIER_WINDOW_ID 同）。
 * 同步绑定（同 create-handler / transfer-guards）；无 boot 竞态。
 */
export function wireTerminalAgentEscapeCancel(addon: NativeAddon | null): void {
  registerTerminalAgentEscapeCancel({
    addon,
    host: foregroundActivityService,
  });
}

export function registerTerminalAgentEscapeCancel(input: {
  addon: NativeAddon | null;
  host: TerminalAgentEscapeCancelHost;
}): void {
  const { addon, host } = input;
  if (!addon?.setBareEscapeForwardCallback) {
    return;
  }
  addon.setBareEscapeForwardCallback((browserWindowId, nativePanelId) => {
    try {
      const panelId = fromNativePanelKey(nativePanelId);
      recordNativeTerminalRoute(browserWindowId, "bare-escape", panelId, {});
      const win = findAppWindowByElectronId(browserWindowId);
      if (!(win && !win.isDestroyed())) {
        return;
      }
      // 与 hook / FA 一致：Electron BrowserWindow.id 数字串。
      const windowId = String(win.id);
      const activity = host
        .snapshot(windowId)
        .activities.find((entry) => entry.panelId === panelId);
      if (!shouldCancelAgentOnTerminalEscape(activity)) {
        return;
      }
      const event = buildTerminalEscapeCancelEvent({
        agentId: activity.agentId,
        panelId,
        windowId,
        sessionId: activity.sessionId,
      });
      const accepted = host.ingestAgentEvent(event, {
        // 宿主合成终态：硬封。不得复用 transcript（软封会被迟到 ToolComplete 解开）。
        evidenceSource: "host",
        stopAuthority: "authoritative",
        turnStartAuthority: "none",
      });
      if (accepted) {
        log.info("agent cancelled via terminal escape", {
          agentId: activity.agentId,
          panelId,
          windowId,
          sessionId: activity.sessionId,
        });
      }
    } catch (err) {
      log.warn("terminal escape cancel failed", { err });
    }
  });
}
