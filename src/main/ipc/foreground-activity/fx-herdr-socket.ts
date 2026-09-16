import { createLogger } from "@shared/logger.ts";
import { app } from "electron";
import { getAgentHookIntegration } from "../../services/agents/integrations/registry.ts";
import { applyAgentSessionTitleFromHookEvent } from "../../services/agents/session-title/index.ts";
import { isAgentStatusHooksIngestEnabled } from "../../services/agents/status-hooks-gate.ts";
import { notifyAgentHookEventListeners } from "../../services/foreground-activity/agent-hook-event-fanout.ts";
import {
  createFxHerdrListener,
  type FxHerdrListener,
} from "../../services/foreground-activity/fx-herdr-listener.ts";
import type { ForegroundActivityAggregator } from "../../services/foreground-activity/types.ts";
import { resolveOwner } from "../../services/panel-transfer/terminal-hook-owner-routing.ts";
import { recordAgentResumeSession } from "../agent-resume-persist.ts";
import { handleObservedAgentHookEvent } from "./hook-pipeline.ts";

const log = createLogger("foreground-activity.fx-herdr-socket");

/**
 * fx Herdr socket env（实例 userData 隔离；监听惰性启动）。
 *
 * 上游协议（vercel-labs/fx@e45d780933bfb42ae376aee54a49bd3ebe81f04d）：
 * Pier 在 PTY 注入 HERDR_SOCKET_PATH 后，fx 自动经 Unix socket 上报
 * idle/working/blocked。pane 归属由 HERDR_PANE_ID（= panelId，经
 * withPanelStatusEnv 注入）回传；windowId 由存活面板快照反查，跨窗同名
 * 经 owner 别名解决。
 */
export function createFxHerdrSocketEnv(deps: {
  aggregator: ForegroundActivityAggregator;
}): {
  dispose: () => void;
  env: () => Record<string, string>;
} {
  let listener: FxHerdrListener | null = null;

  function withResolvedOwner<T extends { panelId: string; windowId: string }>(
    event: T
  ): T {
    const owner = resolveOwner(event.windowId, event.panelId);
    if (owner.windowId === event.windowId && owner.panelId === event.panelId) {
      return event;
    }
    return { ...event, panelId: owner.panelId, windowId: owner.windowId };
  }

  function resolveFxHerdrOwner(
    panelId: string
  ): { panelId: string; windowId: string } | null {
    const snapshot = deps.aggregator.snapshot();
    let match: { panelId: string; windowId: string } | null = null;
    for (const activity of snapshot.activities) {
      // panelId 跨窗口不唯一（session.ts 身份 = windowId::panelId）：
      // 多窗同名必须 fail-closed，不能取首个非 idle 命中。
      if (activity.panelId === panelId && activity.kind !== "idle") {
        if (match) {
          return null;
        }
        match = { panelId: activity.panelId, windowId: activity.windowId };
      }
    }
    return match;
  }

  return {
    dispose() {
      listener?.dispose();
      listener = null;
    },
    env() {
      try {
        if (!listener) {
          listener = createFxHerdrListener({
            onAgentEvent: (event) => {
              if (!isAgentStatusHooksIngestEnabled()) {
                return;
              }
              // 同用户伪造门：socket 在 userData 下同用户可写，frame 自称
              // source/agent 易伪造。要求面板 OSC 命令层已点亮为 fx，
              // 与 hook ctty 门同纪律（hook-event-origin.ts）。
              const oscOwned = deps.aggregator.panelCommandOwnedAgent(
                event.panelId,
                event.windowId
              );
              if (oscOwned !== "fx") {
                return;
              }
              handleObservedAgentHookEvent(
                {
                  aggregator: deps.aggregator,
                  applySessionTitle: (routed) =>
                    applyAgentSessionTitleFromHookEvent({
                      aggregator: deps.aggregator,
                      event: routed,
                    }),
                  notifyListeners: notifyAgentHookEventListeners,
                  observeTranscript: undefined,
                  recordResume: recordAgentResumeSession,
                  resolveRuntime: (agent) =>
                    getAgentHookIntegration(agent)?.runtime,
                },
                withResolvedOwner(event)
              ).catch((err) => {
                log.warn("fx herdr hook event pipeline failed", { err });
              });
            },
            resolveOwner: (panelId) => resolveFxHerdrOwner(panelId),
            userData: app.getPath("userData"),
          });
        }
        return listener.env();
      } catch (err) {
        log.warn("fx herdr listener unavailable", { err });
        return {};
      }
    },
  };
}
