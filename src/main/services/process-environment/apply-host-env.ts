import type {
  Environment,
  ProcessEnvironmentDiagnostics,
  ProcessEnvironmentResolveResult,
} from "./types.ts";

export type ApplyHostMode = "replace-whitelist";

/** Never copy these from shell dump into Electron main process.env. */
const NEVER_APPLY_EXACT = new Set([
  "DYLD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_FRAMEWORK_PATH",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
  "OPENSSL_CONF",
]);

const NEVER_APPLY_PREFIXES = ["ELECTRON_"] as const;

const EXACT_APPLY_KEYS = new Set([
  "PATH",
  "MANPATH",
  "NVM_DIR",
  "NVM_BIN",
  "NVM_CD_FLAGS",
  "NVM_INC",
  "FNM_DIR",
  "FNM_MULTISHELL_PATH",
  "FNM_NODE_VERSION",
  "FNM_ARCH",
  "ASDF_DIR",
  "ASDF_DATA_DIR",
  "ASDF_DEFAULT_TOOL_VERSIONS_FILENAME",
  "MISE_DATA_DIR",
  "MISE_SHELL",
  "MISE_CONFIG_DIR",
  "VOLTA_HOME",
  "BUN_INSTALL",
  "PNPM_HOME",
  "GOPATH",
  "GOROOT",
  "GOBIN",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "JAVA_HOME",
  "ANDROID_HOME",
  "ANDROID_SDK_ROOT",
  "PYENV_ROOT",
  "RBENV_ROOT",
  "SDKMAN_DIR",
  "CONDA_PREFIX",
  "CONDA_DEFAULT_ENV",
  "VIRTUAL_ENV",
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "CODEX_HOME",
  "GROK_HOME",
  "CLAUDE_CONFIG_DIR",
]);

const APPLY_PREFIX_RE = /^(NVM|FNM|ASDF|MISE|VOLTA|PYENV|RBENV|SDKMAN|CONDA)_/;

export function shouldApplyHostEnvKey(key: string): boolean {
  if (NEVER_APPLY_EXACT.has(key)) {
    return false;
  }
  for (const prefix of NEVER_APPLY_PREFIXES) {
    if (key.startsWith(prefix)) {
      return false;
    }
  }
  if (EXACT_APPLY_KEYS.has(key)) {
    return true;
  }
  return APPLY_PREFIX_RE.test(key);
}

const LAUNCH_WRAP_EXTRA_FORBIDDEN = new Set(["TERM", "TERM_PROGRAM"]);

/** Env keys wrap / decorateSpawn must not contribute. */
export function isForbiddenLaunchWrapEnvKey(key: string): boolean {
  if (NEVER_APPLY_EXACT.has(key) || LAUNCH_WRAP_EXTRA_FORBIDDEN.has(key)) {
    return true;
  }
  return key.startsWith("DYLD_");
}

export interface ApplyHostProcessEnvOptions {
  /** Tracked keys from previous apply; used to delete stale host values. */
  lastAppliedKeys?: Set<string>;
  mode?: ApplyHostMode;
  targetEnv?: NodeJS.ProcessEnv;
}

export interface ApplyHostProcessEnvResult {
  appliedKeys: string[];
  diagnosticsPatch: Pick<ProcessEnvironmentDiagnostics, "hostAppliedStatus">;
  lastAppliedKeys: Set<string>;
}

/**
 * Whitelist-replace host `process.env` for which/probe convenience.
 * Not the source of truth for per-cwd child spawns (those use full resolve().env).
 *
 * Callers MUST pass the pure shell layer (`result.shellEnv`), never the merged
 * spawn `env` — otherwise agent/project/explicit keys could leak into Electron.
 */
export function applyHostProcessEnv(
  result: Pick<ProcessEnvironmentResolveResult, "diagnostics" | "shellEnv">,
  options: ApplyHostProcessEnvOptions = {}
): ApplyHostProcessEnvResult {
  const status = result.diagnostics.shellEnvStatus;
  if (status !== "resolved" && status !== "cached") {
    return {
      appliedKeys: [],
      diagnosticsPatch: { hostAppliedStatus: "not-applied" },
      lastAppliedKeys: options.lastAppliedKeys ?? new Set(),
    };
  }

  const target = options.targetEnv ?? process.env;
  const previous = options.lastAppliedKeys ?? new Set<string>();
  const nextApplied = new Set<string>();
  const appliedKeys: string[] = [];
  const shellEnv = result.shellEnv;

  for (const key of previous) {
    if (!(key in shellEnv && shouldApplyHostEnvKey(key))) {
      Reflect.deleteProperty(target, key);
    }
  }

  for (const [key, value] of Object.entries(shellEnv)) {
    if (!shouldApplyHostEnvKey(key)) {
      continue;
    }
    target[key] = value;
    nextApplied.add(key);
    appliedKeys.push(key);
  }

  return {
    appliedKeys,
    diagnosticsPatch: { hostAppliedStatus: "applied" },
    lastAppliedKeys: nextApplied,
  };
}

/** Subset of env keys eligible for host apply (test helper / diagnostics). */
export function pickHostApplyEnv(env: Environment): Environment {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => shouldApplyHostEnvKey(key))
  );
}
