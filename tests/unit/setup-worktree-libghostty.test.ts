import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SETUP_WORKTREE_SCRIPT = join(process.cwd(), "scripts/setup-worktree.mjs");
const XCF_RELATIVE_PATH = join(
  "native",
  "Vendor",
  "libghostty-spm",
  "GhosttyKit.xcframework"
);

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`
    );
  }
  return result.stdout.trim();
}

async function writeMainLibghostty(repo: string): Promise<void> {
  const xcf = join(repo, XCF_RELATIVE_PATH);
  await mkdir(join(xcf, "macos-arm64_x86_64", "Headers"), {
    recursive: true,
  });
  await writeFile(join(xcf, "Info.plist"), "main xcframework\n");
  await writeFile(
    join(xcf, "macos-arm64_x86_64", "Headers", "ghostty.h"),
    "/* header */\n"
  );
  await writeFile(
    join(xcf, "macos-arm64_x86_64", "Headers", "module.modulemap"),
    "module libghostty {}\n"
  );
  await writeFile(
    join(xcf, "macos-arm64_x86_64", "libghostty-universal.a"),
    "main universal archive\n"
  );
}

async function initRepoWithMainLibghostty(): Promise<string> {
  const repo = await makeTempDir("pier-setup-worktree-repo-");
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "pier@example.com"]);
  git(repo, ["config", "user.name", "Pier Test"]);

  await writeFile(
    join(repo, ".gitignore"),
    [
      "node_modules/",
      "native/build/",
      "/native/Vendor/libghostty-spm/GhosttyKit.xcframework/",
      "",
    ].join("\n")
  );
  await mkdir(join(repo, "native", "Vendor", "libghostty-spm", "Sources"), {
    recursive: true,
  });
  await writeFile(join(repo, "native", "Package.swift"), "// package\n");
  await writeFile(
    join(repo, "native", "Vendor", "libghostty-spm", "Package.swift"),
    "// vendor package\n"
  );
  await writeFile(join(repo, "native", "build.sh"), "#!/usr/bin/env bash\n");
  await writeFile(join(repo, "native", "binding.gyp"), "{}\n");
  await writeFile(join(repo, "README.md"), "pier\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "init"]);

  await mkdir(join(repo, "node_modules", "react"), { recursive: true });
  await writeMainLibghostty(repo);

  return repo;
}

async function addWorktreeWithNativeAddon(repo: string): Promise<string> {
  const worktree = join(repo, ".worktrees", "copy-libghostty");
  git(repo, ["worktree", "add", "-b", "copy-libghostty", worktree]);
  const releaseDir = join(worktree, "native", "build", "Release");
  await mkdir(releaseDir, { recursive: true });
  await writeFile(join(releaseDir, "ghostty_native.node"), "node addon\n");
  await writeFile(join(releaseDir, "libGhosttyBridge.dylib"), "bridge\n");
  return worktree;
}

async function writePnpmInstallBin(): Promise<string> {
  const binDir = await makeTempDir("pier-setup-worktree-bin-");
  const pnpmPath = join(binDir, "pnpm");
  await writeFile(
    pnpmPath,
    [
      "#!/usr/bin/env bash",
      'if [[ "$*" != "install --frozen-lockfile" ]]; then',
      '  echo "unexpected pnpm command: $*" >&2',
      "  exit 17",
      "fi",
      'mkdir -p "$PWD/node_modules/react"',
      'touch "$PWD/node_modules/.modules.yaml"',
      'echo "pnpm install --frozen-lockfile"',
      "",
    ].join("\n")
  );
  chmodSync(pnpmPath, 0o755);
  return binDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("setup-worktree libghostty reuse", () => {
  it("迁移主仓 node_modules 软链并复用 GhosttyKit.xcframework", async () => {
    const repo = await initRepoWithMainLibghostty();
    const worktree = await addWorktreeWithNativeAddon(repo);
    const fakeBin = await writePnpmInstallBin();
    await symlink(join(repo, "node_modules"), join(worktree, "node_modules"));

    const result = spawnSync(process.execPath, [SETUP_WORKTREE_SCRIPT], {
      cwd: worktree,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("unexpected pnpm command");
    expect(result.stdout).toContain("pnpm install --frozen-lockfile");
    expect(result.stdout).toContain("从主仓复制 GhosttyKit.xcframework");
    expect((await lstat(join(worktree, "node_modules"))).isDirectory()).toBe(
      true
    );
    expect((await lstat(join(repo, "node_modules"))).isDirectory()).toBe(true);
    await access(join(worktree, XCF_RELATIVE_PATH, "Info.plist"));
    await expect(
      readFile(
        join(
          worktree,
          XCF_RELATIVE_PATH,
          "macos-arm64_x86_64",
          "libghostty-universal.a"
        ),
        "utf8"
      )
    ).resolves.toBe("main universal archive\n");
  });
});
