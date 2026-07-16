import type { AgentKind } from "@shared/contracts/agent.ts";
import type { ForegroundActivityBroadcast } from "@shared/contracts/foreground-activity.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import { app, type IpcMain } from "electron";
import { effectsForAcceptedAgentEvent } from "../services/agents/agent-event-effects.ts";
import {
  agentHooksDir,
  eventsJsonlPath,
  installAgentHooksEmitScript,
} from "../services/agents/agent-hooks-install.ts";
import {
  isAgentStatusHooksIngestEnabled,
  setAgentStatusHooksIngestEnabled,
} from "../services/agents/agent-status-hooks-gate.ts";
import {
  getAgentHookIntegration,
  installAllAgentHooks,
  uninstallAllAgentHooks,
} from "../services/agents/integrations/registry.ts";
import {
  type AgentTerminalReconciler,
  createAgentTerminalReconciler,
} from "../services/agents/integrations/terminal-reconciliation.ts";
import { createForegroundActivityAggregator } from "../services/foreground-activity/aggregator.ts";
import { SUSPENDED_JOB_EXIT_CODES } from "../services/foreground-activity/entry.ts";
import {
  createJsonlObserver,
  type JsonlObserver,
} from "../services/foreground-activity/jsonl-observer.ts";
import { readPreferences } from "../state/preferences.ts";
import {
  patchTerminalPanelAgentStatus,
  updateTerminalPanelAgentResume,
} from "../state/terminal-session-state.ts";
import {
  findAppWindowByElectronId,
  findAppWindowByInternalId,
  findAppWindowByWebContents,
  listAppWindowIds,
} from "../windows/window-identity.ts";
import { materializeForegroundActivityPublications } from "./foreground-activity-publication.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";
import { windowRecordIdFor } from "./terminal-window-scope.ts";

const log = createLogger("foreground-activity.ipc");

const foregroundActivityAggregator = createForegroundActivityAggregator();
let jsonlObserver: JsonlObserver | null = null;
let agentTerminalReconciler: AgentTerminalReconciler | null = null;

function markAgentSessionExited(args: {
  exitCode?: number | undefined;
  panelId: string;
  windowId: string;
}): void {
  const win = findAppWindowByElectronId(Number(args.windowId));
  if (!win || win.isDestroyed()) {
    return;
  }
  patchTerminalPanelAgentStatus(windowRecordIdFor(win), args.panelId, {
    ...(args.exitCode === undefined ? {} : { exitCode: args.exitCode }),
    finishedAt: Date.now(),
    status: "exited",
  }).catch((err) => {
    log.error("agent session exit persist failed", { err });
  });
}

function recordAgentResumeSession(args: {
  agentId: AgentKind;
  panelId: string;
  sessionId: string | undefined;
  windowId: string;
}): void {
  if (!args.sessionId) {
    return;
  }
  const win = findAppWindowByElectronId(Number(args.windowId));
  if (!win || win.isDestroyed()) {
    return;
  }
  updateTerminalPanelAgentResume(windowRecordIdFor(win), args.panelId, {
    agentId: args.agentId,
    capturedAt: Date.now(),
    sessionId: args.sessionId,
    source: "hook",
  }).catch((err) => {
    log.error("agent resume metadata persist failed", { err });
  });
}

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
 * 按窗口过滤后，向每个存活窗口发送完整快照（包括空数组）。
 *
 * 窗口不能只靠“上次非空 push”登记：renderer 可能先经 snapshot pull
 * 观察到一条短命活动，而它在首次 debounce push 前消失。若空 publication
 * 不覆盖所有存活窗口，该 renderer 会永久保留陈旧活动。
 * tab 状态点/icon/title 全部由 renderer 从该广播（+挂载时 snapshot pull）
 * 单源渲染。
 */
const publishListeners = new Set<(b: ForegroundActivityBroadcast) => void>();

/**
 * FA 每次向各窗推送本窗 publication 之后的副作用钩子（如 Agent Runtime Index
 * 全机快照 fan-out）。不改变 FA 按窗过滤语义。
 */
export function onForegroundActivityPublished(
  listener: (b: ForegroundActivityBroadcast) => void
): () => void {
  publishListeners.add(listener);
  return () => {
    publishListeners.delete(listener);
  };
}

function handleBroadcast(b: ForegroundActivityBroadcast): void {
  const liveWindowIds = listAppWindowIds();
  log.debug("publish", {
    activityCount: b.activities.length,
    ts: b.ts,
    windowCount: liveWindowIds.length,
  });
  for (const publication of materializeForegroundActivityPublications(
    b,
    liveWindowIds
  )) {
    sendToWindow(publication.windowId, publication.payload);
  }
  for (const listener of publishListeners) {
    listener(b);
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
  commandFinished(panelId: string, exitCode?: number, windowId?: string): void {
    if (exitCode === undefined || !SUSPENDED_JOB_EXIT_CODES.has(exitCode)) {
      agentTerminalReconciler?.releasePanel(panelId, windowId);
    }
    foregroundActivityAggregator.ingestCommandFinished(
      panelId,
      exitCode,
      windowId
    );
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
    task: { taskId: string; label: string; runId: string }
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
    windowId: string,
    args: {
      runId: string;
    }
  ): void {
    const win = findAppWindowByInternalId(windowId);
    foregroundActivityAggregator.taskFinished(
      panelId,
      args,
      win ? String(win.id) : windowId
    );
  },
  panelClosed(panelId: string, windowId?: string): void {
    agentTerminalReconciler?.releasePanel(panelId, windowId);
    foregroundActivityAggregator.panelClosed(panelId, windowId);
  },
  ptyExited(panelId: string, windowId?: string): void {
    agentTerminalReconciler?.releasePanel(panelId, windowId);
    foregroundActivityAggregator.ptyExited(panelId, windowId);
  },
  retainPanels(windowId: string, activePanelIds: readonly string[]): void {
    agentTerminalReconciler?.retainPanels(windowId, activePanelIds);
    foregroundActivityAggregator.retainPanels(windowId, activePanelIds);
  },
  windowClosed(windowId: string): void {
    agentTerminalReconciler?.releaseWindow(windowId);
    foregroundActivityAggregator.windowClosed(windowId);
  },
  snapshot(windowId?: string): ForegroundActivityBroadcast {
    return foregroundActivityAggregator.snapshot(windowId);
  },
};

/** app 退出时释放 JSONL observer 等副资源。 */
export function closeForegroundActivityResources(): void {
  jsonlObserver?.dispose();
  jsonlObserver = null;
  agentTerminalReconciler?.dispose();
  agentTerminalReconciler = null;
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
  agentTerminalReconciler = createAgentTerminalReconciler({
    onTerminalEvent: (event) => {
      foregroundActivityAggregator.ingestAgentEvent(event, {
        stopAuthority: "authoritative",
      });
    },
  });
  jsonlObserver = createJsonlObserver({
    filePath: eventsJsonlPath(app.getPath("userData")),
    onAgentEvent: (event) => {
      if (!isAgentStatusHooksIngestEnabled()) {
        return;
      }
      const accepted = foregroundActivityAggregator.ingestAgentEvent(event, {
        stopAuthority:
          getAgentHookIntegration(event.agent)?.runtime.stopAuthority ?? "none",
      });
      if (!accepted) {
        return;
      }
      const effects = effectsForAcceptedAgentEvent(event);
      if (effects.observeTranscript) {
        agentTerminalReconciler?.observe(event).catch((err) => {
          log.warn("agent terminal reconciliation failed", { err });
        });
      }
      if (effects.persistResume) {
        recordAgentResumeSession({
          agentId: event.agent,
          panelId: event.panelId,
          sessionId: event.sessionId,
          windowId: event.windowId,
        });
      }
      if (effects.markPanelExited) {
        markAgentSessionExited({
          panelId: event.panelId,
          windowId: event.windowId,
        });
      }
    },
    onCommandFinished: (event) => {
      agentTerminalReconciler?.releasePanel(event.panelId, event.windowId);
      foregroundActivityAggregator.ingestCommandFinishedHook(event);
    },
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
    .then((prefs) => {
      setAgentStatusHooksIngestEnabled(prefs.agentStatusHooks);
      return prefs.agentStatusHooks
        ? installAllAgentHooks()
        : uninstallAllAgentHooks();
    })
    .catch((err) => {
      log.error("startup hook install failed", { err });
    });
}
