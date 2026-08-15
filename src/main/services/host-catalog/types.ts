import type {
  CatalogChangedPayload,
  CatalogClass,
  CatalogDomainId,
  CatalogDomainSnapshot,
  CatalogSnapshot,
} from "@shared/contracts/host-catalog/runtime.ts";

export interface CatalogProbeEnv {
  env: NodeJS.ProcessEnv;
  force?: boolean;
  now: number;
}

export interface CatalogProvider {
  readonly domain: CatalogDomainId;
  fingerprint?(env: CatalogProbeEnv): string | null;
  persist(snapshot: CatalogDomainSnapshot): Promise<void>;
  probeDerived?(env: CatalogProbeEnv): Promise<CatalogDomainSnapshot>;
  probeLocal(env: CatalogProbeEnv): Promise<CatalogDomainSnapshot>;
  probeRemote?(env: CatalogProbeEnv): Promise<CatalogDomainSnapshot>;
  readPersisted(): Promise<CatalogDomainSnapshot>;
}

export interface CatalogEnsureFreshOptions {
  class?: CatalogClass | "all";
  force?: boolean;
}

export interface HostCatalogRuntime {
  ensureFresh(
    domain: CatalogDomainId,
    options?: CatalogEnsureFreshOptions
  ): Promise<CatalogDomainSnapshot>;
  hydrateFromDisk(): Promise<CatalogSnapshot>;
  invalidate(domain: CatalogDomainId): void;
  register(provider: CatalogProvider): void;
  snapshot(): CatalogSnapshot;
  snapshotDomain(domain: CatalogDomainId): CatalogDomainSnapshot | null;
  startScheduler(): void;
  waitForScheduler(): Promise<void>;
}

export interface CreateHostCatalogRuntimeOptions {
  getEnv?: () => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>;
  now?: () => number;
  onChanged?: (payload: CatalogChangedPayload) => void;
  /** Idle between A and B. Tests use 0. Default 2000. */
  schedulerIdleMs?: number;
}
