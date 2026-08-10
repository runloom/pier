import type { AgentLifecycleProbe } from "@shared/contracts/agent/lifecycle.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_LIFECYCLE_CHECK_LATEST_TTL_MS,
  AGENT_LIFECYCLE_PROBE_TTL_MS,
  isLifecycleUpdateCandidate,
  mergeProbes,
  shouldSkipFullCatalogProbe,
  useAgentLifecycleStore,
  withDerivedUpdateFlags,
} from "../../../../src/renderer/stores/agent-lifecycle.store.ts";

function makeProbe(
  partial: Partial<AgentLifecycleProbe> & Pick<AgentLifecycleProbe, "agentId">
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
    updateAvailable: false,
    updateMode: "versioned",
    updateOffered: false,
    uninstallMode: "none",
    version: "1.0.0",
    ...partial,
  };
}

describe("mergeProbes / withDerivedUpdateFlags", () => {
  it("recomputes updateAvailable when retaining previous latest (no sticky false positives)", () => {
    const prev = {
      gemini: makeProbe({
        agentId: "gemini",
        version: "0.50.0",
        latestVersion: "0.53.1",
        updateAvailable: true,
        updateOffered: true,
        updateMode: "versioned",
      }),
    };
    // After upgrade: new probe has current=latest, but skipped checkLatest → no latest field.
    const next = [
      makeProbe({
        agentId: "gemini",
        version: "0.53.1",
        latestVersion: null,
        updateAvailable: false,
        updateOffered: false,
        updateMode: "versioned",
        detected: true,
      }),
    ];
    const merged = mergeProbes(prev, next);
    expect(merged.gemini?.latestVersion).toBe("0.53.1");
    expect(merged.gemini?.updateAvailable).toBe(false);
    expect(merged.gemini?.updateOffered).toBe(false);
  });

  it("does not OR-sticky updateOffered from a previous reinstall/false-positive probe", () => {
    const prev = {
      claude: makeProbe({
        agentId: "claude",
        version: "2.1.222",
        latestVersion: "2.1.222",
        updateAvailable: false,
        // Old bug: offered true even when already latest
        updateOffered: true,
        updateMode: "versioned",
      }),
    };
    const next = [
      makeProbe({
        agentId: "claude",
        version: "2.1.222",
        latestVersion: null,
        updateAvailable: false,
        updateOffered: false,
        updateMode: "versioned",
        detected: true,
      }),
    ];
    const merged = mergeProbes(prev, next);
    expect(merged.claude?.updateOffered).toBe(false);
    expect(merged.claude?.updateAvailable).toBe(false);
  });

  it("trusts a fresh latest probe from main without sticky previous flags", () => {
    const prev = {
      amp: makeProbe({
        agentId: "amp",
        version: "1.0.0",
        latestVersion: "2.0.0",
        updateAvailable: true,
        updateOffered: true,
      }),
    };
    const next = [
      makeProbe({
        agentId: "amp",
        version: "2.0.0",
        latestVersion: "2.0.0",
        updateAvailable: false,
        updateOffered: false,
        updateMode: "versioned",
        detected: true,
      }),
    ];
    const merged = mergeProbes(prev, next);
    expect(merged.amp?.updateAvailable).toBe(false);
    expect(merged.amp?.updateOffered).toBe(false);
  });

  it("withDerivedUpdateFlags marks only true upgrades", () => {
    const base = makeProbe({
      agentId: "gemini",
      version: "0.53.1",
      updateMode: "versioned",
      detected: true,
      canInstall: true,
    });
    expect(withDerivedUpdateFlags(base, "0.53.1").updateAvailable).toBe(false);
    expect(withDerivedUpdateFlags(base, "0.60.0").updateAvailable).toBe(true);
  });
});

describe("isLifecycleUpdateCandidate", () => {
  it("counts versioned updates and broken installs for Update all", () => {
    expect(
      isLifecycleUpdateCandidate(
        makeProbe({
          agentId: "gemini",
          updateOffered: true,
          updateAvailable: true,
        })
      )
    ).toBe(true);
    // reinstall-mode always offers a row button, but is not a batch candidate
    expect(
      isLifecycleUpdateCandidate(
        makeProbe({
          agentId: "cursor",
          updateOffered: true,
          updateAvailable: false,
          updateMode: "reinstall",
        })
      )
    ).toBe(false);
    expect(
      isLifecycleUpdateCandidate(
        makeProbe({
          agentId: "aider",
          updateOffered: true,
          installedButBroken: true,
        })
      )
    ).toBe(true);
    expect(
      isLifecycleUpdateCandidate(
        makeProbe({
          agentId: "gemini",
          canInstall: false,
          updateAvailable: true,
        })
      )
    ).toBe(false);
    expect(
      isLifecycleUpdateCandidate(
        makeProbe({
          agentId: "gemini",
          updateAvailable: true,
        }),
        { disabled: true }
      )
    ).toBe(false);
  });
});

describe("shouldSkipFullCatalogProbe", () => {
  const base = {
    lastProbeAt: 1_000_000,
    lastCheckLatestAt: 1_000_000,
    probesById: {
      claude: makeProbe({ agentId: "claude" }),
    },
    now: 1_000_000 + 60_000,
  };

  it("skips when local cache is fresh and checkLatest is not requested", () => {
    expect(
      shouldSkipFullCatalogProbe({
        ...base,
        checkLatest: false,
      })
    ).toBe(true);
  });

  it("skips checkLatest when both local and latest TTLs are fresh", () => {
    expect(
      shouldSkipFullCatalogProbe({
        ...base,
        checkLatest: true,
      })
    ).toBe(true);
  });

  it("does not skip checkLatest when latest TTL expired (even if local is fresh)", () => {
    expect(
      shouldSkipFullCatalogProbe({
        ...base,
        lastCheckLatestAt: base.now - AGENT_LIFECYCLE_CHECK_LATEST_TTL_MS - 1,
        checkLatest: true,
      })
    ).toBe(false);
  });

  it("does not skip when local TTL expired", () => {
    expect(
      shouldSkipFullCatalogProbe({
        ...base,
        lastProbeAt: base.now - AGENT_LIFECYCLE_PROBE_TTL_MS - 1,
        checkLatest: false,
      })
    ).toBe(false);
  });

  it("does not skip force, targeted agentIds, or empty cache", () => {
    expect(shouldSkipFullCatalogProbe({ ...base, force: true })).toBe(false);
    expect(
      shouldSkipFullCatalogProbe({
        ...base,
        agentIds: ["claude"],
      })
    ).toBe(false);
    expect(
      shouldSkipFullCatalogProbe({
        ...base,
        probesById: {},
      })
    ).toBe(false);
  });

  it("treats empty agentIds as full catalog (not targeted)", () => {
    expect(
      shouldSkipFullCatalogProbe({
        ...base,
        agentIds: [],
        checkLatest: true,
      })
    ).toBe(true);
  });
});

describe("probe TTL integration", () => {
  beforeEach(() => {
    useAgentLifecycleStore.setState({
      failureById: {},
      isProbing: false,
      jobById: {},
      lastProbeAt: null,
      lastCheckLatestAt: null,
      probesById: {},
    });
  });

  it("skips full-catalog checkLatest when cache is still fresh", async () => {
    const probeApi = vi.fn(async () => [
      makeProbe({ agentId: "claude", latestVersion: "2.0.0" }),
    ]);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        agents: {
          lifecycle: {
            cancel: vi.fn(async () => false),
            onProgress: vi.fn(() => () => undefined),
            probe: probeApi,
            run: vi.fn(),
          },
        },
      },
    });

    await useAgentLifecycleStore.getState().probe(undefined, {
      checkLatest: true,
    });
    expect(probeApi).toHaveBeenCalledTimes(1);
    expect(useAgentLifecycleStore.getState().lastCheckLatestAt).not.toBeNull();

    await useAgentLifecycleStore.getState().probe(undefined, {
      checkLatest: true,
    });
    expect(probeApi).toHaveBeenCalledTimes(1);

    await useAgentLifecycleStore.getState().probe(undefined, {
      force: true,
      checkLatest: true,
    });
    expect(probeApi).toHaveBeenCalledTimes(2);
  });

  it("softRevalidate keeps previous rows and stays silent when cache exists", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probeApi = vi.fn(async () => {
      await gate;
      return [makeProbe({ agentId: "claude", version: "3.0.0" })];
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        agents: {
          lifecycle: {
            cancel: vi.fn(async () => false),
            onProgress: vi.fn(() => () => undefined),
            probe: probeApi,
            run: vi.fn(),
          },
        },
      },
    });

    const now = Date.now();
    useAgentLifecycleStore.setState({
      probesById: {
        claude: makeProbe({ agentId: "claude", version: "1.0.0" }),
      },
      // Expired so softRevalidate actually runs.
      lastProbeAt: now - AGENT_LIFECYCLE_PROBE_TTL_MS - 1,
      lastCheckLatestAt: now - AGENT_LIFECYCLE_CHECK_LATEST_TTL_MS - 1,
    });

    const pending = useAgentLifecycleStore.getState().softRevalidate();
    // Cached row remains; soft path does not flip isProbing.
    expect(useAgentLifecycleStore.getState().probesById.claude?.version).toBe(
      "1.0.0"
    );
    expect(useAgentLifecycleStore.getState().isProbing).toBe(false);

    release();
    await pending;
    expect(useAgentLifecycleStore.getState().probesById.claude?.version).toBe(
      "3.0.0"
    );
    expect(useAgentLifecycleStore.getState().isProbing).toBe(false);
  });

  it("coalesces concurrent full-catalog soft probes into one main call", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probeApi = vi.fn(async () => {
      await gate;
      return [makeProbe({ agentId: "claude", version: "9.0.0" })];
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        agents: {
          lifecycle: {
            cancel: vi.fn(async () => false),
            onProgress: vi.fn(() => () => undefined),
            probe: probeApi,
            run: vi.fn(),
          },
        },
      },
    });

    const a = useAgentLifecycleStore.getState().probe(undefined, {
      checkLatest: true,
    });
    const b = useAgentLifecycleStore.getState().probe(undefined, {
      checkLatest: true,
    });
    expect(probeApi).toHaveBeenCalledTimes(1);
    expect(useAgentLifecycleStore.getState().isProbing).toBe(true);

    release();
    await Promise.all([a, b]);
    expect(probeApi).toHaveBeenCalledTimes(1);
    expect(useAgentLifecycleStore.getState().isProbing).toBe(false);
    expect(useAgentLifecycleStore.getState().probesById.claude?.version).toBe(
      "9.0.0"
    );
  });
});

describe("runMany job phases", () => {
  beforeEach(() => {
    useAgentLifecycleStore.setState({
      failureById: {},
      isProbing: false,
      jobById: {},
      lastProbeAt: null,
      lastCheckLatestAt: null,
      probesById: {
        gemini: makeProbe({
          agentId: "gemini",
          updateOffered: true,
          updateAvailable: true,
          latestVersion: "0.53.1",
          version: "0.46.0",
        }),
        aider: makeProbe({
          agentId: "aider",
          updateOffered: true,
          installedButBroken: true,
          detected: true,
        }),
        opencode: makeProbe({
          agentId: "opencode",
          updateOffered: true,
          updateAvailable: true,
          latestVersion: "1.18.13",
          version: "1.18.10",
        }),
      },
    });
  });

  it("uses queued → running → cleared phases (no 100% then 排队中)", async () => {
    const release: Array<() => void> = [];
    const gates = [0, 1, 2].map(
      () =>
        new Promise<void>((resolve) => {
          release.push(resolve);
        })
    );
    let started = 0;
    const run = vi.fn(async (agentId: string) => {
      const index = started;
      started += 1;
      await gates[index];
      return {
        action: "update" as const,
        agentId,
        ok: true,
      };
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        agents: {
          lifecycle: {
            cancel: vi.fn(async () => false),
            onProgress: vi.fn(() => () => undefined),
            probe: vi.fn(async () => []),
            run,
          },
        },
      },
    });

    const ids = useAgentLifecycleStore.getState().updatableIds();
    expect(ids.sort()).toEqual(["aider", "gemini", "opencode"].sort());

    const pending = useAgentLifecycleStore.getState().runMany(ids, "update");
    await vi.waitFor(() => {
      // Concurrency 3: all three claimed as running.
      const jobs = useAgentLifecycleStore.getState().jobById;
      expect(Object.keys(jobs).length).toBe(3);
      for (const id of ids) {
        expect(jobs[id]?.phase).toBe("running");
      }
    });

    release[0]?.();
    await vi.waitFor(() => {
      expect(
        Object.keys(useAgentLifecycleStore.getState().jobById).length
      ).toBe(2);
    });
    // Finished agent must not remain as queued.
    for (const id of ids) {
      const job = useAgentLifecycleStore.getState().jobById[id];
      if (job) {
        expect(job.phase).toBe("running");
      }
    }

    for (const r of release.slice(1)) {
      r();
    }
    await pending;
    expect(useAgentLifecycleStore.getState().jobById).toEqual({});
    expect(run).toHaveBeenCalledTimes(3);
  });
});
