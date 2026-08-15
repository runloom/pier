import {
  CATALOG_DOMAIN_TTL,
  shouldSkipCatalogClass,
} from "@shared/contracts/host-catalog/freshness.ts";
import type {
  CatalogClass,
  CatalogDomainId,
  CatalogDomainSnapshot,
  CatalogSnapshot,
} from "@shared/contracts/host-catalog/runtime.ts";
import { emptyDomainSnapshot } from "@shared/contracts/host-catalog/runtime.ts";
import type {
  CatalogEnsureFreshOptions,
  CatalogProbeEnv,
  CatalogProvider,
  CreateHostCatalogRuntimeOptions,
  HostCatalogRuntime,
} from "./types.ts";

export type { CatalogProvider, HostCatalogRuntime } from "./types.ts";

function freshnessState(snapshot: CatalogDomainSnapshot) {
  return {
    fingerprint: snapshot.fingerprint,
    hasItems: snapshot.items.length > 0,
    localProbedAt: snapshot.localProbedAt,
    remoteCheckedAt: snapshot.remoteCheckedAt,
  };
}

function mergeStamps(
  next: CatalogDomainSnapshot,
  previous: CatalogDomainSnapshot,
  classKind: CatalogClass,
  now: number
): CatalogDomainSnapshot {
  if (classKind === "remote") {
    return {
      ...next,
      localProbedAt: previous.localProbedAt,
      remoteCheckedAt: now,
    };
  }
  return {
    ...next,
    localProbedAt: now,
    remoteCheckedAt: previous.remoteCheckedAt,
  };
}

function classesForEnsure(
  provider: CatalogProvider,
  requested: CatalogClass | "all",
  force: boolean
): CatalogClass[] {
  if (requested !== "all") {
    return [requested];
  }
  if (force && provider.probeRemote) {
    return ["local", "remote"];
  }
  return ["local", "derived", "remote"];
}

export function createHostCatalogRuntime(
  options: CreateHostCatalogRuntimeOptions = {}
): HostCatalogRuntime {
  const providers = new Map<CatalogDomainId, CatalogProvider>();
  const domains: Partial<Record<CatalogDomainId, CatalogDomainSnapshot>> = {};
  const now = options.now ?? Date.now;
  const schedulerIdleMs = options.schedulerIdleMs ?? 2000;
  let schedulerStarted = false;
  let schedulerRun: Promise<void> | null = null;

  async function probeEnv(force: boolean): Promise<CatalogProbeEnv> {
    const env = options.getEnv ? await options.getEnv() : process.env;
    return {
      env,
      now: now(),
      ...(force ? { force: true } : {}),
    };
  }

  function publish(snapshot: CatalogDomainSnapshot): void {
    domains[snapshot.domain] = snapshot;
    options.onChanged?.({ domain: snapshot.domain, snapshot });
  }

  async function commit(
    provider: CatalogProvider,
    next: CatalogDomainSnapshot,
    classKind: CatalogClass
  ): Promise<CatalogDomainSnapshot> {
    const previous =
      domains[provider.domain] ?? emptyDomainSnapshot(provider.domain);
    const stamped = {
      ...mergeStamps(next, previous, classKind, now()),
      domain: provider.domain,
      revision: previous.revision + 1,
    };
    await provider.persist(stamped);
    publish(stamped);
    return stamped;
  }

  function currentOrEmpty(domain: CatalogDomainId): CatalogDomainSnapshot {
    return domains[domain] ?? emptyDomainSnapshot(domain);
  }

  async function runClass(
    provider: CatalogProvider,
    classKind: CatalogClass,
    force: boolean
  ): Promise<CatalogDomainSnapshot> {
    const current = currentOrEmpty(provider.domain);
    const policy = CATALOG_DOMAIN_TTL[provider.domain];
    const env = await probeEnv(force);
    const liveFingerprint = provider.fingerprint?.(env);
    if (
      shouldSkipCatalogClass({
        class: classKind,
        force,
        now: env.now,
        policy,
        state: freshnessState(current),
        ...(liveFingerprint === undefined || liveFingerprint === null
          ? {}
          : { currentFingerprint: liveFingerprint }),
      })
    ) {
      return current;
    }

    if (classKind === "local") {
      return commit(provider, await provider.probeLocal(env), "local");
    }
    if (classKind === "derived") {
      if (!provider.probeDerived) {
        return current;
      }
      return commit(provider, await provider.probeDerived(env), "derived");
    }
    if (!provider.probeRemote) {
      return current;
    }
    return commit(provider, await provider.probeRemote(env), "remote");
  }

  return {
    register(provider) {
      if (providers.has(provider.domain)) {
        throw new Error(
          `host-catalog: provider already registered for ${provider.domain}`
        );
      }
      providers.set(provider.domain, provider);
    },

    async hydrateFromDisk() {
      for (const provider of providers.values()) {
        const persisted = await provider.readPersisted();
        const current = domains[provider.domain];
        if (current && persisted.revision < current.revision) {
          continue;
        }
        const next = {
          ...persisted,
          domain: provider.domain,
        };
        domains[provider.domain] = next;
        options.onChanged?.({ domain: provider.domain, snapshot: next });
      }
      return { domains: { ...domains }, version: 1 } satisfies CatalogSnapshot;
    },

    snapshot() {
      return { domains: { ...domains }, version: 1 };
    },

    snapshotDomain(domain) {
      return domains[domain] ?? null;
    },

    async ensureFresh(domain, ensureOptions: CatalogEnsureFreshOptions = {}) {
      const provider = providers.get(domain);
      if (!provider) {
        throw new Error(`host-catalog: no provider for ${domain}`);
      }
      const force = ensureOptions.force === true;
      const requested = ensureOptions.class ?? "all";
      const classes = classesForEnsure(provider, requested, force);
      let latest = currentOrEmpty(domain);
      for (const classKind of classes) {
        latest = await runClass(provider, classKind, force);
      }
      return latest;
    },

    invalidate(domain) {
      const current = domains[domain];
      if (!current) {
        return;
      }
      const next = {
        ...current,
        localProbedAt: null,
        remoteCheckedAt: null,
        revision: current.revision + 1,
      };
      const provider = providers.get(domain);
      if (provider) {
        provider.persist(next).catch((err: unknown) => {
          console.error("[host-catalog] invalidate persist failed:", err);
        });
      }
      publish(next);
    },

    startScheduler() {
      if (schedulerStarted) {
        return;
      }
      schedulerStarted = true;
      const run = async (): Promise<void> => {
        for (const provider of providers.values()) {
          await runClass(provider, "local", false);
        }
        if (schedulerIdleMs > 0) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, schedulerIdleMs);
          });
        }
        for (const provider of providers.values()) {
          await runClass(provider, "derived", false);
        }
        for (const provider of providers.values()) {
          await runClass(provider, "remote", false);
        }
      };
      schedulerRun = run().catch((err: unknown) => {
        console.error("[host-catalog] scheduler failed", err);
      });
    },

    waitForScheduler() {
      return schedulerRun ?? Promise.resolve();
    },
  };
}
