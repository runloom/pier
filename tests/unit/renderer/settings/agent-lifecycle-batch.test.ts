import type { AgentLifecycleProbe } from "@shared/contracts/agent/lifecycle.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isLifecycleUpdateCandidate,
  useAgentLifecycleStore,
} from "../../../../src/renderer/stores/agent-lifecycle.store.ts";

function makeProbe(
  partial: Partial<AgentLifecycleProbe> & Pick<AgentLifecycleProbe, "agentId">
): AgentLifecycleProbe {
  return {
    canInstall: true,
    detected: true,
    installedButBroken: false,
    installs: [],
    isConflict: false,
    latestVersion: null,
    support: "full",
    updateAvailable: false,
    updateMode: "versioned",
    updateOffered: false,
    version: "1.0.0",
    ...partial,
  };
}

describe("isLifecycleUpdateCandidate", () => {
  it("matches agents that show an Update button", () => {
    expect(
      isLifecycleUpdateCandidate(
        makeProbe({ agentId: "gemini", updateOffered: true })
      )
    ).toBe(true);
    expect(
      isLifecycleUpdateCandidate(
        makeProbe({ agentId: "gemini", updateOffered: false })
      )
    ).toBe(false);
    expect(
      isLifecycleUpdateCandidate(
        makeProbe({ agentId: "gemini", canInstall: false, updateOffered: true })
      )
    ).toBe(false);
    expect(
      isLifecycleUpdateCandidate(
        makeProbe({ agentId: "gemini", updateOffered: true }),
        { disabled: true }
      )
    ).toBe(false);
  });
});

describe("runMany job phases", () => {
  beforeEach(() => {
    useAgentLifecycleStore.setState({
      failureById: {},
      isProbing: false,
      jobById: {},
      lastProbeAt: null,
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
