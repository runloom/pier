import {
  type AgentSessionTitleSource,
  deriveAgentSessionTitleFromPrompt,
} from "@shared/agent-session-title.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import { readTerminalPanelSession } from "../../state/terminal-session-state.ts";
import { setTerminalPanelSessionTitle } from "../../state/terminal-session-title.ts";
import {
  findAppWindowByElectronId,
  findWindowContext,
} from "../../windows/window-identity.ts";
import type { ForegroundActivityAggregator } from "../foreground-activity/types.ts";
import { refineAgentSessionTitleFromPrompt } from "./agent-session-title-refine.ts";
import { installAllAgentHooks } from "./integrations/registry.ts";

/**
 * FA / hook 的 windowId（Electron BrowserWindow.id 串）→ session JSON 的
 * record UUID。勿把 Electron id 直接当 session 键。
 */
function sessionScopeForFaWindowId(windowId: string): string | null {
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

/**
 * PromptSubmit / Stop 旁路：写产品 sessionTitle。
 * 不进入 activityStatusForHookEvent；失败一律吞掉。
 *
 * FA / hook 的 windowId 是 Electron `BrowserWindow.id` 串；session JSON 键是
 * 窗口 record UUID——读写盘前必须经 sessionScopeForFaWindowId 转换。
 */
export async function applyAgentSessionTitleFromHookEvent(args: {
  aggregator: ForegroundActivityAggregator;
  event: AgentHookEventPayload;
}): Promise<void> {
  const { aggregator, event } = args;
  if (event.event === "PromptSubmit") {
    await autoNameFromPromptSubmit(aggregator, event);
    return;
  }
  if (
    event.event === "Stop" ||
    event.event === "TurnCompleted" ||
    event.event === "SessionStart"
  ) {
    await hydrateFromPersistedSession(aggregator, event);
  }
}

function promptSnippetOf(event: AgentHookEventPayload): string | undefined {
  if (event.v === 2 && event.promptSnippet?.trim()) {
    return event.promptSnippet;
  }
  return promptSnippetFromMetadata(event.metadataBase64);
}

function promptSnippetFromMetadata(
  metadataBase64: string | null | undefined
): string | undefined {
  if (!metadataBase64) {
    return;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(metadataBase64, "base64").toString("utf8")
    );
    if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) {
      return;
    }
    const record = parsed as Record<string, unknown>;
    for (const key of ["promptSnippet", "prompt_snippet", "prompt"] as const) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
  } catch {
    return;
  }
}

let hooksSelfHealInFlight: Promise<void> | null = null;

/** PromptSubmit 无文案时重装 hooks 一次（旧 worktree 可能盖掉 prompt 提取）。 */
function selfHealAgentHooksIfNeeded(): void {
  if (hooksSelfHealInFlight) {
    return;
  }
  hooksSelfHealInFlight = installAllAgentHooks()
    .catch(() => undefined)
    .finally(() => {
      hooksSelfHealInFlight = null;
    });
}

async function autoNameFromPromptSubmit(
  aggregator: ForegroundActivityAggregator,
  event: AgentHookEventPayload
): Promise<void> {
  const snippet = promptSnippetOf(event);
  if (!snippet) {
    selfHealAgentHooksIfNeeded();
    return;
  }
  const derived = deriveAgentSessionTitleFromPrompt(snippet);
  if (!derived) {
    return;
  }
  const written = await writeTitle({
    aggregator,
    panelId: event.panelId,
    replaceAuto: false,
    source: "auto",
    title: derived,
    windowId: event.windowId,
  });
  if (!(written.applied && snippet)) {
    return;
  }
  refineAgentSessionTitleFromPrompt(snippet, derived)
    .then(async (refined) => {
      if (!refined) {
        return;
      }
      await writeTitle({
        aggregator,
        panelId: event.panelId,
        replaceAuto: true,
        source: "auto",
        title: refined,
        windowId: event.windowId,
      });
    })
    .catch(() => undefined);
}

async function hydrateFromPersistedSession(
  aggregator: ForegroundActivityAggregator,
  event: AgentHookEventPayload
): Promise<void> {
  const sessionScope = sessionScopeForFaWindowId(event.windowId);
  if (!sessionScope) {
    return;
  }
  const session = await readTerminalPanelSession(sessionScope, event.panelId);
  const title = session?.sessionTitle?.trim();
  const source = session?.sessionTitleSource;
  if (!(title && source)) {
    return;
  }
  aggregator.hydrateAgentSessionTitle(event.windowId, event.panelId, {
    source,
    title,
  });
}

export async function writeAgentSessionTitle(args: {
  aggregator: ForegroundActivityAggregator;
  panelId: string;
  source: AgentSessionTitleSource;
  title: string;
  windowId: string;
}): Promise<{ applied: boolean; ok: boolean }> {
  return writeTitle({ ...args, replaceAuto: false });
}

async function writeTitle(args: {
  aggregator: ForegroundActivityAggregator;
  panelId: string;
  replaceAuto: boolean;
  source: AgentSessionTitleSource;
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
        replaceAuto: args.replaceAuto,
        source: args.source,
        title: args.title,
      }
    );
    if (!persisted.ok) {
      return { applied: false, ok: false };
    }
    if (persisted.applied && persisted.title) {
      args.aggregator.setAgentSessionTitle(args.windowId, args.panelId, {
        replaceAuto: args.replaceAuto,
        source: persisted.source ?? args.source,
        title: persisted.title,
      });
      return { applied: true, ok: true };
    }
    // 未 applied（如 auto 撞已有标题）：只 hydrate 空槽，不假装写入成功。
    args.aggregator.hydrateAgentSessionTitle(args.windowId, args.panelId, {
      source: args.source,
      title: args.title,
    });
    return { applied: false, ok: true };
  } catch {
    return { applied: false, ok: false };
  }
}
