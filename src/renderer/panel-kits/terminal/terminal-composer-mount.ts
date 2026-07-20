/** F4 同款纪律：挂载判定单一实现，面板 inset 与组件渲染必须同口径。 */
export function shouldMountAgentComposer(input: {
  activityKind: string | undefined;
  enabled: boolean;
  restored: boolean;
}): boolean {
  return input.enabled && !input.restored && input.activityKind === "agent";
}
