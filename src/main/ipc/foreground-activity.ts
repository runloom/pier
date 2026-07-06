import type { AgentKind } from "@shared/contracts/agent.ts";
import type { ForegroundActivityBroadcast } from "@shared/contracts/foreground-activity.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
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
import {
  findAppWindowByInternalId,
  findAppWindowByWebContents,
} from "../windows/window-identity.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";

const log = createLogger("foreground-activity.ipc");

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
 * 前台活动服务门面——native callback（terminal.ts / terminal-task-lifecycle-wiring.ts）、
 * window lifecycle、task lifecycle 通过此对象向 ForegroundActivityAggregator 提交
 * 事件。方法一对一转发到 aggregator，单源无双写。
 */
export const foregroundActivityService = {
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
  taskLaunched(
    panelId: string,
    windowId: string,
    task: { taskId: string; label: string }
  ): void {
    // task 生命周期回调携带内部 windowId（WindowContext.windowId, 如
    // "main"）；聚合器与广播/快照/清理全链统一 electron BrowserWindow.id
    // 字符串词汇——不换算的话 Number("main")=NaN, 广播永远到不了 renderer。
    const win = findAppWindowByInternalId(windowId);
    foregroundActivityAggregator.taskLaunched(
      panelId,
      win ? String(win.id) : windowId,
      task
    );
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
  panelClosed(panelId: string): void {
    foregroundActivityAggregator.panelClosed(panelId);
  },
  ptyExited(panelId: string): void {
    foregroundActivityAggregator.ptyExited(panelId);
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
export function closeForegroundActivityResources(): void {
  jsonlObserver?.dispose();
  jsonlObserver = null;
}

export function registerForegroundActivityIpc(ipcMain: IpcMain): void {
  foregroundActivityAggregator.onChange(handleBroadcast);
  // emit 脚本安装（一次性）——fire-and-forget，失败仅告警。
  installAgentHooksEmitScript(app.getPath("userData")).catch((err) => {
    log.error("emit script install failed", { err });
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
      // Per-line JSONL corruption is recoverable; warn keeps diagnostics visible
      // without treating one bad hook line as a foreground-activity outage.
      log.warn("jsonl observer parse failed", { err });
    },
  });
  ipcMain.handle("pier:foreground-activity:snapshot", (event) => {
    const win = findAppWindowByWebContents(event.sender);
    if (!win) {
      // 无法定位调用方窗口——返回空快照而非全局快照, 防止向不可识别的
      // 调用方泄露其他窗口的会话数据。
      return { activities: [], ts: foregroundActivityAggregator.snapshot().ts };
    }
    return foregroundActivityService.snapshot(String(win.id));
  });

  // 启动时按偏好双向对齐 hook 安装状态（幂等）：开→装, 关→卸。
  // 关闭态必须主动卸载, 防止旧版本/外部同步写回的 hook 静默复活。
  readPreferences()
    .then((prefs) =>
      prefs.agentStatusHooks ? installAllAgentHooks() : uninstallAllAgentHooks()
    )
    .catch((err) => {
      log.error("startup hook install failed", { err });
    });
}
