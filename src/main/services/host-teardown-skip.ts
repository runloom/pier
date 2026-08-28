import { foregroundActivityService } from "../ipc/foreground-activity.ts";
import { listRunningAgentPanelIds } from "../state/terminal-session-state.ts";
import { agentSessionEndedInForeground } from "./foreground-activity/agent-session-ended.ts";

/** L2: panels whose agent already ended in-window must not get host-teardown. */
export function skipPanelIdsForHostTeardown(
  recordId: string,
  electronWindowId: string
): string[] {
  return listRunningAgentPanelIds(recordId).filter((panelId) =>
    agentSessionEndedInForeground(
      panelId,
      electronWindowId,
      foregroundActivityService.hasAgentPresence(panelId, electronWindowId)
    )
  );
}
