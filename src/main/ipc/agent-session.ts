import type { AgentKind } from "@shared/contracts/agent.ts";
import type { ForegroundActivityBroadcast } from "@shared/contracts/foreground-activity.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { app, type IpcMain } from "electron";
import {
  agentHooksDir,
  eventsJsonlPath,
  installAgentHooksEmitScript,
} from "../services/agents/agent-hooks-install.ts";
import {
  installAllAgentHooks,
  uninstallAllAgentHooks,
} from "../services/agents/integrations/registry.ts";
import { createForegroundActivityAggregator } from "../services/foreground-activity/aggregator.ts";
import {
  createJsonlObserver,
  type JsonlObserver,
} from "../services/foreground-activity/jsonl-observer.ts";
import { readPreferences } from "../state/preferences.ts";
import { findAppWindowByWebContents } from "../windows/window-identity.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";

const foregroundActivityAggregator = createForegroundActivityAggregator();
/** 上次广播覆盖过的窗口——会话清空时也要给这些窗口发空快照清 store。 */
const lastBroadcastWindowIds = new Set<string>();
let jsonlObserver: JsonlObserver | null = null;

/**
 * 按 windowId 定向发送快照。Pier 窗口是 BaseWindow+WebContentsView（见
 * window-manager.createBaseWindow），BrowserWindow.fromId 对其恒为 null——
 * 必须走应用自己的窗口注册表（forwardToWindow 内部 findAppWindowByElectronId）。
 */
function sendToWindow(
  windowId: string,
  payload: ForegroundActivityBroadcast
): void {
  forwardToWindow(
    Number(windowId),
    PIER_BROADCAST.FOREGROUND_ACTIVITY_CHANGED,
    payload,
    "pier-foreground-activity-broadcast"
  );
}

/**
 * 按窗口过滤后定向发送（含上轮有活动、本轮清空的窗口）。
 * tab 状态点/icon/title 全部由 renderer 从该广播（+挂载时 snapshot pull）
 * 单源渲染。
 */
function handleBroadcast(b: ForegroundActivityBroadcast): void {
  const byWindow = new Map<string, ForegroundActivityBroadcast["activities"]>();
  for (const activity of b.activities) {
    const list = byWindow.get(activity.windowId) ?? [];
    list.push(activity);
    byWindow.set(activity.windowId, list);
  }
  for (const windowId of new Set([
    ...byWindow.keys(),
    ...lastBroadcastWindowIds,
  ])) {
    sendToWindow(windowId, {
      activities: byWindow.get(windowId) ?? [],
      ts: b.ts,
    });
  }
  lastBroadcastWindowIds.clear();
  for (const windowId of byWindow.keys()) {
    lastBroadcastWindowIds.add(windowId);
  }
}

/**
 * agent-session facade（历史命名保留，方便 native callback 层继续引用）。
 * 语义已完全迁到 ForegroundActivityAggregator。所有方法直接转发到
 * unified aggregator——不再存在双写。
 */
export const agentSessionService = {
  agentLaunched(windowId: string, panelId: string, agentId: AgentKind): void {
    foregroundActivityAggregator.agentLaunched(windowId, panelId, agentId);
  },
  /**
   * PTY 注入用环境变量。**同步** 返回——JSONL 通路本地文件, 无异步启动依赖。
   *
   * 命令行识别不再走 pier 的 ZDOTDIR wrapper——ghostty 自己的 shell integration
   * 会注入 OSC 133 C（带 cmdline_url），由 command_started 转发回 agentLaunched。
   * hooks.json 系集成经 emit 脚本 append 到 events.jsonl（Path B）。
   */
  hookEnv(): Record<string, string> {
    const userData = app.getPath("userData");
    return {
      PIER_AGENT_HOOKS_DIR: agentHooksDir(userData),
      PIER_AGENT_EVENT_LOG: eventsJsonlPath(userData),
    };
  },
  commandFinished(panelId: string, exitCode?: number): void {
    foregroundActivityAggregator.ingestCommandFinished(panelId, exitCode);
  },
  ingestCommandStarted(
    panelId: string,
    windowId: string,
    commandLine: string,
    matchedAgent: AgentKind | null
  ): void {
    foregroundActivityAggregator.ingestCommandStarted(
      panelId,
      windowId,
      commandLine,
      matchedAgent
    );
  },
  panelClosed(panelId: string): void {
    foregroundActivityAggregator.panelClosed(panelId);
  },
  retainPanels(windowId: string, activePanelIds: readonly string[]): void {
    foregroundActivityAggregator.retainPanels(windowId, activePanelIds);
  },
  windowClosed(windowId: string): void {
    foregroundActivityAggregator.windowClosed(windowId);
    lastBroadcastWindowIds.delete(windowId);
  },
  snapshot(windowId?: string): ForegroundActivityBroadcast {
    return foregroundActivityAggregator.snapshot(windowId);
  },
};

/** app 退出时释放 JSONL observer 等副资源。 */
export function closeAgentSessionResources(): void {
  jsonlObserver?.dispose();
  jsonlObserver = null;
}

export function registerAgentSessionIpc(ipcMain: IpcMain): void {
  foregroundActivityAggregator.onChange(handleBroadcast);
  // emit 脚本安装（一次性）——fire-and-forget，失败仅告警。
  installAgentHooksEmitScript(app.getPath("userData")).catch((err) => {
    console.error("[agent-session] emit script install failed:", err);
  });
  // JSONL 尾读（spec §4.4 主路径）：hooks.json 系集成通过 emit 脚本
  // append 到 events.jsonl，observer 250ms 轮询 → 按 kind 分派到
  // aggregator 对应 hook。commandStart/commandFinished hook 目前无消费者
  // (native shell integration 走 native callback 通路)，是 forward-compat 占位。
  jsonlObserver = createJsonlObserver({
    filePath: eventsJsonlPath(app.getPath("userData")),
    onAgentEvent: (event) =>
      foregroundActivityAggregator.ingestAgentEvent(event),
    onCommandFinished: (event) =>
      foregroundActivityAggregator.ingestCommandFinishedHook(event),
    onCommandStart: (event) =>
      foregroundActivityAggregator.ingestCommandStartHook(event),
    onError: (err) => {
      console.error("[agent-session] jsonl observer parse failed:", err);
    },
  });
  ipcMain.handle("pier:foreground-activity:snapshot", (event) => {
    const win = findAppWindowByWebContents(event.sender);
    if (!win) {
      // 无法定位调用方窗口——返回空快照而非全局快照, 防止向不可识别的
      // 调用方泄露其他窗口的会话数据。
      return { activities: [], ts: foregroundActivityAggregator.snapshot().ts };
    }
    return agentSessionService.snapshot(String(win.id));
  });

  // 启动时按偏好双向对齐 hook 安装状态（幂等）：开→装, 关→卸。
  // 关闭态必须主动卸载, 防止旧版本/外部同步写回的 hook 静默复活。
  readPreferences()
    .then((prefs) =>
      prefs.agentStatusHooks ? installAllAgentHooks() : uninstallAllAgentHooks()
    )
    .catch((err) => {
      console.error("[agent-session] startup hook install failed:", err);
    });
}
