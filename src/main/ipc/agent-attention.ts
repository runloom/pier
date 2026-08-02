import type { PierEventBus } from "@main/app-core/event-bus.ts";
import { resolveAttentionLocale } from "@main/services/agent-attention/locale.ts";
import type { AgentAttentionService } from "@main/services/agent-attention/service.ts";
import { createAgentAttentionService } from "@main/services/agent-attention/service.ts";
import {
  getAgentAttentionSettingsCached,
  initAgentAttentionSettingsCache,
} from "@main/services/agent-attention/settings-cache.ts";
import type { AgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import { makeAgentRef } from "@shared/contracts/agent/runtime-index.ts";
import type { ForegroundActivityBroadcast } from "@shared/contracts/foreground-activity.ts";
import { createLogger } from "@shared/logger.ts";
import { readPreferences } from "../state/preferences.ts";
import { onForegroundActivityPublished } from "./foreground-activity.ts";
import {
  ingestHostNotification,
  pruneNotificationOsCooldown,
} from "./notification-center.ts";

const log = createLogger("agent-attention.ipc");

export interface RegisterAgentAttentionArgs {
  eventBus?: PierEventBus;
  /** 保留 index 参数以兼容调用方；OS click 深链已迁至 NCS deliverOs。 */
  index: AgentRuntimeIndexService;
}

function liveAgentRefsFrom(next: ForegroundActivityBroadcast): Set<string> {
  const live = new Set<string>();
  for (const activity of next.activities) {
    if (activity.kind !== "agent") {
      continue;
    }
    live.add(makeAgentRef(activity.windowId, activity.panelId));
  }
  return live;
}

/**
 * 挂 FA 发布钩子：Attention 只做边沿分类 + NCS ingest。
 * 打断投递（toast / OS / 声音）由 NCS DeliveryPlan 调度。
 * settings 同步缓存：boot read + preferences.changed。
 */
export function registerAgentAttention(
  args: RegisterAgentAttentionArgs
): AgentAttentionService {
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
    ingestNotification: ingestHostNotification,
    resolveLocale: resolveAttentionLocale,
    settings: () => getAgentAttentionSettingsCached(),
  });

  let previous: ForegroundActivityBroadcast | null = null;
  onForegroundActivityPublished((next) => {
    const prior = previous;
    previous = next;
    // 先剪枝冷却（面板已关的 agent 立即释放），再 observe 以免新边沿被旧冷却误伤。
    pruneNotificationOsCooldown(liveAgentRefsFrom(next));
    attention.observe(prior, next).catch((err: unknown) => {
      log.error("attention observe failed", { err });
    });
  });

  return attention;
}
