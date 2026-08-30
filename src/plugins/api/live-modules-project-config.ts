import {
  LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES,
  LIVE_MODULES_PROJECT_CONFIG_PATH,
  type LiveModulesProjectConfig,
  liveModulesProjectConfigSchema,
} from "@shared/contracts/live-modules.ts";
import {
  normalizeContentDirectoryList,
  normalizeProjectRootKey,
  parseLiveModulesProjectConfig,
  setRuntimeLiveModuleContentDirectories,
} from "@shared/live-module-canvas-path.ts";

export { resolveLiveModuleContentDirectories } from "@shared/live-module-canvas-path.ts";

export type LiveModulesConfigLoadResult =
  | {
      kind: "ok";
      /** Full list shown in settings (factory defaults if never saved). */
      contentDirectories: string[];
      /** Disk root for `.pier/live-modules.json` (git primary checkout). */
      configRootPath: string;
      revision: string | null;
      config: LiveModulesProjectConfig;
      /** True when on-disk JSON failed schema; UI may offer overwrite-save. */
      recoveredFromInvalid?: boolean;
    }
  | { kind: "failed"; message: string };

/** Workspace roots that share one on-disk live-modules config (main + worktrees). */
const consumersByConfigRoot = new Map<string, Set<string>>();

export function rememberLiveModuleConfigConsumer(
  projectRootPath: string,
  configRootPath: string
): void {
  const configKey = normalizeProjectRootKey(configRootPath);
  let consumers = consumersByConfigRoot.get(configKey);
  if (!consumers) {
    consumers = new Set();
    consumersByConfigRoot.set(configKey, consumers);
  }
  consumers.add(configRootPath);
  consumers.add(projectRootPath);
}

export function liveModuleConfigFanoutRoots(projectRootPath: string): string[] {
  const key = normalizeProjectRootKey(projectRootPath);
  const direct = consumersByConfigRoot.get(key);
  if (direct && direct.size > 0) {
    return [...direct];
  }
  for (const consumers of consumersByConfigRoot.values()) {
    for (const path of consumers) {
      if (normalizeProjectRootKey(path) === key) {
        return [...consumers];
      }
    }
  }
  return [projectRootPath];
}

export function resetLiveModuleConfigConsumersForTests(): void {
  consumersByConfigRoot.clear();
}

/**
 * Linked git worktrees share the primary checkout's `.pier/live-modules.json`.
 */
export async function resolveLiveModulesConfigRoot(
  projectRootPath: string
): Promise<string> {
  const check = window.pier.worktrees?.check;
  if (!check) {
    return projectRootPath;
  }
  try {
    const result = await check({ path: projectRootPath });
    if (result.status === "supported") {
      return result.mainPath;
    }
  } catch {
    return projectRootPath;
  }
  return projectRootPath;
}

export interface LoadLiveModulesProjectConfigOptions {
  /**
   * When true (default), write the effective list into the per-project runtime
   * map. Ensure/apply paths set this false so ownership of runtime applies is
   * decided by generation-aware callers.
   */
  applyRuntime?: boolean;
}

/**
 * Load project Live Modules config.
 * Invalid on-disk JSON recovers to factory defaults so Settings can repair.
 */
export async function loadLiveModulesProjectConfig(
  projectRootPath: string,
  options?: LoadLiveModulesProjectConfigOptions
): Promise<LiveModulesConfigLoadResult> {
  const applyRuntime = options?.applyRuntime !== false;
  const configRootPath = await resolveLiveModulesConfigRoot(projectRootPath);
  rememberLiveModuleConfigConsumer(projectRootPath, configRootPath);
  const apply = (directories: readonly string[] | null) => {
    if (!applyRuntime) {
      return;
    }
    setRuntimeLiveModuleContentDirectories(projectRootPath, directories);
    if (configRootPath !== projectRootPath) {
      setRuntimeLiveModuleContentDirectories(configRootPath, directories);
    }
  };

  try {
    const exists = await window.pier.files.exists({
      path: LIVE_MODULES_PROJECT_CONFIG_PATH,
      root: configRootPath,
    });
    if (!exists) {
      const contentDirectories = [
        ...LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES,
      ];
      apply(null);
      return {
        kind: "ok",
        contentDirectories,
        configRootPath,
        revision: null,
        config: liveModulesProjectConfigSchema.parse({ version: 1 }),
      };
    }
    const result = await window.pier.files.readDocument({
      path: LIVE_MODULES_PROJECT_CONFIG_PATH,
      root: configRootPath,
    });
    if (result.kind !== "text") {
      return {
        kind: "failed",
        message: "live-modules config is not a text file",
      };
    }
    const parsed = parseLiveModulesProjectConfig(result.contents);
    let rawConfig: unknown = {};
    try {
      rawConfig = JSON.parse(result.contents) as unknown;
    } catch {
      rawConfig = {};
    }
    const configResult = liveModulesProjectConfigSchema.safeParse(rawConfig);
    const recoveredFromInvalid = !configResult.success;
    const config = configResult.success
      ? configResult.data
      : liveModulesProjectConfigSchema.parse({ version: 1 });

    apply(parsed.contentDirectories);
    return {
      kind: "ok",
      contentDirectories: parsed.contentDirectories,
      configRootPath,
      revision: result.revision,
      config,
      ...(recoveredFromInvalid ? { recoveredFromInvalid: true } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|ENOENT|missing/i.test(message)) {
      apply(null);
      return {
        kind: "ok",
        contentDirectories: [
          ...LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES,
        ],
        configRootPath,
        revision: null,
        config: liveModulesProjectConfigSchema.parse({ version: 1 }),
      };
    }
    return { kind: "failed", message };
  }
}

export type LiveModulesConfigSaveResult =
  | {
      kind: "written";
      revision: string;
      contentDirectories: string[];
      configRootPath: string;
    }
  | { kind: "conflict"; message: string }
  | { kind: "failed"; message: string };

/**
 * Persist the full content-directory list and refresh runtime allowlist.
 * Empty list is rejected (at least one root required).
 */
export async function saveLiveModulesProjectConfig(input: {
  projectRootPath: string;
  contentDirectories: readonly string[];
  expectedRevision: string | null;
}): Promise<LiveModulesConfigSaveResult> {
  const contentDirectories = normalizeContentDirectoryList(
    input.contentDirectories
  );
  if (contentDirectories.length === 0) {
    return {
      kind: "failed",
      message: "At least one content directory is required.",
    };
  }

  const config = liveModulesProjectConfigSchema.parse({
    version: 1,
    contentDirectories,
  });
  const contents = `${JSON.stringify(config, null, 2)}\n`;
  const configRootPath = await resolveLiveModulesConfigRoot(
    input.projectRootPath
  );
  rememberLiveModuleConfigConsumer(input.projectRootPath, configRootPath);

  try {
    const result = await window.pier.files.writeDocument({
      contents,
      eol: "lf",
      expected:
        input.expectedRevision === null
          ? { kind: "absent" }
          : { kind: "revision", revision: input.expectedRevision },
      format: { bom: false, encoding: "utf8" },
      path: LIVE_MODULES_PROJECT_CONFIG_PATH,
      root: configRootPath,
    });
    if (result.kind === "written") {
      setRuntimeLiveModuleContentDirectories(
        input.projectRootPath,
        contentDirectories
      );
      if (configRootPath !== input.projectRootPath) {
        setRuntimeLiveModuleContentDirectories(
          configRootPath,
          contentDirectories
        );
      }
      return {
        kind: "written",
        revision: result.revision,
        contentDirectories,
        configRootPath,
      };
    }
    if (result.kind === "conflict") {
      return {
        kind: "conflict",
        message: "Config changed on disk — reload and try again.",
      };
    }
    return { kind: "failed", message: result.message };
  } catch (error) {
    return {
      kind: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
