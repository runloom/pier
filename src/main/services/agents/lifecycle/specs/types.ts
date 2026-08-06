import type {
  AgentLifecycleGuideCommand,
  AgentLifecycleSupport,
  AgentLifecycleUpdateMode,
} from "@shared/contracts/agent/lifecycle.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";

export type InstallChannel =
  | {
      kind: "official-script";
      platform: "posix" | "win";
      url: string;
    }
  | {
      kind: "npm";
      package: string;
      bin: string;
      /**
       * Extra flags after the package name (e.g. `--ignore-scripts` for Pi).
       * Pier always adds --no-fund / --no-audit / --no-progress.
       */
      extraArgs?: readonly string[];
    }
  | {
      kind: "brew";
      formula: string;
      tap?: string;
      /** Homebrew Cask (macOS). Install: brew install --cask <formula>. */
      cask?: boolean;
    }
  | {
      kind: "pipx";
      package: string;
    }
  | {
      /** Astral uv: `uv tool install <package>@latest`. */
      kind: "uv";
      package: string;
    };

export type UpdateChannel =
  | { kind: "self"; argv: readonly string[] }
  | { kind: "reinstall" }
  | { kind: "npm-latest" }
  | { kind: "brew-upgrade" }
  | { kind: "pipx-upgrade" }
  | { kind: "uv-upgrade" };

/** Reversible package-manager uninstall channels (L1 project defaults). */
export type UninstallChannel =
  | { kind: "npm-uninstall"; package: string }
  | { kind: "brew-uninstall"; formula: string; tap?: string; cask?: boolean }
  | { kind: "pipx-uninstall"; package: string }
  | { kind: "uv-uninstall"; package: string };

export interface AgentLifecycleSpec {
  readonly agentId: AgentKind;
  /**
   * Optional project-default shell one-liners when channels cannot safely
   * generate a plan (L1, not user preference).
   */
  readonly defaultShellCommands?: {
    readonly install?: string;
    readonly update?: string;
    readonly uninstall?: string;
  };
  readonly expectedBins: readonly string[];
  readonly guideCommands?: readonly AgentLifecycleGuideCommand[];
  readonly install: readonly InstallChannel[];
  /** npm package used for latest-version probe when install uses npm. */
  readonly npmPackageForLatest?: string;
  readonly support: AgentLifecycleSupport;
  /**
   * Reversible uninstall channels. Omit → derive from install[]; explicit [] →
   * declare no managed uninstall.
   */
  readonly uninstall?: readonly UninstallChannel[];
  readonly update: readonly UpdateChannel[];
  /** Args passed to the binary to read version (default: ["--version"]). */
  readonly versionArgs?: readonly string[];
}

export type AgentLifecycleSpecMap = {
  readonly [K in AgentKind]: AgentLifecycleSpec;
};

/** Derive update UX mode from channels + latest probe capability. */
export function resolveUpdateMode(
  spec: AgentLifecycleSpec
): AgentLifecycleUpdateMode {
  if (spec.support !== "full") {
    return "none";
  }
  if (spec.update.length === 0) {
    return "none";
  }
  const hasNpmLatest =
    Boolean(spec.npmPackageForLatest) ||
    spec.install.some((c) => c.kind === "npm") ||
    spec.update.some((c) => c.kind === "npm-latest");
  const hasBrewLatest =
    spec.install.some((c) => c.kind === "brew") ||
    spec.update.some((c) => c.kind === "brew-upgrade");
  if (hasNpmLatest || hasBrewLatest) {
    return "versioned";
  }
  // self / reinstall / pipx / uv without remote latest probe
  return "reinstall";
}
