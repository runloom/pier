import type { ProcessEnvironmentService } from "../process-environment/types.ts";

/**
 * PATH used to decide whether a synthesized task can run.
 * A resolved project shell dump matches the login shell that executes the task.
 * A skipped or failed dump falls back to the host process PATH.
 */
export async function resolveTaskListPathEnv(
  processEnvironment: Pick<ProcessEnvironmentService, "resolve"> | undefined,
  projectRootPath: string
): Promise<string | undefined> {
  if (!processEnvironment) {
    return;
  }
  const resolved = await processEnvironment.resolve({
    cwd: projectRootPath,
    projectRootPath,
    source: "task",
  });
  const status = resolved.diagnostics.shellEnvStatus;
  const pathEnv = resolved.env.PATH;
  if ((status === "resolved" || status === "cached") && pathEnv) {
    return pathEnv;
  }
  return;
}
