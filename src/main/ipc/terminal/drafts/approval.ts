import { foregroundActivityService } from "../../foreground-activity.ts";
import type { NativeAddon } from "../native-addon.ts";

/** Observed interaction state blocks task delivery, never answers approval. */
export function terminalInputNeedsUser(
  nativePanelId: string,
  addon: NativeAddon
): boolean {
  const separator = nativePanelId.indexOf("::");
  const windowId = nativePanelId.slice(0, separator),
    panelId = nativePanelId.slice(separator + 2);
  const activity = foregroundActivityService
    .snapshot(windowId)
    .activities.find((a) => a.panelId === panelId);
  if (activity?.kind !== "agent") return false;
  if (activity.status === "waiting") return true;
  // Auxiliary startup guard for Codex versions with the hooks review screen.
  // This never establishes readiness; initial tasks use native argv instead.
  if (activity.agentId !== "codex") return false;
  const screen = addon.readViewportText?.(nativePanelId);
  return Boolean(
    screen?.includes("Hooks need review") &&
      screen.includes("Trust all and continue") &&
      screen.includes("Press enter to confirm")
  );
}
