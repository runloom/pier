export type ProcessEnvironmentSource = "agent" | "plugin" | "task" | "terminal";

export type Environment = Record<string, string>;
export type RawEnvironment =
  | NodeJS.ProcessEnv
  | Record<string, string | undefined>;

export type ShellEnvDumpMode = "login-interactive" | "non-login-fallback";

export type HostAppliedStatus = "applied" | "not-applied" | "stale-after-fail";

export interface ProcessEnvironmentResolveRequest {
  agentEnv?: Record<string, string> | undefined;
  clientEnv?: Record<string, string> | undefined;
  cwd?: string | undefined;
  explicitEnv?: Record<string, string> | undefined;
  profileEnv?: Record<string, string> | undefined;
  /** Settings → Environment project KV; overrides agentEnv, below explicitEnv. */
  projectEnv?: Record<string, string> | undefined;
  source: ProcessEnvironmentSource;
}

export interface ProcessEnvironmentDiagnostics {
  cacheHit: boolean;
  cwd?: string | undefined;
  dumpMode?: ShellEnvDumpMode | undefined;
  error?: string | undefined;
  hostAppliedStatus?: HostAppliedStatus | undefined;
  pathChanged: boolean;
  shell?: string | undefined;
  shellEnvStatus: "cached" | "failed" | "resolved" | "skipped";
  source: ProcessEnvironmentSource;
}

export interface ProcessEnvironmentResolveResult {
  diagnostics: ProcessEnvironmentDiagnostics;
  /** Fully merged spawn env (base + shell + client/agent/profile/project/explicit). */
  env: Environment;
  /**
   * Pure login-shell dump layer only (no agent/project/explicit merge).
   * Host process.env whitelist apply must use this, never `env`.
   */
  shellEnv: Environment;
}

export interface ShellEnvironmentLoadRequest {
  cwd?: string | undefined;
  shell: string;
  source: ProcessEnvironmentSource;
}

export interface ShellEnvironmentLoadResult {
  dumpMode?: ShellEnvDumpMode | undefined;
  env: Environment;
  status: "resolved" | "skipped";
}

export type ShellEnvironmentLoader = (
  request: ShellEnvironmentLoadRequest
) => Promise<ShellEnvironmentLoadResult>;

export interface CreateProcessEnvironmentServiceOptions {
  baseEnv?: RawEnvironment;
  getTimeoutMs?: () => number;
  /** Read on each resolve; true → shell dump skipped. */
  isDisabled?: () => boolean;
  loadShellEnv?: ShellEnvironmentLoader;
  /**
   * Failure notify **only** entry (real dump failed; negative-cache hits do not
   * re-fire). App-core wires this to NCS delivery in PR2.
   */
  onShellEnvFailed?: (diagnostics: ProcessEnvironmentDiagnostics) => void;
  platform?: NodeJS.Platform;
  shell?: string | undefined;
  /** Test convenience default; prefer getTimeoutMs when prefs live. */
  timeoutMs?: number;
}

export interface ProcessEnvironmentService {
  getHostDiagnostics(): ProcessEnvironmentDiagnostics | undefined;
  /**
   * Clear success + negative caches. When `reapplyHost`, re-resolve home cwd
   * and apply whitelist keys to `process.env` (serial with other apply ops).
   */
  invalidate(opts?: {
    reapplyHost?: boolean;
  }): Promise<ProcessEnvironmentDiagnostics | undefined>;
  recordHostDiagnostics(diagnostics: ProcessEnvironmentDiagnostics): void;
  resolve(
    request: ProcessEnvironmentResolveRequest
  ): Promise<ProcessEnvironmentResolveResult>;
}
