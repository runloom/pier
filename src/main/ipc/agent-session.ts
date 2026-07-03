import { matchAgentCommand } from "@shared/agent-command-detection.ts";
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
import { createAgentSessionAggregator } from "../services/agents/agent-session-aggregator.ts";
import {
  installAllAgentHooks,
  uninstallAllAgentHooks,
} from "../services/agents/integrations/registry.ts";
import {
  installShellCommandIntegration,
  shellCommandIntegrationEnv,
} from "../services/agents/shell-command-integration.ts";
import { readPreferences } from "../state/preferences.ts";
import { findAppWindowByWebContents } from "../windows/window-identity.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";

const aggregator = createAgentSessionAggregator();
/** 上次广播覆盖过的窗口——会话清空时也要给这些窗口发空快照清 store。 */
const lastBroadcastWindowIds = new Set<string>();
let hookServerPromise: Promise<AgentHookServer | null> | null = null;
let shellIntegrationPromise: Promise<boolean> | null = null;

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
   * race；启动失败 resolve {}（功能退化为标题兜底）。
   * agentStatusHooks 开启且 wrapper 就绪时附带 ZDOTDIR 注入（zsh 命令上报）。
   */
  async hookEnv(): Promise<Record<string, string>> {
    const server = await (hookServerPromise ?? Promise.resolve(null));
    if (!server) {
      return {};
    }
    const env: Record<string, string> = {
      PIER_AGENT_HOOK_PORT: String(server.port),
      PIER_AGENT_HOOK_TOKEN: server.token,
    };
    const [prefs, integrationReady] = await Promise.all([
      readPreferences().catch(() => null),
      shellIntegrationPromise ?? Promise.resolve(false),
    ]);
    if (prefs?.agentStatusHooks && integrationReady) {
      Object.assign(env, shellCommandIntegrationEnv(app.getPath("userData")));
    }
    return env;
  },
  ingestTitle(windowId: string, panelId: string, title: string): void {
    aggregator.ingestTitle(windowId, panelId, title);
  },
  commandFinished(windowId: string, panelId: string, exitCode?: number): void {
    aggregator.commandFinished(windowId, panelId, exitCode);
  },
  panelClosed(windowId: string, panelId: string): void {
    aggregator.panelClosed(windowId, panelId);
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

/** app 退出时对称关闭 loopback 服务器（与 localControl.close 同段调用）。 */
export async function closeAgentHookServer(): Promise<void> {
  const server = await (hookServerPromise ?? Promise.resolve(null));
  await server?.close();
}

export function registerAgentSessionIpc(ipcMain: IpcMain): void {
  aggregator.onChange(handleBroadcast);
  hookServerPromise = startAgentHookServer(
    (event) => aggregator.ingestHookEvent(event),
    (event) => {
      // 命令行先验身份（loomdesk pty_command 源对位）：可执行体词元命中
      // 才点亮; 非 agent 命令 no-op。清理仍由 command_finished 驱动。
      const agentId = matchAgentCommand(event.commandLine);
      if (agentId) {
        aggregator.agentLaunched(event.windowId, event.panelId, agentId);
      }
    }
  ).catch((err) => {
    console.error("[agent-session] hook server start failed:", err);
    return null;
  });
  shellIntegrationPromise = installShellCommandIntegration(
    app.getPath("userData")
  )
    .then(() => true)
    .catch((err) => {
      console.error("[agent-session] shell integration install failed:", err);
      return false;
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
