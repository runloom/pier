/**
 * 标题落盘 + FA 广播。
 *
 * FA / hook 的 windowId 是 Electron `BrowserWindow.id` 串；session JSON 键是
 * 窗口 record UUID——读写盘前必须经 sessionScopeForFaWindowId 转换。
 */

import type { AgentSessionTitleSource } from "@shared/contracts/foreground-activity.ts";
import { readTerminalPanelSession } from "../../../state/terminal-session-state.ts";
import {
  reconcileTerminalPanelSessionTitleScope,
  setTerminalPanelSessionTitle,
} from "../../../state/terminal-session-title.ts";
import {
  findAppWindowByElectronId,
  findWindowContext,
} from "../../../windows/identity.ts";
import type { ForegroundActivityAggregator } from "../../foreground-activity/types.ts";

export function sessionScopeForFaWindowId(windowId: string): string | null {
  const id = Number(windowId);
  if (!Number.isFinite(id)) {
    return null;
  }
  const win = findAppWindowByElectronId(id);
  if (!win || win.isDestroyed()) {
    return null;
  }
  return findWindowContext(win)?.recordId ?? null;
}

/** 读取该面板已落盘的 session（标题、上下文都从这里来）。 */
export async function readPanelSession(windowId: string, panelId: string) {
  const scope = sessionScopeForFaWindowId(windowId);
  if (!scope) {
    return null;
  }
  return await readTerminalPanelSession(scope, panelId);
}

/**
 * 先落盘再广播。落盘拒绝（秩不升高）时只 hydrate 空槽，不假装写入成功。
 * 失败一律吞掉——标题不是关键路径，绝不能让它影响 agent 本体。
 */
export async function writeAgentSessionTitle(args: {
  aggregator: ForegroundActivityAggregator;
  panelId: string;
  source: AgentSessionTitleSource;
  sessionId?: string | undefined;
  title: string;
  windowId: string;
}): Promise<{ applied: boolean; ok: boolean }> {
  try {
    const sessionScope = sessionScopeForFaWindowId(args.windowId);
    if (!sessionScope) {
      return { applied: false, ok: false };
    }
    const persisted = await setTerminalPanelSessionTitle(
      sessionScope,
      args.panelId,
      {
        source: args.source,
        title: args.title,
        ...(args.sessionId ? { sessionId: args.sessionId } : {}),
      }
    );
    if (!persisted.ok) {
      return { applied: false, ok: false };
    }
    if (persisted.applied && persisted.title) {
      args.aggregator.setAgentSessionTitle(args.windowId, args.panelId, {
        source: persisted.source ?? args.source,
        ...(persisted.sessionId ? { sessionId: persisted.sessionId } : {}),
        title: persisted.title,
      });
      return { applied: true, ok: true };
    }
    if (persisted.title && persisted.source) {
      args.aggregator.hydrateAgentSessionTitle(args.windowId, args.panelId, {
        source: persisted.source,
        ...(persisted.sessionId ? { sessionId: persisted.sessionId } : {}),
        title: persisted.title,
      });
    }
    return { applied: false, ok: true };
  } catch {
    return { applied: false, ok: false };
  }
}

/** 将持久化标题切换到新的主会话作用域，并同步 FA 的规范镜像。 */
export async function reconcileAgentSessionTitleScope(args: {
  aggregator: ForegroundActivityAggregator;
  panelId: string;
  sessionId?: string | undefined;
  windowId: string;
}): Promise<boolean> {
  try {
    const sessionScope = sessionScopeForFaWindowId(args.windowId);
    if (!sessionScope) {
      return false;
    }
    const persisted = await reconcileTerminalPanelSessionTitleScope(
      sessionScope,
      args.panelId,
      args.sessionId
    );
    if (!persisted.ok) {
      return false;
    }
    if (persisted.title && persisted.source) {
      args.aggregator.hydrateAgentSessionTitle(args.windowId, args.panelId, {
        source: persisted.source,
        ...(persisted.sessionId ? { sessionId: persisted.sessionId } : {}),
        title: persisted.title,
      });
    } else {
      args.aggregator.clearAgentSessionTitle(args.windowId, args.panelId);
    }
    return true;
  } catch {
    return false;
  }
}
