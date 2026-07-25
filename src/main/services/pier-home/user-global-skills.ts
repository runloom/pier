import { homedir } from "node:os";
import { join } from "node:path";
import type { PierHomeUserGlobalSkillView } from "@shared/contracts/pier-home-skills.ts";
import { createSkillDiscoveryAdapterRegistry } from "../project-skills/adapters.ts";
import { deriveUserGlobalEffects } from "../project-skills/effective-matrix.ts";
import {
  enumerateUserGlobalSkills,
  expandUserRoot,
} from "../project-skills/enumeration.ts";

/**
 * Read-only agent-global skills for Pier Home (design §0.2 / ADR A).
 * Never writes under ~/.
 */
export async function listPierHomeUserGlobalSkills(options?: {
  installedAgents?: ReadonlySet<string>;
}): Promise<PierHomeUserGlobalSkillView[]> {
  const home = homedir();
  const registry = createSkillDiscoveryAdapterRegistry();
  const enumeration = await enumerateUserGlobalSkills({
    registry,
    homeDir: home,
    withMetadata: true,
  });
  return enumeration.entries.map((entry) => ({
    root: entry.root,
    directoryName: entry.directoryName,
    name: entry.name || entry.directoryName,
    description: entry.description,
    absolutePath: join(
      expandUserRoot(entry.root, home),
      entry.directoryName,
      "SKILL.md"
    ),
    effects: deriveUserGlobalEffects({
      registry,
      root: entry.root,
      directoryName: entry.directoryName,
      managed: [],
      unmanaged: [],
      ...(options?.installedAgents === undefined
        ? {}
        : { installedAgents: options.installedAgents }),
    }),
  }));
}
