import type { AgentAttentionService } from "@main/services/agent-attention/attention-service.ts";
import { createAgentAttentionService } from "@main/services/agent-attention/attention-service.ts";
import { focusAgentFromNotificationClick } from "@main/services/agent-attention/notification-click-focus.ts";
import type { AttentionUiLocale } from "@main/services/agent-attention/notification-copy.ts";
import type { AgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import type { ForegroundActivityBroadcast } from "@shared/contracts/foreground-activity.ts";
import { createLogger } from "@shared/logger.ts";
import { app } from "electron";
import { broadcastAgentAttentionDegraded } from "../app-core/window-broadcasts.ts";
import { showSystemNotification } from "../services/system-notification.ts";
import { readPreferences } from "../state/preferences.ts";
import { windowManager } from "../windows/window-manager.ts";
import { onForegroundActivityPublished } from "./foreground-activity.ts";
import { terminalFocusCoordinator } from "./terminal-focus-coordinator.ts";

const log = createLogger("agent-attention.ipc");

export interface RegisterAgentAttentionArgs {
  index: AgentRuntimeIndexService;
}

function isTargetPanelFocused(
  electronWindowId: string,
  panelId: string
): boolean {
  const focused = windowManager.getFocused();
  if (!focused || focused.isDestroyed()) {
    return false;
  }
  if (String(focused.id) !== electronWindowId) {
    return false;
  }
  return terminalFocusCoordinator.activePanelId(focused) === panelId;
}

function localeFromSystem(): AttentionUiLocale {
  return app.getLocale().toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

async function resolveAttentionLocale(): Promise<AttentionUiLocale> {
  try {
    const prefs = await readPreferences();
    if (prefs.language === "zh-CN") {
      return "zh-CN";
    }
    if (prefs.language === "en") {
      return "en";
    }
  } catch (err) {
    log.debug("read preferences for attention locale failed", { err });
  }
  return localeFromSystem();
}

/**
 * 挂 FA 发布钩子：Attention 消费本机 status 变迁并发系统通知。
 * 通知 click 与 notification IPC 共用 `focusAgentFromNotificationClick`。
 */
export function registerAgentAttention(
  args: RegisterAgentAttentionArgs
): AgentAttentionService {
  let degradedBroadcasted = false;

  const attention = createAgentAttentionService({
    isTargetPanelFocused,
    resolveLocale: resolveAttentionLocale,
    showNotification: (request) =>
      showSystemNotification(request, {
        onClick: (shown) => focusAgentFromNotificationClick(args.index, shown),
        onUnavailable: (reason) => {
          if (reason !== "denied" && reason !== "unsupported") {
            return;
          }
          if (degradedBroadcasted) {
            return;
          }
          degradedBroadcasted = true;
          broadcastAgentAttentionDegraded({ reason });
        },
      }),
  });

  let previous: ForegroundActivityBroadcast | null = null;
  onForegroundActivityPublished((next) => {
    const prior = previous;
    previous = next;
    attention.observe(prior, next).catch((err: unknown) => {
      log.error("attention observe failed", { err });
    });
  });

  return attention;
}
