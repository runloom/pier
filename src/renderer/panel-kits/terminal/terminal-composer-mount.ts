import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";

/** F4 同款纪律：挂载判定单一实现，面板 inset 与组件渲染必须同口径。 */
export function canUseAgentComposer(input: {
  activityKind: string | undefined;
  restored: boolean;
}): boolean {
  return !input.restored && input.activityKind === "agent";
}

export function shouldMountAgentComposer(input: {
  activityKind: string | undefined;
  open: boolean;
  restored: boolean;
}): boolean {
  return input.open && canUseAgentComposer(input);
}

export function isAgentComposerEligibleForPanel(panelId: string): boolean {
  return (
    useForegroundActivityStore.getState().activities[panelId]?.kind === "agent"
  );
}
