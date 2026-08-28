import {
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";

/** 布局破坏性变化时递增(对齐 ~/.pier/hooks 世代模式);内容更新靠指纹比对。 */
export const MEMORY_LAUNCHER_GENERATION = 1;
const LAUNCHER_FILE = "memory-mcp.mjs";

export function memoryLauncherRoot(home: string = homedir()): string {
  return join(home, ".pier", "memory", "launcher");
}

/** 全局配置里引用的稳定路径(经 current 符号链接,升级不改配置)。 */
export function memoryLauncherCurrentPath(home: string = homedir()): string {
  return join(memoryLauncherRoot(home), "current", LAUNCHER_FILE);
}

/**
 * boot 幂等安装:内容与已装指纹一致则零写入;更新走 temp + rename 原子替换;
 * `current` 符号链接原子切换到世代目录。
 */
export async function installMemoryLauncher(args: {
  home?: string;
  resourcesRoot: string;
}): Promise<{ currentPath: string }> {
  const home = args.home ?? homedir();
  const root = memoryLauncherRoot(home);
  // 防回退(对齐 hooks 世代语义):~/.pier 跨 build 共享,磁盘世代更新时
  // 旧版本 App 不得降级 current 指向。
  const diskGeneration = Number.parseInt(
    (await readFile(join(root, "GENERATION"), "utf8").catch(() => "0")).trim(),
    10
  );
  if (
    Number.isFinite(diskGeneration) &&
    diskGeneration > MEMORY_LAUNCHER_GENERATION
  ) {
    return { currentPath: memoryLauncherCurrentPath(home) };
  }
  const source = await readFile(
    join(args.resourcesRoot, "memory-launcher", LAUNCHER_FILE),
    "utf8"
  );
  const genDir = join(root, `v${MEMORY_LAUNCHER_GENERATION}`);
  const target = join(genDir, LAUNCHER_FILE);
  const installed = await readFile(target, "utf8").catch(() => null);
  if (installed !== source) {
    await mkdir(genDir, { recursive: true });
    const temp = join(genDir, `.${LAUNCHER_FILE}.${process.pid}.tmp`);
    await writeFile(temp, source, { encoding: "utf8", mode: 0o755 });
    await rename(temp, target);
  }
  const currentLink = join(root, "current");
  const linkedTo = await readlink(currentLink).catch(() => null);
  if (linkedTo !== genDir) {
    // current 被外力换成真实目录时 rename 会 EISDIR:先清理再原子切换。
    const stray = await lstat(currentLink).catch(() => null);
    if (stray && !stray.isSymbolicLink()) {
      await rm(currentLink, { force: true, recursive: true });
    }
    const linkTemp = join(root, `.current-${process.pid}.tmp`);
    await rm(linkTemp, { force: true });
    await symlink(genDir, linkTemp);
    await rename(linkTemp, currentLink);
  }
  if (diskGeneration !== MEMORY_LAUNCHER_GENERATION) {
    await writeFileAtomic(
      join(root, "GENERATION"),
      `${MEMORY_LAUNCHER_GENERATION}\n`,
      { encoding: "utf8" }
    );
  }
  return { currentPath: memoryLauncherCurrentPath(home) };
}
