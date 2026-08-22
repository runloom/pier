import type { AgentLifecycleProbe } from "@shared/contracts/agent/lifecycle.ts";
import { emptyDomainSnapshot } from "@shared/contracts/host-catalog/runtime.ts";
import { describe, expect, it } from "vitest";
import { createAgentCliCatalogProvider } from "../../../../src/main/services/host-catalog/providers/agent-cli.ts";

function probe(
  patch: Partial<AgentLifecycleProbe> & Pick<AgentLifecycleProbe, "agentId">
): AgentLifecycleProbe {
  return {
    canInstall: true,
    canUninstall: false,
    detected: true,
    installedButBroken: false,
    installs: [],
    isConflict: false,
    latestVersion: null,
    support: "full",
    uninstallMode: "none",
    updateAvailable: false,
    updateMode: "versioned",
    updateOffered: false,
    version: "1.2.3",
    ...patch,
  };
}

describe("createAgentCliCatalogProvider", () => {
  it("maps PATH detection into present/missing items without versions", async () => {
    const provider = createAgentCliCatalogProvider({
      detect: async () => ({ detectedIds: ["claude"] }),
      persist: {
        flush: async () => undefined,
        read: async () => emptyDomainSnapshot("agent-cli"),
        write: async () => undefined,
      },
      probe: async () => [],
    });

    const snapshot = await provider.probeLocal({
      env: { PATH: "/opt/bin" },
      now: 10,
    });

    const claude = snapshot.items.find((item) => item.id === "claude");
    const aider = snapshot.items.find((item) => item.id === "aider");
    expect(claude?.presence).toBe("present");
    expect(claude?.localVersion).toBeNull();
    expect(aider?.presence).toBe("missing");
    expect(snapshot.fingerprint).toBeTruthy();
  });

  it("maps lifecycle probes into versions and keeps probe details", async () => {
    const provider = createAgentCliCatalogProvider({
      detect: async () => ({ detectedIds: ["claude"] }),
      persist: {
        flush: async () => undefined,
        read: async () => emptyDomainSnapshot("agent-cli"),
        write: async () => undefined,
      },
      probe: async () => [
        probe({
          agentId: "claude",
          latestVersion: "1.3.0",
          updateAvailable: true,
          updateOffered: true,
          version: "1.2.3",
        }),
      ],
    });

    if (!provider.probeDerived) {
      throw new Error("expected probeDerived");
    }
    const snapshot = await provider.probeDerived({ env: {}, now: 11 });
    const claude = snapshot.items.find((item) => item.id === "claude");
    expect(claude?.localVersion).toBe("1.2.3");
    expect(claude?.remoteVersion).toBe("1.3.0");
    expect(claude?.updateOffered).toBe(true);
    expect(claude?.details).toMatchObject({
      agentId: "claude",
      version: "1.2.3",
    });
  });

  it("marks broken installs as broken presence", async () => {
    const provider = createAgentCliCatalogProvider({
      detect: async () => ({ detectedIds: [] }),
      persist: {
        flush: async () => undefined,
        read: async () => emptyDomainSnapshot("agent-cli"),
        write: async () => undefined,
      },
      probe: async () => [
        probe({
          agentId: "codex",
          detected: true,
          installedButBroken: true,
          version: null,
        }),
      ],
    });

    if (!provider.probeDerived) {
      throw new Error("expected probeDerived");
    }
    const snapshot = await provider.probeDerived({ env: {}, now: 12 });
    expect(snapshot.items.find((item) => item.id === "codex")?.presence).toBe(
      "broken"
    );
  });

  it("does not treat reinstall-only probes as catalog update offers", async () => {
    const provider = createAgentCliCatalogProvider({
      detect: async () => ({ detectedIds: ["cursor"] }),
      persist: {
        flush: async () => undefined,
        read: async () => emptyDomainSnapshot("agent-cli"),
        write: async () => undefined,
      },
      probe: async () => [
        probe({
          agentId: "cursor",
          updateMode: "reinstall",
          // Stale combined meaning from older probes — catalog must ignore it.
          updateOffered: true,
          updateAvailable: false,
        }),
      ],
    });

    if (!provider.probeDerived) {
      throw new Error("expected probeDerived");
    }
    const snapshot = await provider.probeDerived({ env: {}, now: 13 });
    expect(
      snapshot.items.find((item) => item.id === "cursor")?.updateOffered
    ).toBe(false);
  });

  it("re-derives updateOffered from persisted probe details on local probe", async () => {
    const stale = probe({
      agentId: "cursor",
      updateMode: "reinstall",
      updateOffered: true,
      updateAvailable: false,
    });
    const provider = createAgentCliCatalogProvider({
      detect: async () => ({ detectedIds: ["cursor"] }),
      persist: {
        flush: async () => undefined,
        read: async () => ({
          ...emptyDomainSnapshot("agent-cli"),
          items: [
            {
              details: stale,
              domain: "agent-cli",
              id: "cursor",
              label: "Cursor",
              localVersion: stale.version,
              presence: "present",
              remoteVersion: null,
              updateOffered: true,
            },
          ],
        }),
        write: async () => undefined,
      },
      probe: async () => [],
    });

    const snapshot = await provider.probeLocal({
      env: { PATH: "/opt/bin" },
      now: 14,
    });
    const cursor = snapshot.items.find((item) => item.id === "cursor");
    expect(cursor?.updateOffered).toBe(false);
    expect(
      (cursor?.details as { updateOffered?: boolean } | null)?.updateOffered
    ).toBe(false);
  });

  it("keeps install capability on missing items from previous probe details", async () => {
    const previous = probe({
      agentId: "codex",
      canInstall: true,
      detected: true,
      version: "1.2.3",
    });
    const provider = createAgentCliCatalogProvider({
      detect: async () => ({ detectedIds: [] }),
      persist: {
        flush: async () => undefined,
        read: async () => ({
          ...emptyDomainSnapshot("agent-cli"),
          items: [
            {
              details: previous,
              domain: "agent-cli",
              id: "codex",
              label: "Codex",
              localVersion: previous.version,
              presence: "present",
              remoteVersion: null,
              updateOffered: false,
            },
          ],
        }),
        write: async () => undefined,
      },
      probe: async () => [],
    });

    const snapshot = await provider.probeLocal({
      env: { PATH: "/opt/bin" },
      now: 20,
    });
    const codex = snapshot.items.find((item) => item.id === "codex");
    expect(codex?.presence).toBe("missing");
    expect(codex?.localVersion).toBeNull();
    expect(codex?.details).toMatchObject({
      agentId: "codex",
      canInstall: true,
      canUninstall: false,
      detected: false,
      installedButBroken: false,
      installs: [],
      version: null,
    });
  });
});
