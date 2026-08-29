import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

describe("packaged pier CLI", () => {
  it("packs the CLI kit and Electron wrapper in extraResources", async () => {
    const yml = await readFile(join(ROOT, "electron-builder.yml"), "utf8");
    expect(yml).toMatch(/from:\s*bin\/pier\.mjs/);
    expect(yml).toMatch(/to:\s*bin\/pier\.mjs/);
    expect(yml).toMatch(/from:\s*bin\/pier-cli-parser\.js/);
    expect(yml).toMatch(/from:\s*bin\/pier-cli-path\.js/);
    expect(yml).toMatch(/from:\s*bin\/pier-cli-launch\.js/);
    expect(yml).toMatch(/from:\s*bin\/pier-control-client\.js/);
    expect(yml).toMatch(/from:\s*bin\/pier-app\.sh/);
    expect(yml).toMatch(/to:\s*bin\/pier\b/);
    expect(yml).not.toMatch(
      /from:\s*bin\/pier\.mjs\s*\n\s*to:\s*bin\/pier\s*$/m
    );
  });

  it("wrapper uses Electron as Node and resolves PATH symlinks", async () => {
    const source = await readFile(join(ROOT, "bin/pier-app.sh"), "utf8");
    expect(source).toContain("ELECTRON_RUN_AS_NODE=1");
    expect(source).toContain("pier.mjs");
    expect(source).toContain("while [ -L");
    expect(source).toContain("MacOS/Pier");
    expect(source).not.toMatch(/^#!\/usr\/bin\/env node/m);
  });

  it("runs through a PATH symlink using the app Electron binary", async () => {
    const root = join(tmpdir(), `pier-cli-wrapper-${Date.now()}`);
    const contents = join(root, "Contents");
    const binDir = join(contents, "Resources", "bin");
    const macDir = join(contents, "MacOS");
    const pathDir = join(root, "path-bin");
    await mkdir(binDir, { recursive: true });
    await mkdir(macDir, { recursive: true });
    await mkdir(pathDir, { recursive: true });

    const wrapper = await readFile(join(ROOT, "bin/pier-app.sh"), "utf8");
    const wrapperPath = join(binDir, "pier");
    await writeFile(wrapperPath, wrapper, { mode: 0o755 });
    await writeFile(join(binDir, "pier.mjs"), "export {}\n", { mode: 0o644 });

    const electronPath = join(macDir, "Pier");
    await writeFile(
      electronPath,
      `#!/usr/bin/env node
const cli = process.argv.find((arg) => arg.endsWith("pier.mjs"));
const cliIndex = cli ? process.argv.indexOf(cli) : -1;
process.stdout.write(
  JSON.stringify({
    electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,
    cli: cli ?? null,
    rest: cliIndex >= 0 ? process.argv.slice(cliIndex + 1) : [],
  })
);
`,
      { mode: 0o755 }
    );
    await chmod(electronPath, 0o755);
    await chmod(wrapperPath, 0o755);

    const pathBin = join(pathDir, "pier");
    await symlink(wrapperPath, pathBin);

    const { stdout } = await execFileAsync(
      pathBin,
      ["agents", "start", "claude"],
      {
        encoding: "utf8",
      }
    );
    const payload = JSON.parse(stdout) as {
      cli: string;
      electronRunAsNode: string | null;
      rest: string[];
    };
    expect(payload.electronRunAsNode).toBe("1");
    expect(payload.cli).toBe(join(binDir, "pier.mjs"));
    expect(payload.rest).toEqual(["agents", "start", "claude"]);
  });
});
