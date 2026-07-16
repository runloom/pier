import type { PierEventBus } from "@main/app-core/event-bus.ts";
import type { AgentAttentionService } from "@main/services/agent-attention/attention-service.ts";
import { createAgentAttentionService } from "@main/services/agent-attention/attention-service.ts";
import { focusAgentFromNotificationClick } from "@main/services/agent-attention/notification-click-focus.ts";
import type { AttentionUiLocale } from "@main/services/agent-attention/notification-copy.ts";
import type { AgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import {
  type AgentAttentionSettings,
  DEFAULT_AGENT_ATTENTION_SETTINGS,
} from "@shared/contracts/agent-attention.ts";
import type { ForegroundActivityBroadcast } from "@shared/contracts/foreground-activity.ts";
import { createLogger } from "@shared/logger.ts";
import { app } from "electron";
import {
  broadcastAgentAttentionDegraded,
  broadcastSystemNotificationPermissionChanged,
} from "../app-core/window-broadcasts.ts";
import { showSystemNotification } from "../services/system-notification.ts";
import { readPreferences } from "../state/preferences.ts";
import { windowManager } from "../windows/window-manager.ts";
import { onForegroundActivityPublished } from "./foreground-activity.ts";
import { terminalFocusCoordinator } from "./terminal-focus-coordinator.ts";

const log = createLogger("agent-attention.ipc");

export interface RegisterAgentAttentionArgs {
  eventBus?: PierEventBus;
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
 * settings 同步缓存：boot read + preferences.changed。
 * boot 完成前 enabled 强制 false，避免用默认值误弹通知。
 */
export function registerAgentAttention(
  args: RegisterAgentAttentionArgs
): AgentAttentionService {
  let degradedBroadcasted = false;
  let settingsReady = false;
  let cachedSettings: AgentAttentionSettings = {
    ...DEFAULT_AGENT_ATTENTION_SETTINGS,
    // 偏好读完前保守：不发系统通知（标题栏 Index 仍可更新）。
    enabled: false,
  };

  readPreferences()
    .then((prefs) => {
      cachedSettings = { ...prefs.agentAttention };
      settingsReady = true;
    })
    .catch((err: unknown) => {
      log.debug("boot attention settings read failed; using product defaults", {
        err,
      });
      cachedSettings = { ...DEFAULT_AGENT_ATTENTION_SETTINGS };
      settingsReady = true;
    });

  args.eventBus?.subscribe((event) => {
    if (event.type !== "preferences.changed") {
      return;
    }
    if (!event.changedKeys.includes("agentAttention")) {
      return;
    }
    cachedSettings = { ...event.snapshot.agentAttention };
    settingsReady = true;
  });

  const attention = createAgentAttentionService({
    isTargetPanelFocused,
    resolveLocale: resolveAttentionLocale,
    settings: () => {
      if (!settingsReady) {
        return { ...cachedSettings, enabled: false };
      }
      return cachedSettings;
    },
    showNotification: (request) =>
      showSystemNotification(request, {
        onClick: (shown) => focusAgentFromNotificationClick(args.index, shown),
        onPermissionChanged: broadcastSystemNotificationPermissionChanged,
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
