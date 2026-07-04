import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const BUILD_LIBGHOSTTY_SCRIPT = join(
  process.cwd(),
  "scripts/build-libghostty.sh"
);

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeExecutable(
  dir: string,
  name: string,
  content: string
): Promise<void> {
  const path = join(dir, name);
  await writeFile(path, content);
  chmodSync(path, 0o755);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("build-libghostty preflight", () => {
  it("fails before cloning when the Xcode Metal Toolchain is missing", async () => {
    const fakeBin = await makeTempDir("pier-build-libghostty-bin-");
    await writeExecutable(
      fakeBin,
      "zig",
      [
        "#!/usr/bin/env bash",
        'if [ "$1" = "version" ]; then',
        '  echo "0.15.2"',
        "  exit 0",
        "fi",
        'echo "zig build should not run: $*" >&2',
        "exit 19",
        "",
      ].join("\n")
    );
    await writeExecutable(
      fakeBin,
      "git",
      [
        "#!/usr/bin/env bash",
        'echo "git should not run before Metal Toolchain preflight: $*" >&2',
        "exit 18",
        "",
      ].join("\n")
    );
    await writeExecutable(
      fakeBin,
      "xcrun",
      [
        "#!/usr/bin/env bash",
        "echo \"error: cannot execute tool 'metal' due to missing Metal Toolchain; use: xcodebuild -downloadComponent MetalToolchain\" >&2",
        "exit 1",
        "",
      ].join("\n")
    );
    for (const command of ["xcodebuild", "lipo", "ar", "ranlib"]) {
      await writeExecutable(
        fakeBin,
        command,
        ["#!/usr/bin/env bash", "exit 0", ""].join("\n")
      );
    }

    const result = spawnSync("bash", [BUILD_LIBGHOSTTY_SCRIPT], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
        ZIG: join(fakeBin, "zig"),
      },
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("Xcode Metal Toolchain");
    expect(output).toContain("xcodebuild -downloadComponent MetalToolchain");
    expect(output).not.toContain("git should not run");
    expect(output).not.toContain("zig build should not run");
  });
});
