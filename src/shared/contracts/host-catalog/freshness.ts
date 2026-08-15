import type { CatalogClass, CatalogDomainId } from "./runtime.ts";

export interface CatalogFreshnessPolicy {
  derivedTtlMs: number;
  localTtlMs: number;
  remoteTtlMs: number;
}

export interface CatalogFreshnessState {
  fingerprint: string | null;
  hasItems: boolean;
  localProbedAt: number | null;
  remoteCheckedAt: number | null;
}

export const CATALOG_DOMAIN_TTL: Record<
  CatalogDomainId,
  CatalogFreshnessPolicy
> = {
  "agent-cli": {
    derivedTtlMs: 10 * 60 * 1000,
    localTtlMs: 10 * 60 * 1000,
    remoteTtlMs: 10 * 60 * 1000,
  },
  "managed-plugin": {
    derivedTtlMs: 0,
    localTtlMs: Number.POSITIVE_INFINITY,
    remoteTtlMs: 10 * 60 * 1000,
  },
  "pier-app": {
    derivedTtlMs: 0,
    localTtlMs: Number.POSITIVE_INFINITY,
    remoteTtlMs: 6 * 60 * 60 * 1000,
  },
};

function ttlForClass(
  classKind: CatalogClass,
  policy: CatalogFreshnessPolicy
): number {
  if (classKind === "remote") {
    return policy.remoteTtlMs;
  }
  if (classKind === "derived") {
    return policy.derivedTtlMs;
  }
  return policy.localTtlMs;
}

function probedAtForClass(
  classKind: CatalogClass,
  state: CatalogFreshnessState
): number | null {
  return classKind === "remote" ? state.remoteCheckedAt : state.localProbedAt;
}

export function shouldSkipCatalogClass(options: {
  class: CatalogClass;
  currentFingerprint?: string | null;
  force?: boolean;
  now?: number;
  policy: CatalogFreshnessPolicy;
  state: CatalogFreshnessState;
}): boolean {
  if (options.force === true) {
    return false;
  }
  const probedAt = probedAtForClass(options.class, options.state);
  if (probedAt === null) {
    return false;
  }
  if (
    options.class !== "remote" &&
    options.currentFingerprint !== undefined &&
    options.currentFingerprint !== options.state.fingerprint
  ) {
    return false;
  }
  const ttl = ttlForClass(options.class, options.policy);
  if (ttl <= 0) {
    return false;
  }
  const now = options.now ?? Date.now();
  return now - probedAt < ttl;
}

export function countFreshUpdateOffers(options: {
  items: readonly { updateOffered: boolean }[];
  now?: number;
  policy: CatalogFreshnessPolicy;
  remoteCheckedAt: number | null;
}): number {
  const remoteFresh = shouldSkipCatalogClass({
    class: "remote",
    policy: options.policy,
    state: {
      fingerprint: null,
      hasItems: options.items.length > 0,
      localProbedAt: options.remoteCheckedAt,
      remoteCheckedAt: options.remoteCheckedAt,
    },
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  if (!remoteFresh) {
    return 0;
  }
  let count = 0;
  for (const item of options.items) {
    if (item.updateOffered) {
      count += 1;
    }
  }
  return count;
}
