import type { AgentKind } from "@shared/contracts/agent.ts";
import type { PanelContext, PanelTabChrome } from "@shared/contracts/panel.ts";
import {
  ensureTerminalPanelSession,
  readTerminalPanelSession,
} from "../../../state/terminal-session-state.ts";
import { foregroundActivityService } from "../../foreground-activity.ts";
import { persistInitialTerminalContext } from "../initial-session.ts";
import { persistInitialTerminalTab } from "../tab-chrome.ts";
export async function prepareTerminalSessionMetadata(input: {
  panelId: string;
  sessionScope: string;
  windowId: string;
  agentId?: AgentKind | undefined;
  context: PanelContext | undefined;
  tab: PanelTabChrome | undefined;
  assertCurrent: () => void;
}): Promise<void> {
  const {
    panelId,
    sessionScope,
    windowId,
    agentId,
    context,
    tab,
    assertCurrent,
  } = input;
  assertCurrent();
  await ensureTerminalPanelSession(sessionScope, panelId);
  if (agentId) {
    const session = await readTerminalPanelSession(sessionScope, panelId);
    assertCurrent();
    const title = session?.sessionTitle?.trim();
    const source = session?.sessionTitleSource;
    if (title && source)
      foregroundActivityService.hydrateAgentSessionTitle(windowId, panelId, {
        source,
        ...(session.sessionTitleSessionId
          ? { sessionId: session.sessionTitleSessionId }
          : {}),
        title,
      });
  }
  assertCurrent();
  await persistInitialTerminalContext(sessionScope, panelId, context);
  assertCurrent();
  await persistInitialTerminalTab(sessionScope, panelId, tab);
}
