import { agentLifecycleProbeSchema } from "@shared/contracts/agent/lifecycle.ts";
import { emptyDomainSnapshot } from "@shared/contracts/host-catalog/runtime.ts";
import { beforeEach, describe, expect, it } from "vitest";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentLifecycleStore } from "@/stores/agent-lifecycle.store.ts";
import { probesFromAgentSnapshot } from "@/stores/host-catalog/agent-mirror.ts";
import { useHostCatalogStore } from "@/stores/host-catalog/store.ts";

const claudeProbe = agentLifecycleProbeSchema.parse({
  agentId: "claude",
  canInstall: true,
  canUninstall: false,
  detected: true,
  installedButBroken: false,
  installs: [],
  isConflict: false,
  latestVersion: "1.3.0",
  support: "full",
  uninstallMode: "none",
  updateAvailable: true,
  updateMode: "versioned",
  updateOffered: true,
  version: "1.2.3",
});

describe("agent catalog views", () => {
  beforeEach(() => {
    useHostCatalogStore.getState().reset();
    useAgentDetectStore.setState({
      detectedIds: [],
      hasDetected: false,
      isDetecting: false,
      isRefreshing: false,
    });
    useAgentLifecycleStore.setState({
      lastCheckLatestAt: null,
      lastProbeAt: null,
      probesById: {},
    });
  });

  it("projects probes from an agent-cli snapshot", () => {
    expect(
      probesFromAgentSnapshot({
        ...emptyDomainSnapshot("agent-cli"),
        items: [
          {
            details: claudeProbe,
            domain: "agent-cli",
            id: "claude",
            label: "Claude",
            localVersion: "1.2.3",
            presence: "present",
            remoteVersion: "1.3.0",
            updateOffered: true,
          },
        ],
      })
    ).toEqual([claudeProbe]);
  });

  it("fills detect and lifecycle stores when catalog applyDomain", () => {
    useHostCatalogStore.getState().applyDomain({
      ...emptyDomainSnapshot("agent-cli"),
      items: [
        {
          details: claudeProbe,
          domain: "agent-cli",
          id: "claude",
          label: "Claude",
          localVersion: "1.2.3",
          presence: "present",
          remoteVersion: "1.3.0",
          updateOffered: true,
        },
      ],
      localProbedAt: 100,
      remoteCheckedAt: 200,
      revision: 4,
    });

    expect(useAgentDetectStore.getState()).toMatchObject({
      detectedIds: ["claude"],
      hasDetected: true,
    });
    expect(useAgentLifecycleStore.getState().probesById.claude?.version).toBe(
      "1.2.3"
    );
    expect(useAgentLifecycleStore.getState().lastProbeAt).toBe(100);
    expect(useAgentLifecycleStore.getState().lastCheckLatestAt).toBe(200);
  });

  it("drops a missing agent instead of keeping the previous probe", () => {
    useHostCatalogStore.getState().applyDomain({
      ...emptyDomainSnapshot("agent-cli"),
      items: [
        {
          details: claudeProbe,
          domain: "agent-cli",
          id: "claude",
          label: "Claude",
          localVersion: "1.2.3",
          presence: "present",
          remoteVersion: "1.3.0",
          updateOffered: true,
        },
      ],
      localProbedAt: 100,
      revision: 4,
    });
    useHostCatalogStore.getState().applyDomain({
      ...emptyDomainSnapshot("agent-cli"),
      items: [
        {
          details: null,
          domain: "agent-cli",
          id: "claude",
          label: "Claude",
          localVersion: null,
          presence: "missing",
          remoteVersion: null,
          updateOffered: false,
        },
      ],
      localProbedAt: 200,
      revision: 5,
    });

    expect(useAgentDetectStore.getState().detectedIds).toEqual([]);
    expect(useAgentLifecycleStore.getState().probesById.claude).toBeUndefined();
  });
});
