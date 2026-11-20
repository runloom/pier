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
  probe: (options: {
    checkLatest: boolean;
    force?: boolean;
  }) => Promise<readonly AgentLifecycleProbe[]>;
  /**
   * Agent ids whose own config disables Pier's status integration
   * (e.g. pi `extensions` overrides). Optional so tests and non-desktop
   * hosts never read user config.
   */
  readStatusHooksDisabledAgents?: (
    env: NodeJS.ProcessEnv
  ) => Promise<ReadonlySet<AgentKind>>;
}

function presenceOf(probe: AgentLifecycleProbe): CatalogItem["presence"] {
  if (probe.installedButBroken) {
    return "broken";
  }
  return probe.detected ? "present" : "missing";
}

function withoutStatusHooksFlag(details: unknown): unknown {
  if (!(details && typeof details === "object")) {
    return details;
  }
  const { statusHooksDisabledByConfig: _stale, ...rest } = details as Record<
    string,
    unknown
  >;
  return rest;
}

/**
 * 配置诊断是当前事实，不是历史：持久化快照里的旧值必须先剥掉，
 * 再按本次读取结果决定是否重新挂上，否则用户改完 pi 设置后仍显示旧警告。
 */
function withStatusHooksFlag(details: unknown, disabled: boolean): unknown {
  const clean = withoutStatusHooksFlag(details);
  if (!(disabled && clean && typeof clean === "object")) {
    return clean;
  }
  return {
    ...(clean as Record<string, unknown>),
    statusHooksDisabledByConfig: true,
  };
}

function itemFromProbe(
  probe: AgentLifecycleProbe,
  statusHooksDisabled: boolean
): CatalogItem {
  const entry = AGENT_CATALOG.find(
    (candidate) => candidate.id === probe.agentId
  );
  return {
    details: withStatusHooksFlag(probe, statusHooksDisabled),
    domain: "agent-cli",
    id: probe.agentId,
    label: entry?.label ?? probe.agentId,
    localVersion: probe.version,
    presence: presenceOf(probe),
    remoteVersion: probe.latestVersion,
    updateOffered: isAgentUpdateOffered(probe),
  };
}

async function readDisabledStatusHooks(
  options: AgentCliCatalogProviderOptions,
  env: NodeJS.ProcessEnv
): Promise<ReadonlySet<AgentKind>> {
  const reader = options.readStatusHooksDisabledAgents;
  if (!reader) {
    return new Set();
  }
  try {
    return await reader(env);
  } catch (error) {
    console.warn("[host-catalog] status-hook diagnostics failed:", error);
    return new Set();
  }
}

function snapshotFromProbes(
  probes: readonly AgentLifecycleProbe[],
  disabled: ReadonlySet<AgentKind>,
  fingerprint: string | null
): CatalogDomainSnapshot {
  return snapshotFromItems(
    probes.map((probe) => itemFromProbe(probe, disabled.has(probe.agentId))),
    fingerprint
  );
}

function detailsForMissing(
  previous: CatalogItem | undefined
): AgentLifecycleProbe | null {
  const parsed = agentLifecycleProbeSchema.safeParse(previous?.details);
  if (!parsed.success) {
    return null;
  }
  const { statusHooksDisabledByConfig: _stale, ...details } = parsed.data;
  return {
    ...details,
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
  previous: CatalogItem | undefined,
  statusHooksDisabled: boolean
): CatalogItem {
  const entry = AGENT_CATALOG.find((candidate) => candidate.id === agentId);
  const present = detected.has(agentId);
  const parsed = agentLifecycleProbeSchema.safeParse(previous?.details);
  const details = ((): unknown => {
    if (!present) {
      return detailsForMissing(previous);
    }
    if (parsed.success) {
      return withStatusHooksFlag(
        { ...parsed.data, updateOffered: isAgentUpdateOffered(parsed.data) },
        statusHooksDisabled
      );
    }
    return withoutStatusHooksFlag(previous?.details ?? null);
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
      const disabled = await readDisabledStatusHooks(options, env.env);
      const items = AGENT_CATALOG.map((entry) =>
        itemFromDetection(
          entry.id,
          detected,
          previousById.get(entry.id),
          disabled.has(entry.id)
        )
      );
      return snapshotFromItems(items, fingerprintPath(env.env.PATH));
    },
    async probeDerived(env) {
      const previous = await options.persist.read();
      const probes = await options.probe({ checkLatest: false });
      const disabled = await readDisabledStatusHooks(options, env.env);
      return snapshotFromProbes(probes, disabled, previous.fingerprint);
    },
    async probeRemote(env) {
      const previous = await options.persist.read();
      const probes = await options.probe({
        checkLatest: true,
        ...(env.force === true ? { force: true } : {}),
      });
      const disabled = await readDisabledStatusHooks(options, env.env);
      return snapshotFromProbes(probes, disabled, previous.fingerprint);
    },
    readPersisted: () => options.persist.read(),
  };
}
