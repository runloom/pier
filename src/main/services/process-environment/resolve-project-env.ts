/**
 * Shared project KV lookup for spawn env layering (shell-env parity K7/K23).
 * Algorithm: resolveForWorktree(cwd) → resolveProject(projectRootPath) → undefined.
 * No parent-path prefix scan in v1.
 */
import type { LocalEnvironmentService } from "../local-environments-service.ts";

export interface ResolveProjectEnvForSpawnInput {
  cwd?: string | undefined;
  localEnvironments: Pick<
    LocalEnvironmentService,
    "resolveForWorktree" | "resolveProject"
  >;
  projectRootPath?: string | undefined;
}

/**
 * Returns project.env when a local-environment project can be resolved for the
 * spawn cwd / project root. Empty env objects are treated as undefined.
 */
export async function resolveProjectEnvForSpawn(
  input: ResolveProjectEnvForSpawnInput
): Promise<Record<string, string> | undefined> {
  const { cwd, localEnvironments, projectRootPath } = input;

  const cwdTrimmed = cwd?.trim();
  if (cwdTrimmed) {
    try {
      const binding = await localEnvironments.resolveForWorktree(cwdTrimmed);
      const env = binding?.project.env;
      if (env && Object.keys(env).length > 0) {
        return env;
      }
    } catch {
      // Binding lookup failures must not block spawn; fall through.
    }
  }

  const rootTrimmed = projectRootPath?.trim();
  if (rootTrimmed) {
    try {
      const project = await localEnvironments.resolveProject(rootTrimmed);
      const env = project?.env;
      if (env && Object.keys(env).length > 0) {
        return env;
      }
    } catch {
      // Project lookup failures must not block spawn.
    }
  }

  return;
}
