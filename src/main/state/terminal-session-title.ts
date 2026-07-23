/** Persist product sessionTitle onto terminal panel session JSON. */

import { decideAgentSessionTitleWrite } from "@shared/agent-session-title.ts";
import { ensureTerminalSessionStore } from "./terminal-session-store.ts";

export type SetAgentSessionTitleResult =
  | { applied: boolean; ok: true; title?: string; source?: "auto" | "user" }
  | { ok: false };

/**
 * 持久化产品 sessionTitle。auto 不覆盖已有；user 可覆盖 auto。
 * 面板条目不存在时 ok:true applied:false（失败安全，不抛）。
 */
export async function setTerminalPanelSessionTitle(
  windowId: string,
  panelId: string,
  input: { title: string; source: "auto" | "user"; replaceAuto?: boolean }
): Promise<SetAgentSessionTitleResult> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return { ok: false };
  }
  const s = await ensureTerminalSessionStore();
  let result: SetAgentSessionTitleResult = { applied: false, ok: true };
  s.mutate((state) => {
    const windowState = state.windows[windowId];
    const current = windowState?.panels[panelId];
    if (!(windowState && current)) {
      return state;
    }
    const decision = decideAgentSessionTitleWrite({
      currentSource: current.sessionTitleSource ?? null,
      currentTitle: current.sessionTitle ?? null,
      nextSource: input.source,
      nextTitle: input.title,
      ...(input.replaceAuto === undefined
        ? {}
        : { replaceAuto: input.replaceAuto }),
    });
    if (!decision.apply) {
      result = { applied: false, ok: true };
      return state;
    }
    windowState.panels[panelId] = {
      ...current,
      sessionTitle: decision.title,
      sessionTitleSource: decision.source,
      updatedAt: new Date().toISOString(),
    };
    result = {
      applied: true,
      ok: true,
      source: decision.source,
      title: decision.title,
    };
    return state;
  });
  return result;
}
