import { PIER_APP_ITEM_ID } from "@shared/contracts/host-catalog/pier-app.ts";
import { emptyDomainSnapshot } from "@shared/contracts/host-catalog/runtime.ts";
import { describe, expect, it } from "vitest";
import { createPierAppCatalogProvider } from "../../../../src/main/services/host-catalog/providers/pier-app.ts";

describe("createPierAppCatalogProvider", () => {
  it("exposes the running app version without checking for updates", async () => {
    const provider = createPierAppCatalogProvider({
      getStatus: () => ({
        currentVersion: "0.4.0",
        state: "idle",
      }),
      persist: {
        flush: async () => undefined,
        read: async () => emptyDomainSnapshot("pier-app"),
        write: async () => undefined,
      },
    });

    expect(provider.probeRemote).toBeUndefined();
    const snapshot = await provider.probeLocal({ env: {}, now: 1 });
    const item = snapshot.items.find((row) => row.id === PIER_APP_ITEM_ID);
    expect(item?.localVersion).toBe("0.4.0");
    expect(item?.remoteVersion).toBeNull();
    expect(item?.updateOffered).toBe(false);
  });

  it("keeps a persisted newer available version until status supersedes it", async () => {
    const provider = createPierAppCatalogProvider({
      getStatus: () => ({
        currentVersion: "0.4.0",
        state: "idle",
      }),
      persist: {
        flush: async () => undefined,
        read: async () => ({
          ...emptyDomainSnapshot("pier-app"),
          items: [
            {
              details: { state: "available" },
              domain: "pier-app",
              id: PIER_APP_ITEM_ID,
              label: "Pier",
              localVersion: "0.3.0",
              presence: "present",
              remoteVersion: "0.4.1",
              updateOffered: true,
            },
          ],
        }),
        write: async () => undefined,
      },
    });

    const snapshot = await provider.probeLocal({ env: {}, now: 2 });
    const item = snapshot.items.find((row) => row.id === PIER_APP_ITEM_ID);
    expect(item?.remoteVersion).toBe("0.4.1");
    expect(item?.updateOffered).toBe(true);
  });
});
