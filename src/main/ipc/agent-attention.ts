import type { PierEventBus } from "@main/app-core/event-bus.ts";
import { resolveAttentionLocale } from "@main/services/agent-attention/attention-locale.ts";
import type { AgentAttentionService } from "@main/services/agent-attention/attention-service.ts";
import { createAgentAttentionService } from "@main/services/agent-attention/attention-service.ts";
import { maybePlayAfterShown } from "@main/services/agent-attention/notification-audio.ts";
import { focusAgentFromNotificationClick } from "@main/services/agent-attention/notification-click-focus.ts";
import {
  getAgentAttentionSettingsCached,
  initAgentAttentionSettingsCache,
} from "@main/services/agent-attention/settings-cache.ts";
import type { AgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import type { ForegroundActivityBroadcast } from "@shared/contracts/foreground-activity.ts";
import { createLogger } from "@shared/logger.ts";
import {
  broadcastAgentAttentionDegraded,
  broadcastSystemNotificationPermissionChanged,
  sendAttentionSoundPlayToOneWindow,
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

/** 拥有该智能体面板的 BrowserWindow 是否聚焦（ready / unfocused）。 */
function isOwnerWindowFocused(electronWindowId: string): boolean {
  const win = windowManager
    .getAll()
    .find((w) => String(w.id) === electronWindowId);
  return Boolean(win && !win.isDestroyed() && win.isFocused());
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

  initAgentAttentionSettingsCache({
    ...(args.eventBus ? { eventBus: args.eventBus } : {}),
    readPreferences,
    onBootReadError: (err) => {
      log.debug("boot attention settings read failed; using product defaults", {
        err,
      });
    },
  });

  const attention = createAgentAttentionService({
    isTargetPanelFocused,
    isOwnerWindowFocused,
    resolveLocale: resolveAttentionLocale,
    settings: () => getAgentAttentionSettingsCached(),
    showNotification: (request, audio) =>
      showSystemNotification(request, {
        ...(audio?.silent === undefined ? {} : { silent: audio.silent }),
        ...(audio?.sound === undefined ? {} : { sound: audio.sound }),
        onClick: (shown) => focusAgentFromNotificationClick(args.index, shown),
        onPermissionChanged: (snapshot) => {
          // 权限恢复后复位 latch：再次降级时用户仍能收到一次提示。
          if (snapshot.status === "authorized") {
            degradedBroadcasted = false;
          }
          broadcastSystemNotificationPermissionChanged(snapshot);
        },
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
    playAttentionSound: (decision) => {
      maybePlayAfterShown({
        decision,
        force: false,
        sendToWindow: sendAttentionSoundPlayToOneWindow,
      });
    },
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
