import type { AgentKind } from "../../../../shared/contracts/agent.ts";
import { createSkillDiscoveryAdapterRegistry } from "../adapters.ts";
import { systemSkillsCacheRoot } from "./cache.ts";

/**
 * Additive extra skill-root env for product skills. v1: no adapter fills
 * `systemSkillExtraRoot` — discovery symlinks are the delivery path. Do not
 * use keys that replace an agent's entire skills root.
 */
export function systemSkillExtraRootEnvPatch(args: {
  extraRoot: { envKey: string } | undefined;
  systemSkillsRoot: string;
}): Record<string, string> {
  const key = args.extraRoot?.envKey.trim() ?? "";
  if (!key) return {};
  return { [key]: args.systemSkillsRoot };
}

export function mergeSystemSkillExtraRootEnv(args: {
  agentKind: AgentKind;
  env: Record<string, string>;
  userData: string;
}): Record<string, string> {
  const adapter = createSkillDiscoveryAdapterRegistry().get(args.agentKind);
  const patch = systemSkillExtraRootEnvPatch({
    extraRoot: adapter?.systemSkillExtraRoot,
    systemSkillsRoot: systemSkillsCacheRoot(args.userData),
  });
  const next = { ...args.env };
  for (const [key, value] of Object.entries(patch)) {
    if (next[key]) continue;
    next[key] = value;
  }
  return next;
}
