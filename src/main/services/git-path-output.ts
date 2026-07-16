/**
 * `git rev-parse` 的单路径输出以一个 LF 结束。路径本身可以包含空白、CR 或 LF，
 * 因此只能移除协议追加的最后一个 LF，不能使用 trim 或按行拆分。
 */
export function parseGitSinglePathOutput(output: string): string | null {
  if (!output.endsWith("\n")) {
    return null;
  }
  const path = output.slice(0, -1);
  return path.length > 0 ? path : null;
}
