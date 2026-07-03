import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  AgentSessionSnapshot,
  AgentSessionsBroadcast,
} from "@shared/contracts/agent-session.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { app, type IpcMain } from "electron";
import {
  type AgentHookServer,
  startAgentHookServer,
} from "../services/agents/agent-hook-server.ts";
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
import {
  createJsonlObserver,
  type JsonlObserver,
} from "../services/foreground-activity/jsonl-observer.ts";
import { readPreferences } from "../state/preferences.ts";
import { findAppWindowByWebContents } from "../windows/window-identity.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";

const aggregator = createAgentSessionAggregator();
/** 上次广播覆盖过的窗口——会话清空时也要给这些窗口发空快照清 store。 */
const lastBroadcastWindowIds = new Set<string>();
let hookServerPromise: Promise<AgentHookServer | null> | null = null;
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

export const agentSessionService = {
  agentLaunched(windowId: string, panelId: string, agentId: AgentKind): void {
    aggregator.agentLaunched(windowId, panelId, agentId);
  },
  /**
   * PTY 注入用环境变量。await 服务器就绪后返回, 消除首批终端拿到空 env 的
   * race；启动失败 resolve {}（退化为仅 L1 shell integration 命令行检测）。
   *
   * 命令行识别不再走 pier 的 ZDOTDIR wrapper——ghostty 自己的 shell integration
   * 会注入 OSC 133 C（带 cmdline_url），由 command_started 转发回 agentLaunched。
   * hook server 仍开着以接收 hooks.json 事件（SessionStart / PromptSubmit / ...）。
   */
  async hookEnv(): Promise<Record<string, string>> {
    const server = await (hookServerPromise ?? Promise.resolve(null));
    const userData = app.getPath("userData");
    const env: Record<string, string> = {
      // JSONL transport 环境变量（spec §4.4）
      PIER_AGENT_HOOKS_DIR: agentHooksDir(userData),
      PIER_AGENT_EVENT_LOG: eventsJsonlPath(userData),
    };
    if (server) {
      env.PIER_AGENT_HOOK_PORT = String(server.port);
      env.PIER_AGENT_HOOK_TOKEN = server.token;
    }
    return env;
  },
  commandFinished(panelId: string, exitCode?: number): void {
    aggregator.commandFinished(panelId, exitCode);
  },
  panelClosed(panelId: string): void {
    aggregator.panelClosed(panelId);
  },
  retainPanels(windowId: string, activePanelIds: readonly string[]): void {
    aggregator.retainPanels(windowId, activePanelIds);
  },
  windowClosed(windowId: string): void {
    aggregator.windowClosed(windowId);
    // 窗口已销毁, 不再对它发空广播。
    lastBroadcastWindowIds.delete(windowId);
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

/** app 退出时对称关闭 loopback 服务器 + JSONL observer。 */
export async function closeAgentHookServer(): Promise<void> {
  jsonlObserver?.dispose();
  jsonlObserver = null;
  const server = await (hookServerPromise ?? Promise.resolve(null));
  await server?.close();
}

export function registerAgentSessionIpc(ipcMain: IpcMain): void {
  aggregator.onChange(handleBroadcast);
  // emit 脚本安装（与 hook server 并行启动）——fire-and-forget，失败仅告警。
  installAgentHooksEmitScript(app.getPath("userData")).catch((err) => {
    console.error("[agent-session] emit script install failed:", err);
  });
  hookServerPromise = startAgentHookServer((event) =>
    aggregator.ingestAgentEvent(event)
  ).catch((err) => {
    console.error("[agent-session] hook server start failed:", err);
    return null;
  });
  // JSONL 尾读（spec §4.4 主路径）：hooks.json 系集成通过 emit 脚本
  // append 到 events.jsonl，observer 250ms 轮询 → 按 kind 分派到
  // aggregator 对应 hook。commandStart/commandFinished 目前是 stub
  // 承接（Commit C 引入 ForegroundActivityAggregator 时接管）。
  jsonlObserver = createJsonlObserver({
    filePath: eventsJsonlPath(app.getPath("userData")),
    onAgentEvent: (event) => aggregator.ingestAgentEvent(event),
    onCommandFinished: (event) => aggregator.ingestCommandFinished(event),
    onCommandStart: (event) => aggregator.ingestCommandStart(event),
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
