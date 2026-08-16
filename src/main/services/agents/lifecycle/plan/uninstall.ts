/**
 * Source-aware managed uninstall plans (L1 project defaults).
 * Package names / formulas come only from AgentLifecycleSpec channels.
 */

import { platform } from "node:os";
import type {
  AgentLifecycleSpec,
  InstallChannel,
  UninstallChannel,
} from "../specs/types.ts";
import {
  brewPackageTokenFromBinPath,
  resolveBrewQueryName,
} from "./brew-token.ts";
import {
  filterUninstallChannels,
  type InstallSourceHint,
} from "./source-policy.ts";
import {
  type PlannedInvocation,
  type PlannedPlan,
  previewPlan,
} from "./types.ts";

export type { InstallSourceHint } from "./source-policy.ts";
export { filterUninstallChannels } from "./source-policy.ts";

/**
 * Map reversible install channels → uninstall channels.
 * Does not map official-script (no managed rm).
 */
export function deriveUninstallChannels(
  spec: AgentLifecycleSpec
): UninstallChannel[] {
  const out: UninstallChannel[] = [];
  for (const channel of spec.install) {
    const mapped = installToUninstall(channel);
    if (mapped) {
      out.push(mapped);
    }
  }
  return out;
}

function installToUninstall(channel: InstallChannel): UninstallChannel | null {
  switch (channel.kind) {
    case "npm":
      return { kind: "npm-uninstall", package: channel.package };
    case "brew":
      return {
        kind: "brew-uninstall",
        formula: channel.formula,
        ...(channel.tap === undefined ? {} : { tap: channel.tap }),
        ...(channel.cask === true ? { cask: true } : {}),
      };
    case "pipx":
      return { kind: "pipx-uninstall", package: channel.package };
    case "uv":
      return { kind: "uv-uninstall", package: channel.package };
    default:
      return null;
  }
}

function resolveUninstallChannels(
  spec: AgentLifecycleSpec
): UninstallChannel[] {
  // Explicit uninstall (including []) wins over derive.
  if (spec.uninstall !== undefined) {
    return [...spec.uninstall];
  }
  return deriveUninstallChannels(spec);
}

function brewUninstallStep(
  channel: Extract<UninstallChannel, { kind: "brew-uninstall" }>,
  host: "posix" | "win",
  defaultBinPath?: string | null
): PlannedInvocation | null {
  if (host === "win") {
    return null;
  }
  if (channel.cask === true && platform() !== "darwin") {
    return null;
  }
  const name = resolveBrewQueryName(
    channel,
    brewPackageTokenFromBinPath(defaultBinPath)
  );
  if (channel.cask === true) {
    return {
      kind: "argv",
      file: "brew",
      args: ["uninstall", "--cask", name],
    };
  }
  return {
    kind: "argv",
    file: "brew",
    args: ["uninstall", name],
  };
}

function uninstallChannelStep(
  channel: UninstallChannel,
  options: {
    host: "posix" | "win";
    defaultBinPath?: string | null;
  }
): PlannedInvocation | null {
  switch (channel.kind) {
    case "npm-uninstall":
      return {
        kind: "argv",
        file: "npm",
        args: ["uninstall", "-g", channel.package],
      };
    case "brew-uninstall":
      return brewUninstallStep(channel, options.host, options.defaultBinPath);
    case "pipx-uninstall":
      return {
        kind: "argv",
        file: "pipx",
        args: ["uninstall", channel.package],
      };
    case "uv-uninstall":
      return {
        kind: "argv",
        file: "uv",
        args: ["tool", "uninstall", channel.package],
      };
    default:
      return null;
  }
}

/**
 * Single-step managed uninstall plan for the PATH-default install source.
 * Falls back to `defaultShellCommands.uninstall` when no channel maps.
 */
export function buildUninstallPlan(
  spec: AgentLifecycleSpec,
  options: {
    host: "posix" | "win";
    installSource?: InstallSourceHint;
    defaultBinPath?: string | null;
  }
): PlannedPlan | null {
  if (spec.support !== "full") {
    return null;
  }

  const channels = resolveUninstallChannels(spec);
  const filtered = filterUninstallChannels(channels, options.installSource);

  // Single step only — first mappable channel after filter (no || fallback).
  const first = filtered[0];
  if (first) {
    const step = uninstallChannelStep(first, {
      host: options.host,
      ...(options.defaultBinPath === undefined
        ? {}
        : { defaultBinPath: options.defaultBinPath }),
    });
    if (step) {
      return { steps: [step], preview: previewPlan([step]) };
    }
  }

  const shell = spec.defaultShellCommands?.uninstall?.trim();
  if (shell) {
    return { steps: [{ kind: "shell", command: shell }], preview: shell };
  }
  return null;
}

export function buildUninstallCommand(
  spec: AgentLifecycleSpec,
  options: {
    host: "posix" | "win";
    installSource?: InstallSourceHint;
    defaultBinPath?: string | null;
  }
): { shellCommand: string; preview: string } | null {
  const plan = buildUninstallPlan(spec, options);
  if (!plan) {
    return null;
  }
  return { shellCommand: plan.preview, preview: plan.preview };
}

/** PATH-default install slice needed for probe uninstall fields (K19). */
export interface UninstallProbeDefaultInstall {
  path: string;
  source: string;
}

export interface UninstallProbeFields {
  canUninstall: boolean;
  defaultUninstallCommand: string | null;
  uninstallMode: "managed" | "none";
  uninstallTargetPath: string | null;
  uninstallTargetSource: string | null;
}

/**
 * Pure probe fields for managed uninstall (unit-testable without enumerate).
 * - canUninstall: full + buildUninstallPlan !== null
 * - targets: always from defaultInstall when present (even if canUninstall false)
 */
export function resolveUninstallProbeFields(
  spec: AgentLifecycleSpec,
  host: "posix" | "win",
  defaultInstall: UninstallProbeDefaultInstall | null
): UninstallProbeFields {
  const uninstallPlan =
    spec.support === "full"
      ? buildUninstallPlan(spec, {
          host,
          installSource: defaultInstall?.source ?? null,
          defaultBinPath: defaultInstall?.path ?? null,
        })
      : null;

  const canUninstall = uninstallPlan !== null;
  const preview = uninstallPlan?.preview.trim() ?? "";
  return {
    canUninstall,
    defaultUninstallCommand: preview.length > 0 ? preview : null,
    uninstallMode: canUninstall ? "managed" : "none",
    uninstallTargetPath: defaultInstall?.path ?? null,
    uninstallTargetSource: defaultInstall?.source ?? null,
  };
}
