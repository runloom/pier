type RunGit = (args: readonly string[], cwd: string) => Promise<string>;

export async function listIgnoredPaths(
  runGit: RunGit,
  cwd: string
): Promise<string[]> {
  // --directory 把整个被忽略目录折叠为一条 `dir/`,避免枚举 node_modules 全量。
  const output = await runGit(
    [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "-z",
    ],
    cwd
  );
  return output.split("\0").filter((entry) => entry.length > 0);
}
