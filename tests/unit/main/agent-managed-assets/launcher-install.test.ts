import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { lstat, readFile, readlink, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installMemoryLauncher,
  MEMORY_LAUNCHER_GENERATION,
  memoryLauncherCurrentPath,
} from "@main/services/agent-managed-assets/launcher-install.ts";
import { afterEach, describe, expect, it } from "vitest";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

function scaffold(): { home: string; resourcesRoot: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "pier-launcher-inst-")));
  dirs.push(base);
  const resourcesRoot = join(base, "resources");
  mkdirSync(join(resourcesRoot, "memory-launcher"), { recursive: true });
  writeFileSync(
    join(resourcesRoot, "memory-launcher", "memory-mcp.mjs"),
    "#!/usr/bin/env node\nprocess.exit(0);\n"
  );
  return { home: join(base, "home"), resourcesRoot };
}

describe("memory launcher install", () => {
  it("installs through a generation dir with an atomic current symlink", async () => {
    const { home, resourcesRoot } = scaffold();
    const { currentPath } = await installMemoryLauncher({
      home,
      resourcesRoot,
    });
    expect(currentPath).toBe(memoryLauncherCurrentPath(home));
    expect(await readFile(currentPath, "utf8")).toContain("process.exit(0)");
    const link = join(home, ".pier", "memory", "launcher", "current");
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe(
      join(
        home,
        ".pier",
        "memory",
        "launcher",
        `v${MEMORY_LAUNCHER_GENERATION}`
      )
    );
    // 可执行位(智能体可能直接 exec):八进制串末三位含 owner-x。
    const mode = (await stat(currentPath)).mode.toString(8).slice(-3);
    expect(["755", "775", "777"]).toContain(mode);
    // 直接执行安装后的启动器应能跑通(内容为退出 0 的脚本)。
    execFileSync(process.execPath, [currentPath]);
  });

  it("never downgrades when the on-disk generation is newer (cross-build ~/.pier)", async () => {
    const { home, resourcesRoot } = scaffold();
    const root = join(home, ".pier", "memory", "launcher");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "GENERATION"), "99\n");
    await installMemoryLauncher({ home, resourcesRoot });
    // 更新一代的安装(未来版本 App)在场:本进程不得动 current / 世代目录。
    expect(existsSync(join(root, `v${MEMORY_LAUNCHER_GENERATION}`))).toBe(
      false
    );
    expect(await readFile(join(root, "GENERATION"), "utf8")).toBe("99\n");
  });

  it("replaces a stray real directory at the current link path", async () => {
    const { home, resourcesRoot } = scaffold();
    const link = join(home, ".pier", "memory", "launcher", "current");
    mkdirSync(link, { recursive: true });
    await installMemoryLauncher({ home, resourcesRoot });
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
  });

  it("is idempotent and rewrites only when the source content changes", async () => {
    const { home, resourcesRoot } = scaffold();
    await installMemoryLauncher({ home, resourcesRoot });
    const target = memoryLauncherCurrentPath(home);
    const before = await stat(target);
    await installMemoryLauncher({ home, resourcesRoot });
    expect((await stat(target)).mtimeMs).toBe(before.mtimeMs);
    writeFileSync(
      join(resourcesRoot, "memory-launcher", "memory-mcp.mjs"),
      "#!/usr/bin/env node\nprocess.exit(2);\n"
    );
    await installMemoryLauncher({ home, resourcesRoot });
    expect(await readFile(target, "utf8")).toContain("process.exit(2)");
  });
});
