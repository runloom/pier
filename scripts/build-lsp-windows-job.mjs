import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  process.stdout.write("Skipping Windows-only LSP Job Object addon build.\n");
  process.exit(0);
}

const require = createRequire(import.meta.url);
const nodeGyp = require.resolve("node-gyp/bin/node-gyp.js");
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const architectures = ["x64", "arm64"];
for (const architecture of architectures) {
  const result = spawnSync(
    process.execPath,
    [
      nodeGyp,
      "rebuild",
      "--directory",
      "native/lsp-windows-job",
      `--arch=${architecture}`,
    ],
    { cwd: repositoryRoot, stdio: "inherit" }
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const outputDirectory = resolve(
    repositoryRoot,
    "native/lsp-windows-job/artifacts",
    architecture,
    "Release"
  );
  mkdirSync(outputDirectory, { recursive: true });
  copyFileSync(
    resolve(
      repositoryRoot,
      "native/lsp-windows-job/build/Release/lsp_windows_job.node"
    ),
    resolve(outputDirectory, "lsp_windows_job.node")
  );
}
