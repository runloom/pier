import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PE_MACHINE_BY_ARCH = Object.freeze({
  arm64: 0xaa_64,
  x64: 0x86_64,
});

export function readPortableExecutableMachine(filePath) {
  const bytes = readFileSync(filePath);
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") {
    throw new Error(`${filePath} is not a Portable Executable`);
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (
    peOffset + 6 > bytes.length ||
    bytes.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0"
  ) {
    throw new Error(`${filePath} has an invalid PE header`);
  }
  return bytes.readUInt16LE(peOffset + 4);
}

export function verifyPackagedWindowsJobAddons(resourcesRoot, architectures) {
  for (const architecture of architectures) {
    const expectedMachine = PE_MACHINE_BY_ARCH[architecture];
    if (expectedMachine === undefined) {
      throw new Error(`Unsupported Windows architecture: ${architecture}`);
    }
    const addonPath = join(
      resourcesRoot,
      "lsp-windows-job",
      architecture,
      "lsp_windows_job.node"
    );
    const actualMachine = readPortableExecutableMachine(addonPath);
    if (actualMachine !== expectedMachine) {
      throw new Error(
        `${addonPath} has PE machine 0x${actualMachine.toString(16)}; expected ${architecture} 0x${expectedMachine.toString(16)}`
      );
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [resourcesRoot, ...architectures] = process.argv.slice(2);
  if (!(resourcesRoot && architectures.length > 0)) {
    throw new Error(
      "Usage: node scripts/verify-lsp-windows-job-package.mjs <resources-root> <x64|arm64> [...]"
    );
  }
  verifyPackagedWindowsJobAddons(resourcesRoot, architectures);
}
