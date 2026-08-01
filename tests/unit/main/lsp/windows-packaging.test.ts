import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { verifyPackagedWindowsJobAddons } from "../../../../scripts/verify-lsp-windows-job-package.mjs";

const roots: string[] = [];

function writePeAddon(root: string, architecture: "x64" | "arm64"): void {
  const machine = architecture === "x64" ? 0x86_64 : 0xaa_64;
  const bytes = Buffer.alloc(0x88);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write("PE\0\0", 0x80, "ascii");
  bytes.writeUInt16LE(machine, 0x84);
  const directory = join(root, "lsp-windows-job", architecture);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "lsp_windows_job.node"), bytes);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("Windows LSP native artifact packaging", () => {
  it("accepts architecture-matched x64 and arm64 packaged resources", () => {
    const root = mkdtempSync(join(tmpdir(), "pier-lsp-package-"));
    roots.push(root);
    writePeAddon(root, "x64");
    writePeAddon(root, "arm64");

    expect(() =>
      verifyPackagedWindowsJobAddons(root, ["x64", "arm64"])
    ).not.toThrow();
  });

  it("rejects a host-built x64 addon copied into the arm64 resource path", () => {
    const root = mkdtempSync(join(tmpdir(), "pier-lsp-package-swap-"));
    roots.push(root);
    writePeAddon(root, "x64");
    const x64Addon = readFileSync(
      join(root, "lsp-windows-job", "x64", "lsp_windows_job.node")
    );
    const arm64Directory = join(root, "lsp-windows-job", "arm64");
    mkdirSync(arm64Directory, { recursive: true });
    writeFileSync(join(arm64Directory, "lsp_windows_job.node"), x64Addon);

    expect(() =>
      verifyPackagedWindowsJobAddons(root, ["x64", "arm64"])
    ).toThrow(/expected arm64/);
  });

  it("builds and packages each target from its architecture-specific output and runs the smoke for both targets", () => {
    const buildScript = readFileSync(
      join(process.cwd(), "scripts/build-lsp-windows-job.mjs"),
      "utf8"
    );
    const builderConfig = readFileSync(
      join(process.cwd(), "electron-builder.yml"),
      "utf8"
    );
    const workflow = readFileSync(
      join(process.cwd(), ".github/workflows/ci.yml"),
      "utf8"
    );

    expect(buildScript).toMatch(/\b(?:x64|arm64)\b[\s\S]*\b(?:x64|arm64)\b/);
    expect(buildScript).toMatch(/--arch/);
    expect(builderConfig).toMatch(
      /from:\s*native\/lsp-windows-job\/[^{\n]*\$\{arch\}[^\n]*\/lsp_windows_job\.node/
    );
    // TypeScript language server is launched via ELECTRON_RUN_AS_NODE + cli.mjs.
    expect(builderConfig).toMatch(/node_modules\/typescript-language-server/);
    expect(builderConfig).toMatch(/node_modules\/typescript\/\*\*/);
    expect(workflow).toContain("verify-lsp-windows-job-package.mjs");
    expect(workflow).toMatch(
      /verify-lsp-windows-job-package\.mjs[^\n]*(?:x64[^\n]*arm64|arm64[^\n]*x64)/
    );
  });
});
