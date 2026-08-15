import { type AgentKind, agentKindSchema } from "../agent.ts";
import type { CatalogDomainSnapshot } from "./runtime.ts";

export function detectedIdsFromAgentSnapshot(
  snapshot: CatalogDomainSnapshot
): AgentKind[] {
  const ids: AgentKind[] = [];
  for (const item of snapshot.items) {
    if (item.presence !== "present" && item.presence !== "broken") {
      continue;
    }
    const parsed = agentKindSchema.safeParse(item.id);
    if (parsed.success) {
      ids.push(parsed.data);
    }
  }
  return ids;
}
