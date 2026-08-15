import type {
  CatalogChangedPayload,
  CatalogDomainId,
  CatalogDomainSnapshot,
  CatalogEnsureFreshRequest,
  CatalogSnapshot,
} from "@shared/contracts/host-catalog/runtime.ts";
import { emptyCatalogSnapshot } from "@shared/contracts/host-catalog/runtime.ts";
import { create } from "zustand";

interface HostCatalogState {
  applyDomain: (snapshot: CatalogDomainSnapshot) => void;
  applySnapshot: (snapshot: CatalogSnapshot) => void;
  domains: CatalogSnapshot["domains"];
  ensureFresh: (
    request: CatalogEnsureFreshRequest
  ) => Promise<CatalogDomainSnapshot>;
  reset: () => void;
}

const ensureInFlight = new Map<string, Promise<CatalogDomainSnapshot>>();

function ensureKey(request: CatalogEnsureFreshRequest): string {
  return `${request.domain}:${request.class ?? "all"}:${request.force === true ? "1" : "0"}`;
}

export const useHostCatalogStore = create<HostCatalogState>((set, get) => ({
  domains: {},
  applySnapshot(snapshot) {
    const merged: CatalogSnapshot["domains"] = { ...snapshot.domains };
    const current = get().domains;
    for (const domain of Object.keys(current) as CatalogDomainId[]) {
      const existing = current[domain];
      const incoming = merged[domain];
      if (existing && incoming && incoming.revision < existing.revision) {
        merged[domain] = existing;
      } else if (existing && !incoming) {
        merged[domain] = existing;
      }
    }
    set({ domains: merged });
  },
  applyDomain(snapshot) {
    const previous = get().domains[snapshot.domain];
    if (previous && snapshot.revision < previous.revision) {
      return;
    }
    set({
      domains: {
        ...get().domains,
        [snapshot.domain]: snapshot,
      },
    });
  },
  async ensureFresh(request) {
    const api = window.pier?.catalog;
    if (!api?.ensureFresh) {
      throw new Error("host-catalog unavailable");
    }
    const key = ensureKey(request);
    const existing = ensureInFlight.get(key);
    if (existing) {
      return existing;
    }
    const payload: CatalogEnsureFreshRequest = {
      domain: request.domain,
      ...(request.class === undefined ? {} : { class: request.class }),
      ...(request.force === true ? { force: true } : {}),
    };
    const pending = api.ensureFresh(payload).then((snapshot) => {
      get().applyDomain(snapshot);
      return snapshot;
    });
    ensureInFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (ensureInFlight.get(key) === pending) {
        ensureInFlight.delete(key);
      }
    }
  },
  reset() {
    ensureInFlight.clear();
    set({ domains: emptyCatalogSnapshot().domains });
  },
}));

export function selectDomain(
  domain: CatalogDomainId
): CatalogDomainSnapshot | undefined {
  return useHostCatalogStore.getState().domains[domain];
}

/**
 * Subscribe first, then pull. Matches NCS / usage-data so a broadcast
 * between subscribe and the initial snapshot is not dropped.
 */
export function initHostCatalog(): { dispose: () => void } {
  const api = window.pier?.catalog;
  if (!api) {
    return { dispose: () => undefined };
  }
  const applyChanged = (payload: CatalogChangedPayload): void => {
    useHostCatalogStore.getState().applyDomain(payload.snapshot);
  };
  const unsubscribe = api.onChanged(applyChanged);
  api
    .snapshot()
    .then((snapshot) => {
      useHostCatalogStore.getState().applySnapshot(snapshot);
    })
    .catch((err: unknown) => {
      console.error("[host-catalog] initial snapshot failed:", err);
    });
  return {
    dispose: () => {
      unsubscribe();
      useHostCatalogStore.getState().reset();
    },
  };
}
