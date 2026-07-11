import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const preloadPath = resolve(projectRoot, "out/preload/index.cjs");
const contents = readFileSync(preloadPath, "utf8");
const requirePattern = /\brequire\((["'])([^"']+)\1\)/g;
const allowedExternalModules = new Set(["electron"]);
const unsupportedModules = new Set();

for (const match of contents.matchAll(requirePattern)) {
  const moduleId = match[2];
  if (moduleId && !allowedExternalModules.has(moduleId)) {
    unsupportedModules.add(moduleId);
  }
}

if (unsupportedModules.size > 0) {
  throw new Error(
    `Sandboxed preload contains unsupported external modules: ${[
      ...unsupportedModules,
    ].join(", ")}`
  );
}

console.log("[preload-bundle] sandbox dependency boundary verified");
