import { platform } from "node:os";
import type {
  AgentLifecycleAction,
  AgentLifecycleGuideCommand,
} from "@shared/contracts/agent/lifecycle.ts";
import { assertAllowedScriptUrl } from "../official-script.ts";
import type {
  AgentLifecycleSpec,
  InstallChannel,
  UpdateChannel,
} from "../specs/types.ts";
import { wslDistroFromPath } from "../wsl.ts";
import { brewPackageTokenFromBinPath } from "./brew-token.ts";
import {
  filterInstallChannels,
  filterUpdateChannels,
  type InstallSourceHint,
  reinstallStepMatchesSource,
} from "./source-policy.ts";
import {
  type PlannedInvocation,
  type PlannedPlan,
  previewPlan,
} from "./types.ts";
import { buildUninstallPlan } from "./uninstall.ts";

export { brewPackageTokenFromBinPath } from "./brew-token.ts";
export type { InstallSourceHint } from "./source-policy.ts";
export { buildUninstallCommand, buildUninstallPlan } from "./uninstall.ts";

function platformKind(): "posix" | "win" {
  return platform() === "win32" ? "win" : "posix";
}

function npmInstallStep(
  pkg: string,
  extraArgs: readonly string[] = []
): PlannedInvocation {
  return {
    kind: "argv",
    file: "npm",
    args: [
      "i",
      "-g",
      `${pkg}@latest`,
      ...extraArgs,
      // Overwrite stale bin links (e.g. nested @sourcegraph/amp → @ampcode/cli).
      "--force",
      "--no-fund",
      "--no-audit",
      "--no-progress",
    ],
  };
}

function npmExtraArgsFromSpec(spec: AgentLifecycleSpec): readonly string[] {
  const npm = spec.install.find((c) => c.kind === "npm");
  return npm?.kind === "npm" && npm.extraArgs ? npm.extraArgs : [];
}

function brewToken(channel: Extract<InstallChannel, { kind: "brew" }>): string {
  return channel.tap ? `${channel.tap}/${channel.formula}` : channel.formula;
}

function brewInstallStep(
  channel: Extract<InstallChannel, { kind: "brew" }>
): PlannedInvocation {
  const name = brewToken(channel);
  if (channel.cask === true) {
    return {
      kind: "argv",
      file: "brew",
      args: ["install", "--cask", name],
    };
  }
  return { kind: "argv", file: "brew", args: ["install", name] };
}

function brewUpgradeStep(
  channel: Extract<InstallChannel, { kind: "brew" }>,
  installedToken?: string | null
): PlannedInvocation {
  // Prefer the actually-installed cask/formula name when known
  // (e.g. claude-code@latest vs claude-code). When Cellar reports the bare
  // formula name but the spec has a tap, keep the tap-qualified token so
  // third-party taps (anomalyco/tap/opencode) upgrade the right package.
  let name = brewToken(channel);
  if (installedToken && installedToken.length > 0) {
    const bare = channel.formula;
    const isBareMatch =
      installedToken === bare || installedToken.endsWith(`/${bare}`);
    name =
      channel.tap && isBareMatch && !installedToken.includes("@")
        ? brewToken(channel)
        : installedToken;
  }
  if (channel.cask === true) {
    return {
      kind: "argv",
      file: "brew",
      args: ["upgrade", "--cask", name],
    };
  }
  return { kind: "argv", file: "brew", args: ["upgrade", name] };
}

function installChannelStep(
  channel: InstallChannel,
  host: "posix" | "win"
): PlannedInvocation | null {
  switch (channel.kind) {
    case "official-script":
      if (channel.platform !== host) {
        return null;
      }
      assertAllowedScriptUrl(channel.url);
      return {
        kind: "official-script",
        platform: channel.platform,
        url: channel.url,
      };
    case "npm":
      return npmInstallStep(channel.package, channel.extraArgs ?? []);
    case "brew":
      if (host === "win") {
        return null;
      }
      if (channel.cask === true && platform() !== "darwin") {
        return null;
      }
      return brewInstallStep(channel);
    case "pipx":
      return {
        kind: "argv",
        file: "pipx",
        args: ["install", channel.package],
      };
    case "uv":
      return {
        kind: "argv",
        file: "uv",
        args: ["tool", "install", `${channel.package}@latest`],
      };
    default:
      return null;
  }
}

function updateChannelStep(
  channel: UpdateChannel,
  spec: AgentLifecycleSpec,
  host: "posix" | "win",
  selfBin: string,
  brewInstalledToken?: string | null
): PlannedInvocation | null {
  switch (channel.kind) {
    case "self":
      return {
        kind: "argv",
        file: selfBin,
        args: [...channel.argv],
      };
    case "reinstall":
      // Expanded only in buildUpdatePlan (multi-step + source filter).
      return null;
    case "npm-latest": {
      const extra = npmExtraArgsFromSpec(spec);
      const npm = spec.install.find((c) => c.kind === "npm");
      if (npm?.kind === "npm") {
        return npmInstallStep(npm.package, extra);
      }
      return spec.npmPackageForLatest
        ? npmInstallStep(spec.npmPackageForLatest, extra)
        : null;
    }
    case "brew-upgrade": {
      const brew = spec.install.find((c) => c.kind === "brew");
      if (brew?.kind !== "brew" || host === "win") {
        return null;
      }
      if (brew.cask === true && platform() !== "darwin") {
        return null;
      }
      return brewUpgradeStep(brew, brewInstalledToken);
    }
    case "pipx-upgrade": {
      const pipx = spec.install.find((c) => c.kind === "pipx");
      if (pipx?.kind !== "pipx") {
        return null;
      }
      return {
        kind: "argv",
        file: "pipx",
        args: ["upgrade", pipx.package],
      };
    }
    case "uv-upgrade": {
      const uv = spec.install.find((c) => c.kind === "uv");
      if (uv?.kind !== "uv") {
        return null;
      }
      return {
        kind: "argv",
        file: "uv",
        args: ["tool", "upgrade", uv.package],
      };
    }
    default:
      return null;
  }
}

/**
 * Reinstall / repair = re-run host-matching install channels.
 * Includes official-script so script-only agents (cursor/kiro/antigravity)
 * still get a non-null update plan.
 */
function reinstallSteps(
  spec: AgentLifecycleSpec,
  host: "posix" | "win"
): PlannedInvocation[] {
  const raw: PlannedInvocation[] = [];
  for (const channel of spec.install) {
    const step = installChannelStep(channel, host);
    if (step) {
      raw.push(step);
    }
  }
  return collectSteps(raw);
}

function collectSteps(steps: PlannedInvocation[]): PlannedInvocation[] {
  const out: PlannedInvocation[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    const key = previewPlan([step]);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(step);
  }
  return out;
}

export function buildInstallPlan(
  spec: AgentLifecycleSpec,
  host: "posix" | "win" = platformKind(),
  options: { installSource?: InstallSourceHint } = {}
): PlannedPlan | null {
  const channels = filterInstallChannels(spec.install, options.installSource);
  const raw: PlannedInvocation[] = [];
  for (const channel of channels) {
    const step = installChannelStep(channel, host);
    if (step) {
      raw.push(step);
    }
  }
  const steps = collectSteps(raw);
  if (steps.length === 0) {
    return null;
  }
  return { steps, preview: previewPlan(steps) };
}

export function buildUpdatePlan(
  spec: AgentLifecycleSpec,
  options: {
    host?: "posix" | "win";
    defaultBinPath?: string | null;
    defaultBinName?: string;
    installSource?: InstallSourceHint;
  } = {}
): PlannedPlan | null {
  const host = options.host ?? platformKind();
  const binName =
    options.defaultBinName ?? spec.expectedBins[0] ?? spec.agentId;
  const selfBin =
    options.defaultBinPath && options.defaultBinPath.length > 0
      ? options.defaultBinPath
      : binName;

  const hasBrewInstall = spec.install.some((c) => c.kind === "brew");
  const channels = filterUpdateChannels(spec.update, options.installSource, {
    hasBrewInstall,
  });
  const source = options.installSource;
  const brewInstalledToken = brewPackageTokenFromBinPath(
    options.defaultBinPath
  );
  const raw: PlannedInvocation[] = [];
  for (const channel of channels) {
    if (channel.kind === "reinstall") {
      const all = reinstallSteps(spec, host);
      const filtered = all.filter((step) =>
        reinstallStepMatchesSource(
          step.kind === "argv"
            ? { kind: step.kind, file: step.file }
            : { kind: step.kind },
          source
        )
      );
      raw.push(...(filtered.length > 0 ? filtered : all));
      continue;
    }
    const step = updateChannelStep(
      channel,
      spec,
      host,
      selfBin,
      brewInstalledToken
    );
    if (step) {
      raw.push(step);
    }
  }
  const steps = collectSteps(raw);
  if (steps.length === 0) {
    return null;
  }
  // Keep ordered fallbacks (same contract as install); runner tries each step.
  return { steps, preview: previewPlan(steps) };
}

export function planLifecycle(
  spec: AgentLifecycleSpec,
  action: AgentLifecycleAction,
  options: {
    defaultBinPath?: string | null;
    wslDistro?: string | null;
    installSource?: InstallSourceHint;
  } = {}
): PlannedPlan | null {
  const host = platformKind();
  const sourceOpts =
    options.installSource === undefined
      ? {}
      : { installSource: options.installSource };
  const binOpts =
    options.defaultBinPath === undefined
      ? {}
      : { defaultBinPath: options.defaultBinPath };

  let plan: PlannedPlan | null;
  if (action === "install") {
    plan = buildInstallPlan(spec, host, sourceOpts);
  } else if (action === "uninstall") {
    plan = buildUninstallPlan(spec, { host, ...sourceOpts, ...binOpts });
  } else {
    // update only — never fall through from uninstall
    plan = buildUpdatePlan(spec, { host, ...binOpts, ...sourceOpts });
  }

  if (!plan) {
    return null;
  }

  const distro =
    options.wslDistro ??
    (options.defaultBinPath ? wslDistroFromPath(options.defaultBinPath) : null);

  if (distro && host === "win") {
    let posixPlan: PlannedPlan | null;
    if (action === "install") {
      posixPlan = buildInstallPlan(spec, "posix", sourceOpts);
    } else if (action === "uninstall") {
      posixPlan = buildUninstallPlan(spec, {
        host: "posix",
        defaultBinPath: null,
        ...sourceOpts,
      });
    } else {
      const updateOpts: {
        host: "posix";
        defaultBinPath: null;
        defaultBinName?: string;
        installSource?: InstallSourceHint;
      } = { host: "posix", defaultBinPath: null };
      const binName = spec.expectedBins[0];
      if (binName) {
        updateOpts.defaultBinName = binName;
      }
      if (options.installSource !== undefined) {
        updateOpts.installSource = options.installSource;
      }
      posixPlan = buildUpdatePlan(spec, updateOpts);
    }
    if (!posixPlan) {
      return plan;
    }
    const wslStep: PlannedInvocation = {
      kind: "wsl",
      distro,
      inner: posixPlan.steps,
    };
    return {
      steps: [wslStep],
      preview: previewPlan([wslStep]),
    };
  }

  return plan;
}

export function buildGuideCommands(
  spec: AgentLifecycleSpec,
  host: "posix" | "win" = platformKind()
): AgentLifecycleGuideCommand[] {
  if (spec.guideCommands && spec.guideCommands.length > 0) {
    return [...spec.guideCommands];
  }
  const plan = buildInstallPlan(spec, host);
  if (!plan) {
    return [];
  }
  return plan.steps.map((step, index) => {
    const command = previewPlan([step]);
    let label = `Step ${index + 1}`;
    if (step.kind === "argv") {
      label = step.file;
    } else if (step.kind === "official-script") {
      label = step.platform === "win" ? "Windows" : "macOS / Linux";
    } else if (step.kind === "wsl") {
      label = "WSL";
    }
    return { label, command };
  });
}

export function buildInstallCommand(
  spec: AgentLifecycleSpec,
  host?: "posix" | "win"
): { shellCommand: string; preview: string } | null {
  const plan = buildInstallPlan(spec, host);
  if (!plan) {
    return null;
  }
  return { shellCommand: plan.preview, preview: plan.preview };
}

export function buildUpdateCommand(
  spec: AgentLifecycleSpec,
  options?: {
    host?: "posix" | "win";
    defaultBinPath?: string | null;
    defaultBinName?: string;
    installSource?: InstallSourceHint;
  }
): { shellCommand: string; preview: string } | null {
  const plan = buildUpdatePlan(spec, options ?? {});
  if (!plan) {
    return null;
  }
  return { shellCommand: plan.preview, preview: plan.preview };
}

export function planLifecycleCommand(
  spec: AgentLifecycleSpec,
  action: AgentLifecycleAction,
  options?: {
    defaultBinPath?: string | null;
    wslDistro?: string | null;
    installSource?: InstallSourceHint;
  }
): { shellCommand: string; preview: string; wslDistro?: string } | null {
  const plan = planLifecycle(spec, action, options ?? {});
  if (!plan) {
    return null;
  }
  const wsl = plan.steps[0]?.kind === "wsl" ? plan.steps[0].distro : undefined;
  return {
    shellCommand: plan.preview,
    preview: plan.preview,
    ...(wsl ? { wslDistro: wsl } : {}),
  };
}
