import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  AgentSessionSnapshot,
  AgentSessionsBroadcast,
} from "@shared/contracts/agent-session.ts";
import type { ForegroundActivityBroadcast } from "@shared/contracts/foreground-activity.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { app, type IpcMain } from "electron";
import {
  agentHooksDir,
  eventsJsonlPath,
  installAgentHooksEmitScript,
} from "../services/agents/agent-hooks-install.ts";
import { createAgentSessionAggregator } from "../services/agents/agent-session-aggregator.ts";
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

const aggregator = createAgentSessionAggregator();
const foregroundActivityAggregator = createForegroundActivityAggregator();
/** 上次广播覆盖过的窗口——会话清空时也要给这些窗口发空快照清 store。 */
const lastBroadcastWindowIds = new Set<string>();
let jsonlObserver: JsonlObserver | null = null;

/**
 * 按 windowId 定向发送快照。Pier 窗口是 BaseWindow+WebContentsView（见
 * window-manager.createBaseWindow），BrowserWindow.fromId 对其恒为 null——
 * 必须走应用自己的窗口注册表（forwardToWindow 内部 findAppWindowByElectronId）。
 */
function sendToWindow(windowId: string, payload: AgentSessionsBroadcast): void {
  forwardToWindow(
    Number(windowId),
    PIER_BROADCAST.AGENT_SESSIONS_CHANGED,
    payload,
    "pier-agent-sessions-broadcast"
  );
}

/**
 * 按窗口过滤后定向发送（含上轮有会话、本轮清空的窗口）。
 * tab 状态点/icon/title 全部由 renderer 从该广播（+挂载时 snapshot pull）
 * 单源渲染——不再从 main 推 tab-chrome-patch, 避免 renderer reload 后
 * main 侧增量缓存与 renderer 组件 state 生命周期不同步导致指示器丢失。
 */
function handleBroadcast(b: AgentSessionsBroadcast): void {
  const byWindow = new Map<string, AgentSessionSnapshot[]>();
  for (const session of b.sessions) {
    const list = byWindow.get(session.windowId) ?? [];
    list.push(session);
    byWindow.set(session.windowId, list);
  }
  for (const windowId of new Set([
    ...byWindow.keys(),
    ...lastBroadcastWindowIds,
  ])) {
    sendToWindow(windowId, {
      sessions: byWindow.get(windowId) ?? [],
      ts: b.ts,
    });
  }
  lastBroadcastWindowIds.clear();
  for (const windowId of byWindow.keys()) {
    lastBroadcastWindowIds.add(windowId);
  }
}

/** 前台活动广播的窗口集合（与 lastBroadcastWindowIds 独立跟踪, 语义相同）。 */
const lastActivityBroadcastWindowIds = new Set<string>();

function sendActivityToWindow(
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

function handleActivityBroadcast(b: ForegroundActivityBroadcast): void {
  const byWindow = new Map<string, ForegroundActivityBroadcast["activities"]>();
  for (const activity of b.activities) {
    const list = byWindow.get(activity.windowId) ?? [];
    list.push(activity);
    byWindow.set(activity.windowId, list);
  }
  for (const windowId of new Set([
    ...byWindow.keys(),
    ...lastActivityBroadcastWindowIds,
  ])) {
    sendActivityToWindow(windowId, {
      activities: byWindow.get(windowId) ?? [],
      ts: b.ts,
    });
  }
  lastActivityBroadcastWindowIds.clear();
  for (const windowId of byWindow.keys()) {
    lastActivityBroadcastWindowIds.add(windowId);
  }
}

export const agentSessionService = {
  agentLaunched(windowId: string, panelId: string, agentId: AgentKind): void {
    aggregator.agentLaunched(windowId, panelId, agentId);
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
      // JSONL transport 环境变量（spec §4.4）
      PIER_AGENT_HOOKS_DIR: agentHooksDir(userData),
      PIER_AGENT_EVENT_LOG: eventsJsonlPath(userData),
    };
  },
  commandFinished(panelId: string, exitCode?: number): void {
    aggregator.commandFinished(panelId, exitCode);
    foregroundActivityAggregator.ingestCommandFinished(panelId, exitCode);
  },
  panelClosed(panelId: string): void {
    aggregator.panelClosed(panelId);
    foregroundActivityAggregator.panelClosed(panelId);
  },
  retainPanels(windowId: string, activePanelIds: readonly string[]): void {
    aggregator.retainPanels(windowId, activePanelIds);
    foregroundActivityAggregator.retainPanels(windowId, activePanelIds);
  },
  windowClosed(windowId: string): void {
    aggregator.windowClosed(windowId);
    foregroundActivityAggregator.windowClosed(windowId);
    // 窗口已销毁, 不再对它发空广播。
    lastBroadcastWindowIds.delete(windowId);
    lastActivityBroadcastWindowIds.delete(windowId);
  },
  snapshot(windowId?: string): AgentSessionsBroadcast {
    const b = aggregator.snapshot();
    if (windowId === undefined) {
      return b;
    }
    return {
      sessions: b.sessions.filter((s) => s.windowId === windowId),
      ts: b.ts,
    };
  },
};

/** 前台活动服务 facade（unified aggregator）。渐进迁移目标, 与 agentSessionService 共存。 */
export const foregroundActivityService = {
  taskLaunched(
    panelId: string,
    windowId: string,
    task: { taskId: string; label: string }
  ): void {
    foregroundActivityAggregator.taskLaunched(panelId, windowId, task);
  },
  taskFinished(
    panelId: string,
    args: {
      status: "success" | "failure" | "cancelled";
      exitCode?: number;
    }
  ): void {
    foregroundActivityAggregator.taskFinished(panelId, args);
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
  ignoreNextNativeUserClose(panelId: string): void {
    foregroundActivityAggregator.ignoreNextNativeUserClose(panelId);
  },
  consumeIgnoreNativeUserClose(panelId: string): boolean {
    return foregroundActivityAggregator.consumeIgnoreNativeUserClose(panelId);
  },
  resetPanel(panelId: string): void {
    foregroundActivityAggregator.resetPanel(panelId);
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
  aggregator.onChange(handleBroadcast);
  foregroundActivityAggregator.onChange(handleActivityBroadcast);
  // emit 脚本安装（一次性）——fire-and-forget，失败仅告警。
  installAgentHooksEmitScript(app.getPath("userData")).catch((err) => {
    console.error("[agent-session] emit script install failed:", err);
  });
  // JSONL 尾读（spec §4.4 主路径）：hooks.json 系集成通过 emit 脚本
  // append 到 events.jsonl，observer 250ms 轮询 → 按 kind 分派到
  // 两个 aggregator（渐进迁移期间双写）。
  jsonlObserver = createJsonlObserver({
    filePath: eventsJsonlPath(app.getPath("userData")),
    onAgentEvent: (event) => {
      aggregator.ingestAgentEvent(event);
      foregroundActivityAggregator.ingestAgentEvent(event);
    },
    onCommandFinished: (event) => {
      aggregator.ingestCommandFinished(event);
      foregroundActivityAggregator.ingestCommandFinishedHook(event);
    },
    onCommandStart: (event) => {
      aggregator.ingestCommandStart(event);
      foregroundActivityAggregator.ingestCommandStartHook(event);
    },
    onError: (err) => {
      console.error("[agent-session] jsonl observer parse failed:", err);
    },
  });
  ipcMain.handle("pier:agent-session:snapshot", (event) => {
    // 同上：BaseWindow 架构下不可用 BrowserWindow.fromWebContents。
    const win = findAppWindowByWebContents(event.sender);
    if (!win) {
      // 无法定位调用方窗口——返回空快照而非全局快照, 防止向不可识别的
      // 调用方泄露其他窗口的会话数据。
      return { sessions: [], ts: aggregator.snapshot().ts };
    }
    return agentSessionService.snapshot(String(win.id));
  });
  ipcMain.handle("pier:foreground-activity:snapshot", (event) => {
    const win = findAppWindowByWebContents(event.sender);
    if (!win) {
      return { activities: [], ts: foregroundActivityAggregator.snapshot().ts };
    }
    return foregroundActivityService.snapshot(String(win.id));
  });

  // 启动时按偏好双向对齐 hook 安装状态（幂等）：开→装, 关→卸。
  // 关闭态必须主动卸载, 防止旧版本/外部同步写回的 hook 静默复活（orca 同款语义）。
  readPreferences()
    .then((prefs) =>
      prefs.agentStatusHooks ? installAllAgentHooks() : uninstallAllAgentHooks()
    )
    .catch((err) => {
      console.error("[agent-session] startup hook install failed:", err);
    });
}
