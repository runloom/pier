import { isAgentUpdateOffered } from "@shared/agent-lifecycle/update-offer.ts";
import {
  type AgentLifecycleProbe,
  agentLifecycleProbeSchema,
} from "@shared/contracts/agent/lifecycle.ts";
import type { CatalogDomainSnapshot } from "@shared/contracts/host-catalog/runtime.ts";

export function probesFromAgentSnapshot(
  snapshot: CatalogDomainSnapshot
): AgentLifecycleProbe[] {
  const probes: AgentLifecycleProbe[] = [];
  for (const item of snapshot.items) {
    const parsed = agentLifecycleProbeSchema.safeParse(item.details);
    if (parsed.success) {
      probes.push({
        ...parsed.data,
        updateOffered: isAgentUpdateOffered(parsed.data),
      });
    }
  }
  return probes;
}
