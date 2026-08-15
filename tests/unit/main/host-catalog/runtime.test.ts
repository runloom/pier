import type {
  CatalogDomainId,
  CatalogDomainSnapshot,
  CatalogItem,
} from "@shared/contracts/host-catalog/runtime.ts";
import { emptyDomainSnapshot } from "@shared/contracts/host-catalog/runtime.ts";
import { describe, expect, it } from "vitest";
import {
  type CatalogProvider,
  createHostCatalogRuntime,
} from "../../../../src/main/services/host-catalog/service.ts";

function item(id: string, version: string | null = "1.0.0"): CatalogItem {
  return {
    details: null,
    domain: "agent-cli",
    id,
    label: id,
    localVersion: version,
    presence: version ? "present" : "missing",
    remoteVersion: null,
    updateOffered: false,
  };
}

function snapshot(
  domain: CatalogDomainId,
  patch: Partial<CatalogDomainSnapshot> = {}
): CatalogDomainSnapshot {
  return {
    ...emptyDomainSnapshot(domain),
    ...patch,
    domain,
  };
}

function createMemoryProvider(
  domain: CatalogDomainId,
  options: {
    derived?: CatalogDomainSnapshot;
    local?: CatalogDomainSnapshot;
    persisted?: CatalogDomainSnapshot;
    remote?: CatalogDomainSnapshot;
  } = {}
): CatalogProvider & {
  persistCalls: CatalogDomainSnapshot[];
  probeDerivedCalls: number;
  probeLocalCalls: number;
  probeRemoteCalls: number;
  setPersisted(next: CatalogDomainSnapshot): void;
} {
  let persisted = options.persisted ?? emptyDomainSnapshot(domain);
  const persistCalls: CatalogDomainSnapshot[] = [];
  let probeDerivedCalls = 0;
  let probeLocalCalls = 0;
  let probeRemoteCalls = 0;
  return {
    domain,
    persistCalls,
    get probeDerivedCalls() {
      return probeDerivedCalls;
    },
    get probeLocalCalls() {
      return probeLocalCalls;
    },
    get probeRemoteCalls() {
      return probeRemoteCalls;
    },
    persist: async (next) => {
      persistCalls.push(next);
      persisted = next;
    },
    setPersisted(next) {
      persisted = next;
    },
    probeLocal: async () => {
      probeLocalCalls += 1;
      return options.local ?? snapshot(domain, { items: [item("claude")] });
    },
    probeRemote: async () => {
      probeRemoteCalls += 1;
      return (
        options.remote ??
        snapshot(domain, {
          items: [
            {
              ...item("claude"),
              remoteVersion: "2.0.0",
              updateOffered: true,
            },
          ],
        })
      );
    },
    readPersisted: async () => persisted,
    ...(options.derived
      ? {
          probeDerived: async () => {
            probeDerivedCalls += 1;
            return options.derived as CatalogDomainSnapshot;
          },
        }
      : {}),
  };
}

describe("HostCatalogRuntime", () => {
  it("hydrates persisted snapshots without probing", async () => {
    const persisted = snapshot("agent-cli", {
      items: [item("codex")],
      localProbedAt: 10,
      revision: 3,
    });
    const provider = createMemoryProvider("agent-cli", { persisted });
    const runtime = createHostCatalogRuntime({ now: () => 100 });
    runtime.register(provider);

    const all = await runtime.hydrateFromDisk();

    expect(all.domains["agent-cli"]?.items[0]?.id).toBe("codex");
    expect(provider.probeLocalCalls).toBe(0);
    expect(runtime.snapshotDomain("agent-cli")?.revision).toBe(3);
  });

  it("ensureFresh local probes, persists, and increments revision", async () => {
    const provider = createMemoryProvider("agent-cli");
    const runtime = createHostCatalogRuntime({ now: () => 50_000 });
    runtime.register(provider);
    await runtime.hydrateFromDisk();

    const next = await runtime.ensureFresh("agent-cli", { class: "local" });

    expect(next.items[0]?.id).toBe("claude");
    expect(next.localProbedAt).toBe(50_000);
    expect(next.revision).toBe(1);
    expect(provider.persistCalls).toHaveLength(1);
    expect(provider.probeLocalCalls).toBe(1);
  });

  it("skips local probe when TTL is still fresh", async () => {
    const provider = createMemoryProvider("agent-cli", {
      persisted: snapshot("agent-cli", {
        fingerprint: "p",
        items: [item("claude")],
        localProbedAt: 50_000,
        revision: 1,
      }),
    });
    const runtime = createHostCatalogRuntime({
      now: () => 50_000 + 60_000,
    });
    runtime.register(provider);
    await runtime.hydrateFromDisk();

    await runtime.ensureFresh("agent-cli", { class: "local" });

    expect(provider.probeLocalCalls).toBe(0);
  });

  it("force bypasses TTL", async () => {
    const provider = createMemoryProvider("agent-cli", {
      persisted: snapshot("agent-cli", {
        items: [item("claude")],
        localProbedAt: 50_000,
        revision: 1,
      }),
    });
    const runtime = createHostCatalogRuntime({ now: () => 50_001 });
    runtime.register(provider);
    await runtime.hydrateFromDisk();

    await runtime.ensureFresh("agent-cli", { class: "local", force: true });

    expect(provider.probeLocalCalls).toBe(1);
  });

  it("startScheduler runs local then derived then remote", async () => {
    const order: string[] = [];
    const provider = createMemoryProvider("agent-cli");
    const originalLocal = provider.probeLocal;
    const originalRemote = provider.probeRemote;
    provider.probeLocal = async (env) => {
      order.push("local");
      return originalLocal(env);
    };
    provider.probeRemote = async (env) => {
      order.push("remote");
      return originalRemote?.(env) ?? emptyDomainSnapshot("agent-cli");
    };
    const runtime = createHostCatalogRuntime({
      now: () => 1,
      schedulerIdleMs: 0,
    });
    runtime.register(provider);
    await runtime.hydrateFromDisk();
    runtime.startScheduler();
    await runtime.waitForScheduler();
    expect(order).toEqual(["local", "remote"]);
    expect(provider.probeLocalCalls).toBe(1);
    expect(provider.probeRemoteCalls).toBe(1);
  });

  it("invalidate clears timestamps so the next ensureFresh probes again", async () => {
    const provider = createMemoryProvider("agent-cli", {
      persisted: snapshot("agent-cli", {
        items: [item("claude")],
        localProbedAt: 50_000,
        remoteCheckedAt: 50_000,
        revision: 2,
      }),
    });
    const runtime = createHostCatalogRuntime({ now: () => 50_001 });
    runtime.register(provider);
    await runtime.hydrateFromDisk();

    runtime.invalidate("agent-cli");
    await runtime.ensureFresh("agent-cli", { class: "local" });

    expect(provider.probeLocalCalls).toBe(1);
    expect(runtime.snapshotDomain("agent-cli")?.items[0]?.id).toBe("claude");
  });

  it("keeps the sibling timestamp so ensureFresh all honors TTL", async () => {
    const provider = createMemoryProvider("agent-cli");
    const runtime = createHostCatalogRuntime({ now: () => 80_000 });
    runtime.register(provider);
    await runtime.hydrateFromDisk();

    await runtime.ensureFresh("agent-cli", { class: "all" });
    expect(provider.probeLocalCalls).toBe(1);
    expect(provider.probeRemoteCalls).toBe(1);
    expect(runtime.snapshotDomain("agent-cli")?.localProbedAt).toBe(80_000);
    expect(runtime.snapshotDomain("agent-cli")?.remoteCheckedAt).toBe(80_000);

    await runtime.ensureFresh("agent-cli", { class: "all" });
    expect(provider.probeLocalCalls).toBe(1);
    expect(provider.probeRemoteCalls).toBe(1);
  });

  it("force all skips derived when remote exists", async () => {
    const provider = createMemoryProvider("agent-cli", {
      derived: snapshot("agent-cli", { items: [item("claude")] }),
    });
    const runtime = createHostCatalogRuntime({ now: () => 1 });
    runtime.register(provider);
    await runtime.hydrateFromDisk();

    await runtime.ensureFresh("agent-cli", { class: "all", force: true });

    expect(provider.probeLocalCalls).toBe(1);
    expect(provider.probeDerivedCalls).toBe(0);
    expect(provider.probeRemoteCalls).toBe(1);
  });

  it("re-runs local when the live fingerprint changes inside TTL", async () => {
    const provider = createMemoryProvider("agent-cli", {
      persisted: snapshot("agent-cli", {
        fingerprint: "old-path",
        items: [item("claude")],
        localProbedAt: 50_000,
        revision: 1,
      }),
    });
    provider.fingerprint = () => "new-path";
    const runtime = createHostCatalogRuntime({
      now: () => 50_000 + 60_000,
    });
    runtime.register(provider);
    await runtime.hydrateFromDisk();

    await runtime.ensureFresh("agent-cli", { class: "local" });

    expect(provider.probeLocalCalls).toBe(1);
  });

  it("hydrateFromDisk does not overwrite a newer in-memory revision", async () => {
    const provider = createMemoryProvider("agent-cli", {
      persisted: snapshot("agent-cli", {
        items: [item("codex")],
        revision: 1,
      }),
    });
    const runtime = createHostCatalogRuntime({ now: () => 10 });
    runtime.register(provider);
    await runtime.hydrateFromDisk();
    await runtime.ensureFresh("agent-cli", { class: "local", force: true });
    expect(runtime.snapshotDomain("agent-cli")?.revision).toBe(2);

    provider.setPersisted(
      snapshot("agent-cli", {
        items: [item("codex")],
        revision: 1,
      })
    );
    await runtime.hydrateFromDisk();
    expect(runtime.snapshotDomain("agent-cli")?.revision).toBe(2);
    expect(runtime.snapshotDomain("agent-cli")?.items[0]?.id).toBe("claude");
  });
});
