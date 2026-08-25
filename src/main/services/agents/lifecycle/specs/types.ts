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

/** Remote latest for channels without npm/brew/PyPI (official script). */
export type AgentLatestProbe =
  | { kind: "cursor-install-script"; url: string }
  | { kind: "http-text"; url: string };

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
  /**
   * Remote latest for path/script installs. Brew/npm still use their own
   * indexes when that is the detected source.
   */
  readonly latestProbe?: AgentLatestProbe;
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

function hasIndexedLatest(spec: AgentLifecycleSpec): boolean {
  const hasNpmLatest =
    Boolean(spec.npmPackageForLatest) ||
    spec.install.some((c) => c.kind === "npm") ||
    spec.update.some((c) => c.kind === "npm-latest");
  const hasBrewLatest =
    spec.install.some((c) => c.kind === "brew") ||
    spec.update.some((c) => c.kind === "brew-upgrade");
  const hasPypiLatest =
    spec.install.some((c) => c.kind === "uv" || c.kind === "pipx") ||
    spec.update.some(
      (c) => c.kind === "uv-upgrade" || c.kind === "pipx-upgrade"
    );
  return hasNpmLatest || hasBrewLatest || hasPypiLatest;
}

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
  if (hasIndexedLatest(spec) || spec.latestProbe) {
    return "versioned";
  }
  // self / reinstall without a remote latest probe
  return "reinstall";
}

/** Script-only reinstall: versioned solely by latestProbe, or still reinstall. */
export function specCanForceReinstall(spec: AgentLifecycleSpec): boolean {
  if (spec.support !== "full" || spec.update.length === 0) {
    return false;
  }
  if (!spec.update.some((channel) => channel.kind === "reinstall")) {
    return false;
  }
  return !hasIndexedLatest(spec);
}
