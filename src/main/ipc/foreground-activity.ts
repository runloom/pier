import { isSubagentHookEvent } from "@shared/agent-session-actor.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  AgentSessionTitleSource,
  ForegroundActivityBroadcast,
} from "@shared/contracts/foreground-activity.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import { app, type IpcMain } from "electron";
import {
  eventsJsonlPath,
  pierHooksCurrentDir,
} from "../services/agents/hooks-install.ts";
import {
  getAgentHookIntegration,
  installAgentHooksStack,
  uninstallAllAgentHooks,
} from "../services/agents/integrations/registry.ts";
import { resolveAgentEventIngestOptions } from "../services/agents/integrations/runtime/event-authority.ts";
import {
  type AgentTerminalReconciler,
  createAgentTerminalReconciler,
} from "../services/agents/integrations/terminal-reconciliation.ts";
import {
  applyAgentSessionTitleFromHookEvent,
  applyProviderAgentSessionTitle,
} from "../services/agents/session-title/index.ts";
import {
  isAgentStatusHooksIngestEnabled,
  setAgentStatusHooksIngestEnabled,
} from "../services/agents/status-hooks-gate.ts";
import { notifyAgentHookEventListeners } from "../services/foreground-activity/agent-hook-event-fanout.ts";
import { createForegroundActivityAggregator } from "../services/foreground-activity/aggregator.ts";
import { isBlankShellCommandLine } from "../services/foreground-activity/blank-command-line.ts";
import { SUSPENDED_JOB_EXIT_CODES } from "../services/foreground-activity/entry.ts";
import {
  createJsonlObserver,
  type JsonlObserver,
} from "../services/foreground-activity/jsonl-observer.ts";
import { resolveOwner } from "../services/panel-transfer/terminal-hook-owner-routing.ts";
import {
  notifyTerminalPanelClosed,
  notifyTerminalPtyExited,
} from "../services/runtime-control/panel-close-listeners.ts";
import { readPreferences } from "../state/preferences.ts";
import {
  findAppWindowByInternalId,
  findAppWindowByWebContents,
  listAppWindowIds,
} from "../windows/identity.ts";
import { recordAgentResumeSession } from "./agent-resume-persist.ts";
import { markAgentSessionExited } from "./agent-session-exit-persist.ts";
import { handleObservedAgentHookEvent } from "./foreground-activity/hook-pipeline.ts";
import { materializeForegroundActivityPublications } from "./foreground-activity-publication.ts";
import { forwardToWindow } from "./terminal/forwarding.ts";

const log = createLogger("foreground-activity.ipc");

const foregroundActivityAggregator = createForegroundActivityAggregator();
let foregroundSerialChain: Promise<void> = Promise.resolve();

function runForegroundSerial<T>(operation: () => Promise<T> | T): Promise<T> {
  const run = foregroundSerialChain.then(() => operation());
  foregroundSerialChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function withResolvedOwner<T extends { panelId: string; windowId: string }>(
  event: T
): T {
  const owner = resolveOwner(event.windowId, event.panelId);
  if (owner.windowId === event.windowId && owner.panelId === event.panelId) {
    return event;
  }
  return { ...event, panelId: owner.panelId, windowId: owner.windowId };
}

let jsonlObserver: JsonlObserver | null = null;
let agentTerminalReconciler: AgentTerminalReconciler | null = null;

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
let cursorViewportReader:
  | ((panelId: string, windowId: string) => string | null)
  | undefined;

export function setCursorViewportReader(
  reader: (panelId: string, windowId: string) => string | null
): void {
  cursorViewportReader = reader;
}

function readCursorViewportText(
  panelId: string,
  windowId: string
): string | null {
  return cursorViewportReader?.(panelId, windowId) ?? null;
}

export const foregroundActivityService = {
  agentLaunched(windowId: string, panelId: string, agentId: AgentKind): void {
    foregroundActivityAggregator.agentLaunched(windowId, panelId, agentId);
    if (agentId === "cursor") {
      agentTerminalReconciler
        ?.observe({
          agent: "cursor",
          event: "processing",
          kind: "agentEvent",
          panelId,
          v: 1,
          windowId,
        })
        .catch((err) => {
          log.warn("cursor viewport watch attach failed", { err });
        });
    }
  },
  /**
   * 直接摄入 agent 事件（如终端裸 Esc 取消）。与 JSONL observer 同入口。
   */
  ingestAgentEvent(
    event: Parameters<typeof foregroundActivityAggregator.ingestAgentEvent>[0],
    options: Parameters<typeof foregroundActivityAggregator.ingestAgentEvent>[1]
  ): boolean {
    return foregroundActivityAggregator.ingestAgentEvent(event, options);
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
      // 共享运行时（~/.pier/hooks/current）；跨 worktree / 版本稳定。
      PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(),
      // 事件日志仍按实例 userData 隔离，避免多窗抢同一 JSONL。
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
    if (isBlankShellCommandLine(commandLine)) {
      return;
    }
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
    notifyTerminalPanelClosed(panelId, windowId);
  },
  ptyExited(panelId: string, windowId?: string): void {
    agentTerminalReconciler?.releasePanel(panelId, windowId);
    foregroundActivityAggregator.ptyExited(panelId, windowId);
    notifyTerminalPtyExited(panelId, windowId);
  },
  retainPanels(windowId: string, activePanelIds: readonly string[]): void {
    agentTerminalReconciler?.retainPanels(windowId, activePanelIds);
    foregroundActivityAggregator.retainPanels(windowId, activePanelIds);
  },
  transferPanelOwnership(input: {
    panelId: string;
    sourceWindowId: string;
    targetWindowId: string;
  }): Promise<void> {
    return runForegroundSerial(() => {
      foregroundActivityAggregator.transferPanelOwnership(input);
      agentTerminalReconciler?.transferPanelOwnership(input);
    });
  },
  runSerial<T>(operation: () => Promise<T> | T): Promise<T> {
    return runForegroundSerial(operation);
  },
  windowClosed(windowId: string): void {
    agentTerminalReconciler?.releaseWindow(windowId);
    foregroundActivityAggregator.windowClosed(windowId);
  },
  snapshot(windowId?: string): ForegroundActivityBroadcast {
    return foregroundActivityAggregator.snapshot(windowId);
  },
  hasAgentPresence(panelId: string, windowId: string): boolean {
    return foregroundActivityAggregator.hasAgentPresence(panelId, windowId);
  },
  setAgentSessionTitle(
    windowId: string,
    panelId: string,
    input: {
      title: string;
      source: AgentSessionTitleSource;
      sessionId?: string | undefined;
    }
  ): boolean {
    return foregroundActivityAggregator.setAgentSessionTitle(
      windowId,
      panelId,
      input
    );
  },
  hydrateAgentSessionTitle(
    windowId: string,
    panelId: string,
    input: {
      title: string;
      source: AgentSessionTitleSource;
      sessionId?: string | undefined;
    }
  ): void {
    foregroundActivityAggregator.hydrateAgentSessionTitle(
      windowId,
      panelId,
      input
    );
  },
  clearAgentSessionTitle(windowId: string, panelId: string): void {
    foregroundActivityAggregator.clearAgentSessionTitle(windowId, panelId);
  },
};

/**
 * app 退出时释放 JSONL observer 等副资源。
 * **不得**卸载全局 agent hooks 或删除 `~/.pier/hooks`——运行时与 pier 条目
 * 跨版本/channel 共享，退出不等于用户关闭「智能体状态提示」。
 */
export function closeForegroundActivityResources(): void {
  jsonlObserver?.dispose();
  jsonlObserver = null;
  agentTerminalReconciler?.dispose();
  agentTerminalReconciler = null;
}

export function registerForegroundActivityIpc(ipcMain: IpcMain): void {
  foregroundActivityAggregator.onChange(handleBroadcast);
  // JSONL 尾读（spec §4.4 主路径）：hooks.json 系集成通过 emit 脚本
  // append 到 events.jsonl，observer 250ms 轮询 → 按 kind 分派到
  // aggregator 对应 hook。commandStart/commandFinished hook 目前无消费者
  // (native shell integration 走 native callback 通路)，是 forward-compat 占位。
  agentTerminalReconciler = createAgentTerminalReconciler({
    readViewportText: readCursorViewportText,
    onTerminalEvent: (event) => {
      // reconciler 合成的 v3 交互事件同样进旁路 fan-out（未决交互登记）；
      // 与 JSONL hook 行共用同一 fan-out 点，见
      // services/foreground-activity/agent-hook-event-fanout.ts。
      notifyAgentHookEventListeners(event);
      foregroundActivityAggregator.ingestAgentEvent(
        event,
        resolveAgentEventIngestOptions({
          evidenceSource: "transcript",
          event,
          runtime: undefined,
        })
      );
    },
    // provider 原生会话名（`provider` 秩）：只有能从自家 transcript 读出标题的
    // agent 会走到这里；读不到就没有，标题退回首条 prompt 派生。
    onTitleRecord: ({ context, record }) => {
      if (isSubagentHookEvent(context)) {
        return;
      }
      applyProviderAgentSessionTitle({
        aggregator: foregroundActivityAggregator,
        agentId: context.agent,
        nativeEvent: record.nativeEvent,
        panelId: context.panelId,
        ...(context.sessionId?.trim()
          ? { sessionId: context.sessionId.trim() }
          : {}),
        title: record.title,
        windowId: context.windowId,
      }).catch((err) => {
        log.warn("agent session title effect failed", { err });
      });
    },
  });
  jsonlObserver = createJsonlObserver({
    filePath: eventsJsonlPath(app.getPath("userData")),
    onAgentEvent: (event) => {
      if (!isAgentStatusHooksIngestEnabled()) {
        return;
      }
      handleObservedAgentHookEvent(
        {
          aggregator: foregroundActivityAggregator,
          applySessionTitle: (routed) =>
            applyAgentSessionTitleFromHookEvent({
              aggregator: foregroundActivityAggregator,
              event: routed,
            }),
          markPanelExited: markAgentSessionExited,
          notifyListeners: notifyAgentHookEventListeners,
          observeTranscript: (routed) =>
            agentTerminalReconciler?.observe(routed) ?? Promise.resolve(),
          recordResume: recordAgentResumeSession,
          resolveRuntime: (agent) => getAgentHookIntegration(agent)?.runtime,
        },
        withResolvedOwner(event)
      ).catch((err) => {
        log.warn("agent hook event pipeline failed", { err });
      });
    },
    onCommandFinished: (event) => {
      const routed = withResolvedOwner(event);
      agentTerminalReconciler?.releasePanel(routed.panelId, routed.windowId);
      foregroundActivityAggregator.ingestCommandFinishedHook(routed);
    },
    onCommandStart: (event) =>
      foregroundActivityAggregator.ingestCommandStartHook(
        withResolvedOwner(event)
      ),
    onError: (diagnostic) => {
      // JSONL 行错误与文件系统失败都已在 observer 边界脱敏。
      log.warn("jsonl observer failure", diagnostic);
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

  // 启动时按偏好双向对齐 hook 安装状态（幂等）：
  // 开 → installAgentHooksStack（运行时 + 各 agent 全局配置，同事务顺序）；
  // 关 → 仅卸 pier 条目（保留 ~/.pier/hooks 运行时）。
  // 关闭态必须主动卸载 pier 条目, 防止旧版本/外部同步写回的 hook 静默复活。
  readPreferences()
    .then((prefs) => {
      setAgentStatusHooksIngestEnabled(prefs.agentStatusHooks);
      return prefs.agentStatusHooks
        ? installAgentHooksStack()
        : uninstallAllAgentHooks();
    })
    .catch((err) => {
      log.error("startup hook install failed", { err });
    });
}
