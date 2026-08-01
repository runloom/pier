import type { PierHomeSkillDelivery } from "@shared/contracts/pier-home-skills.ts";
import {
  PIER_PROJECTION_ROOT_AGENTS,
  PIER_PROJECTION_ROOT_CLAUDE,
  skillIdSchema,
} from "@shared/contracts/project-skills.ts";

/** Default when bind omits delivery (historical agents-only). */
export const DEFAULT_MANUAL_BIND_DELIVERY: PierHomeSkillDelivery = {
  agents: true,
  claude: false,
};

export interface PierBindingEntry {
  delivery: PierHomeSkillDelivery;
  skillId: string;
}

export interface PierBindingsDesiredState {
  bindings: PierBindingEntry[];
  generation: number;
  publishedContentDigestsBySkillId: Record<string, string[]>;
  schemaVersion: 2;
}

export function deliveryRoots(delivery: PierHomeSkillDelivery): string[] {
  const roots: string[] = [];
  if (delivery.agents) roots.push(PIER_PROJECTION_ROOT_AGENTS);
  if (delivery.claude) roots.push(PIER_PROJECTION_ROOT_CLAUDE);
  return roots;
}

export function normalizeManualDelivery(
  value: PierHomeSkillDelivery | undefined
): PierHomeSkillDelivery {
  if (!value) return { ...DEFAULT_MANUAL_BIND_DELIVERY };
  const agents = value.agents === true;
  const claude = value.claude === true;
  if (!(agents || claude)) return { ...DEFAULT_MANUAL_BIND_DELIVERY };
  return { agents, claude };
}

function parseDelivery(raw: unknown): PierHomeSkillDelivery | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const record = raw as Record<string, unknown>;
  return {
    agents: record.agents === true,
    claude: record.claude === true,
  };
}

export function emptyDesired(): PierBindingsDesiredState {
  return {
    schemaVersion: 2,
    generation: 0,
    bindings: [],
    publishedContentDigestsBySkillId: {},
  };
}

/** Normalize on-disk v1/v2 (or corrupt) into schema v2. */
export function normalizeDesiredState(raw: unknown): PierBindingsDesiredState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return emptyDesired();
  }
  const record = raw as Record<string, unknown>;
  const generation =
    typeof record.generation === "number" && Number.isFinite(record.generation)
      ? record.generation
      : 0;
  const publishedContentDigestsBySkillId: Record<string, string[]> = {};
  if (
    record.publishedContentDigestsBySkillId &&
    typeof record.publishedContentDigestsBySkillId === "object" &&
    !Array.isArray(record.publishedContentDigestsBySkillId)
  ) {
    for (const [skillId, digests] of Object.entries(
      record.publishedContentDigestsBySkillId as Record<string, unknown>
    )) {
      if (!skillIdSchema.safeParse(skillId).success) continue;
      if (!Array.isArray(digests)) continue;
      publishedContentDigestsBySkillId[skillId] = digests.filter(
        (d): d is string => typeof d === "string"
      );
    }
  }

  if (record.schemaVersion === 2 && Array.isArray(record.bindings)) {
    const bindings: PierBindingEntry[] = [];
    for (const entry of record.bindings) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.skillId !== "string") continue;
      if (!skillIdSchema.safeParse(item.skillId).success) continue;
      bindings.push({
        skillId: item.skillId,
        delivery: normalizeManualDelivery(parseDelivery(item.delivery)),
      });
    }
    bindings.sort((a, b) => a.skillId.localeCompare(b.skillId));
    return {
      schemaVersion: 2,
      generation,
      bindings,
      publishedContentDigestsBySkillId,
    };
  }

  const boundSkillIds = Array.isArray(record.boundSkillIds)
    ? record.boundSkillIds.filter(
        (id): id is string =>
          typeof id === "string" && skillIdSchema.safeParse(id).success
      )
    : [];
  return {
    schemaVersion: 2,
    generation,
    bindings: [...new Set(boundSkillIds)].sort().map((skillId) => ({
      skillId,
      delivery: { ...DEFAULT_MANUAL_BIND_DELIVERY },
    })),
    publishedContentDigestsBySkillId,
  };
}
