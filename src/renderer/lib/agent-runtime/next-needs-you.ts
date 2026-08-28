import {
  type AgentRuntimeIndexEntry,
  isAgentIndexNeedsYou,
  type SortAgentIndexEntriesOptions,
  sortAgentIndexEntries,
} from "@shared/contracts/agent/runtime-index.ts";

/** Next Needs-you entry after the focused panel, wrapping. */
export function nextNeedsYouEntry(
  entries: readonly AgentRuntimeIndexEntry[],
  activePanelId: string | null,
  options?: SortAgentIndexEntriesOptions
): AgentRuntimeIndexEntry | null {
  const waiting = sortAgentIndexEntries(entries, options).filter((entry) =>
    isAgentIndexNeedsYou(entry.status)
  );
  if (waiting.length === 0) {
    return null;
  }
  const currentIndex =
    activePanelId == null
      ? -1
      : waiting.findIndex((entry) => entry.panelId === activePanelId);
  if (currentIndex < 0) {
    return waiting[0] ?? null;
  }
  return waiting[(currentIndex + 1) % waiting.length] ?? null;
}
