import { useUsagePollingLease as useSharedUsagePollingLease } from "@pier/plugin-api/account-usage/renderer";
import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";

export function useUsagePollingLease(
  context: ExternalRendererPluginContext,
  consumerId: string,
  active: boolean
): void {
  useSharedUsagePollingLease(context, consumerId, active, "pier.grok");
}
