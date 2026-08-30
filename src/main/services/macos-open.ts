import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type MacOpenExecFile = (
  file: string,
  args: string[]
) => Promise<unknown>;

/** LaunchServices `open(1)` 候选链；任一成功即停。 */
export async function openMacWithOpenCommand(
  candidates: readonly (readonly string[])[],
  options?: {
    execFileImpl?: MacOpenExecFile;
    onCandidateFailed?: (args: readonly string[], err: unknown) => void;
  }
): Promise<boolean> {
  const run = options?.execFileImpl ?? execFileAsync;
  for (const args of candidates) {
    try {
      await run("open", [...args]);
      return true;
    } catch (err) {
      options?.onCandidateFailed?.(args, err);
    }
  }
  return false;
}
