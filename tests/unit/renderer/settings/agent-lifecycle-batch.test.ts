import type { AgentLifecycleProbe } from "@shared/contracts/agent/lifecycle.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isLifecycleUpdateCandidate,
  mergeProbes,
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

describe("softRevalidate", () => {
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

  it("keeps previous rows and stays silent when cache exists", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const nextProbe = makeProbe({ agentId: "claude", version: "3.0.0" });
    const ensureFresh = vi.fn(async () => {
      await gate;
      return {
        domain: "agent-cli" as const,
        fingerprint: null,
        items: [
          {
            details: nextProbe,
            domain: "agent-cli" as const,
            id: "claude",
            label: "Claude",
            localVersion: "3.0.0",
            presence: "present" as const,
            remoteVersion: null,
            updateOffered: false,
          },
        ],
        localProbedAt: Date.now(),
        remoteCheckedAt: Date.now(),
        revision: Date.now(),
      };
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        catalog: { ensureFresh },
      },
    });

    useAgentLifecycleStore.setState({
      probesById: {
        claude: makeProbe({ agentId: "claude", version: "1.0.0" }),
      },
      lastProbeAt: Date.now(),
      lastCheckLatestAt: Date.now(),
    });

    const pending = useAgentLifecycleStore.getState().softRevalidate();
    expect(useAgentLifecycleStore.getState().probesById.claude?.version).toBe(
      "1.0.0"
    );
    expect(useAgentLifecycleStore.getState().isProbing).toBe(false);

    release();
    await pending;
    expect(ensureFresh).toHaveBeenCalledWith({
      class: "all",
      domain: "agent-cli",
    });
    expect(useAgentLifecycleStore.getState().probesById.claude?.version).toBe(
      "3.0.0"
    );
    expect(useAgentLifecycleStore.getState().isProbing).toBe(false);
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
        catalog: {
          ensureFresh: vi.fn(async () => ({
            domain: "agent-cli",
            fingerprint: null,
            items: [],
            localProbedAt: Date.now(),
            remoteCheckedAt: Date.now(),
            revision: Date.now(),
          })),
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
