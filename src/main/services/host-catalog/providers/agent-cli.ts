import { AGENT_CATALOG } from "@shared/agent-catalog.ts";
import { isAgentUpdateOffered } from "@shared/agent-lifecycle/update-offer.ts";
import {
  type AgentLifecycleProbe,
  agentLifecycleProbeSchema,
} from "@shared/contracts/agent/lifecycle.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { CatalogItem } from "@shared/contracts/host-catalog/runtime.ts";
import {
  type CatalogDomainSnapshot,
  emptyDomainSnapshot,
} from "@shared/contracts/host-catalog/runtime.ts";
import { fingerprintPath } from "../fingerprint.ts";
import type { DomainSnapshotStore } from "../persist.ts";
import type { CatalogProvider } from "../types.ts";

export interface AgentCliCatalogProviderOptions {
  detect: () => Promise<{ detectedIds: readonly AgentKind[] }>;
  persist: DomainSnapshotStore;
  probe: (checkLatest: boolean) => Promise<readonly AgentLifecycleProbe[]>;
}

function presenceOf(probe: AgentLifecycleProbe): CatalogItem["presence"] {
  if (probe.installedButBroken) {
    return "broken";
  }
  return probe.detected ? "present" : "missing";
}

function itemFromProbe(probe: AgentLifecycleProbe): CatalogItem {
  const entry = AGENT_CATALOG.find(
    (candidate) => candidate.id === probe.agentId
  );
  return {
    details: probe,
    domain: "agent-cli",
    id: probe.agentId,
    label: entry?.label ?? probe.agentId,
    localVersion: probe.version,
    presence: presenceOf(probe),
    remoteVersion: probe.latestVersion,
    updateOffered: isAgentUpdateOffered(probe),
  };
}

function detailsForMissing(
  previous: CatalogItem | undefined
): AgentLifecycleProbe | null {
  const parsed = agentLifecycleProbeSchema.safeParse(previous?.details);
  if (!parsed.success) {
    return null;
  }
  return {
    ...parsed.data,
    canUninstall: false,
    detected: false,
    installedButBroken: false,
    installs: [],
    isConflict: false,
    latestVersion: null,
    uninstallMode: "none",
    uninstallTargetPath: null,
    uninstallTargetSource: null,
    updateAvailable: false,
    updateOffered: false,
    version: null,
  };
}

function itemFromDetection(
  agentId: AgentKind,
  detected: ReadonlySet<AgentKind>,
  previous: CatalogItem | undefined
): CatalogItem {
  const entry = AGENT_CATALOG.find((candidate) => candidate.id === agentId);
  const present = detected.has(agentId);
  const parsed = agentLifecycleProbeSchema.safeParse(previous?.details);
  const details = ((): unknown => {
    if (!present) {
      return detailsForMissing(previous);
    }
    if (parsed.success) {
      return {
        ...parsed.data,
        updateOffered: isAgentUpdateOffered(parsed.data),
      };
    }
    return previous?.details ?? null;
  })();
  return {
    details,
    domain: "agent-cli",
    id: agentId,
    label: entry?.label ?? agentId,
    localVersion: present ? (previous?.localVersion ?? null) : null,
    presence: present ? "present" : "missing",
    remoteVersion: present ? (previous?.remoteVersion ?? null) : null,
    updateOffered:
      present && parsed.success ? isAgentUpdateOffered(parsed.data) : false,
  };
}

function snapshotFromItems(
  items: CatalogItem[],
  fingerprint: string | null
): CatalogDomainSnapshot {
  return {
    ...emptyDomainSnapshot("agent-cli"),
    fingerprint,
    items,
  };
}

export function createAgentCliCatalogProvider(
  options: AgentCliCatalogProviderOptions
): CatalogProvider {
  return {
    domain: "agent-cli",
    fingerprint: (env) => fingerprintPath(env.env.PATH),
    persist: (snapshot) => options.persist.write(snapshot),
    async probeLocal(env) {
      const previous = await options.persist.read();
      const previousById = new Map(
        previous.items.map((item) => [item.id, item])
      );
      const { detectedIds } = await options.detect();
      const detected = new Set(detectedIds);
      const items = AGENT_CATALOG.map((entry) =>
        itemFromDetection(entry.id, detected, previousById.get(entry.id))
      );
      return snapshotFromItems(items, fingerprintPath(env.env.PATH));
    },
    async probeDerived() {
      const previous = await options.persist.read();
      const probes = await options.probe(false);
      return snapshotFromItems(probes.map(itemFromProbe), previous.fingerprint);
    },
    async probeRemote() {
      const previous = await options.persist.read();
      const probes = await options.probe(true);
      return snapshotFromItems(probes.map(itemFromProbe), previous.fingerprint);
    },
    readPersisted: () => options.persist.read(),
  };
}
