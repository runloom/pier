import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { useTerminalDraftStore } from "@/stores/terminal-drafts.store.ts";

/** F4 同款纪律：挂载判定单一实现，面板 inset 与组件渲染必须同口径。 */
export function canUseAgentComposer(input: {
  activityKind: string | undefined;
  restored: boolean;
  hasDraft?: boolean;
}): boolean {
  return (
    Boolean(input.hasDraft) ||
    (!input.restored && input.activityKind === "agent")
  );
}

export function shouldMountAgentComposer(input: {
  activityKind: string | undefined;
  open: boolean;
  restored: boolean;
  hasDraft?: boolean;
}): boolean {
  return input.open && canUseAgentComposer(input);
}

export function isAgentComposerEligibleForPanel(panelId: string): boolean {
  return (
    useForegroundActivityStore.getState().activities[panelId]?.kind ===
      "agent" ||
    Boolean(useTerminalDraftStore.getState().drafts[panelId]?.value)
  );
}
