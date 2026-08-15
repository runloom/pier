import type {
  CatalogChangedPayload,
  CatalogSnapshot,
} from "@shared/contracts/host-catalog/runtime.ts";
import { emptyDomainSnapshot } from "@shared/contracts/host-catalog/runtime.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initHostCatalog,
  useHostCatalogStore,
} from "@/stores/host-catalog/store.ts";

function domainSnapshot(
  revision: number,
  id = "claude"
): CatalogChangedPayload["snapshot"] {
  return {
    ...emptyDomainSnapshot("agent-cli"),
    items: [
      {
        details: null,
        domain: "agent-cli",
        id,
        label: id,
        localVersion: "1.0.0",
        presence: "present",
        remoteVersion: null,
        updateOffered: false,
      },
    ],
    localProbedAt: 1,
    revision,
  };
}

describe("host-catalog store", () => {
  const snapshot = vi.fn<() => Promise<CatalogSnapshot>>();
  const onChanged =
    vi.fn<(cb: (payload: CatalogChangedPayload) => void) => () => void>();

  beforeEach(() => {
    vi.clearAllMocks();
    useHostCatalogStore.getState().reset();
    onChanged.mockImplementation(() => () => undefined);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        catalog: {
          ensureFresh: vi.fn(),
          onChanged,
          snapshot,
        },
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "pier");
  });

  it("hydrates from snapshot after subscribing", async () => {
    const first = domainSnapshot(2);
    snapshot.mockResolvedValue({
      domains: { "agent-cli": first },
      version: 1,
    });

    const { dispose } = initHostCatalog();
    await vi.waitFor(() => {
      expect(
        useHostCatalogStore.getState().domains["agent-cli"]?.revision
      ).toBe(2);
    });
    expect(onChanged).toHaveBeenCalledOnce();
    dispose();
  });

  it("ensureFresh applies the returned domain and joins in-flight calls", async () => {
    const first = domainSnapshot(5);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ensureFresh = vi.fn(async () => {
      await gate;
      return first;
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        catalog: {
          ensureFresh,
          onChanged,
          snapshot,
        },
      },
    });

    const a = useHostCatalogStore.getState().ensureFresh({
      class: "local",
      domain: "agent-cli",
    });
    const b = useHostCatalogStore.getState().ensureFresh({
      class: "local",
      domain: "agent-cli",
    });
    expect(ensureFresh).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([a, b]);
    expect(useHostCatalogStore.getState().domains["agent-cli"]?.revision).toBe(
      5
    );
  });

  it("ignores stale domain broadcasts with a lower revision", () => {
    useHostCatalogStore.getState().applyDomain(domainSnapshot(4));
    useHostCatalogStore.getState().applyDomain(domainSnapshot(3, "codex"));

    expect(
      useHostCatalogStore.getState().domains["agent-cli"]?.items[0]?.id
    ).toBe("claude");
  });
});
