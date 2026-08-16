import { isAgentUpdateOffered } from "@shared/agent-lifecycle/update-offer.ts";
import { isAgentUpdateAvailable } from "@shared/agent-lifecycle/version-compare.ts";
import type {
  AgentLifecycleProbe,
  AgentLifecycleProbeRequest,
} from "@shared/contracts/agent/lifecycle.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { defaultCommandsFor, guideCommandsFor } from "./defaults.ts";
import { fetchLatestVersion } from "./latest.ts";
import { resolveUninstallProbeFields } from "./plan/uninstall.ts";
import { buildInstallPlan } from "./plan.ts";
import { enumerateInstalls, isInstallConflict } from "./sources/path-enum.ts";
import {
  getAgentLifecycleSpec,
  listAgentLifecycleSpecs,
} from "./specs/index.ts";
import { resolveUpdateMode } from "./specs/types.ts";

export async function probeOneAgent(
  agentId: AgentKind,
  env: NodeJS.ProcessEnv | null,
  opts: {
    deep: boolean;
    checkLatest: boolean;
    envDegraded: boolean;
    host: "posix" | "win";
  }
): Promise<AgentLifecycleProbe> {
  const spec = getAgentLifecycleSpec(agentId);
  const versionArgs = spec.versionArgs ?? ["--version"];
  const updateMode = resolveUpdateMode(spec);
  const canInstall =
    spec.support === "full" && buildInstallPlan(spec, opts.host) !== null;

  if (!env) {
    const defaults = defaultCommandsFor(agentId);
    const uninstallFields = resolveUninstallProbeFields(spec, opts.host, null);
    return {
      agentId,
      canInstall,
      detected: false,
      envDegraded: true,
      guideCommands: guideCommandsFor(agentId),
      installedButBroken: false,
      installs: [],
      isConflict: false,
      latestVersion: null,
      support: spec.support,
      updateAvailable: false,
      updateMode,
      updateOffered: false,
      version: null,
      ...defaults,
      // Prefer probe-host uninstall fields over process-platform defaults.
      ...uninstallFields,
    };
  }

  const shouldEnumerate =
    opts.deep || spec.support === "full" || spec.support === "guided";

  const installs = shouldEnumerate
    ? await enumerateInstalls({
        bins: spec.expectedBins,
        env,
        versionArgs,
      })
    : [];

  const defaultInstall = installs.find((i) => i.isPathDefault) ?? installs[0];
  const hasRunnable = installs.some((i) => i.runnable);
  const installedButBroken =
    installs.length > 0 && installs.every((i) => !i.runnable);
  const detected = hasRunnable;
  const version = defaultInstall?.runnable
    ? defaultInstall.version
    : (defaultInstall?.version ?? null);

  let latestVersion: string | null = null;
  if (
    opts.checkLatest &&
    updateMode === "versioned" &&
    spec.support === "full"
  ) {
    // Match latest probe to the active install channel (brew ≠ npm lag).
    latestVersion = await fetchLatestVersion(spec, env, {
      defaultBinPath: defaultInstall?.path ?? null,
      installSource: defaultInstall?.source ?? null,
    });
  }

  const updateAvailable =
    updateMode === "versioned" &&
    latestVersion !== null &&
    isAgentUpdateAvailable(version, latestVersion);
  const detectedOrBroken = detected || installedButBroken;
  const updateOffered = isAgentUpdateOffered({
    canInstall,
    detected: detectedOrBroken,
    installedButBroken,
    support: spec.support,
    updateAvailable,
  });

  const defaults = defaultCommandsFor(
    agentId,
    defaultInstall?.source,
    defaultInstall?.path
  );
  const uninstallFields = resolveUninstallProbeFields(
    spec,
    opts.host,
    defaultInstall
      ? { path: defaultInstall.path, source: defaultInstall.source }
      : null
  );
  return {
    agentId,
    canInstall,
    detected: detectedOrBroken,
    envDegraded: opts.envDegraded,
    guideCommands: guideCommandsFor(agentId),
    installedButBroken,
    installs,
    isConflict: isInstallConflict(installs),
    latestVersion,
    support: spec.support,
    updateAvailable,
    updateMode,
    updateOffered,
    version,
    ...defaults,
    // Prefer probe-host uninstall fields over process-platform defaults.
    ...uninstallFields,
  };
}

export async function probeAgents(
  request: AgentLifecycleProbeRequest,
  options: {
    resolveEnv: () => Promise<NodeJS.ProcessEnv>;
    host: "posix" | "win";
  }
): Promise<AgentLifecycleProbe[]> {
  let env: NodeJS.ProcessEnv | null = null;
  let envDegraded = false;
  try {
    env = await options.resolveEnv();
  } catch {
    envDegraded = true;
    env = null;
  }
  const ids =
    request.agentIds && request.agentIds.length > 0
      ? request.agentIds
      : listAgentLifecycleSpecs().map((s) => s.agentId);
  const deep = request.deep === true;
  const checkLatest = request.checkLatest === true;
  const results: AgentLifecycleProbe[] = [];
  const concurrency = 4;
  for (let i = 0; i < ids.length; i += concurrency) {
    const slice = ids.slice(i, i + concurrency);
    const part = await Promise.all(
      slice.map((id) =>
        probeOneAgent(id, env, {
          deep,
          checkLatest,
          envDegraded,
          host: options.host,
        })
      )
    );
    results.push(...part);
  }
  return results;
}
