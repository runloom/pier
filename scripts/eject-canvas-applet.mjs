#!/usr/bin/env node
/**
 * Shallow-eject a plugin applet into the current project's canvases folder.
 * Usage: node scripts/eject-canvas-applet.mjs pier.tasks tracker-board [projectRoot]
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const [, , pluginId, appletId, projectRoot = process.cwd()] = process.argv;
if (!(pluginId && appletId)) {
  throw new Error(
    "usage: node scripts/eject-canvas-applet.mjs <pluginId> <appletId> [projectRoot]"
  );
}

const packagesRoot = join(repoRoot, "packages");
const pluginDir = `${packagesRoot}/plugin-${pluginId.replace(/^pier\./, "")}`;
const manifestPath = join(pluginDir, "plugin.json");
if (!existsSync(manifestPath)) {
  throw new Error(`plugin package not found for ${pluginId}`);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const contribution = (manifest.applets ?? []).find(
  (item) => item.id === `${pluginId}.${appletId}` || item.id === appletId
);
if (!contribution) {
  throw new Error(`applet ${appletId} is not declared by ${pluginId}`);
}
const sourceDir = join(pluginDir, dirname(contribution.entry));
const targetDir = join(
  projectRoot,
  ".pier/canvases/_applets",
  pluginId,
  appletId
);
mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });
const appletsRoot = dirname(sourceDir);
const sharedCopy = join(appletsRoot, "copy");
if (existsSync(sharedCopy) && basename(appletsRoot) === "applets") {
  cpSync(sharedCopy, join(dirname(targetDir), "copy"), { recursive: true });
}
const header = `/**\n * Ejected from ${pluginId}/${appletId} (${contribution.entry}).\n * ViewModel: keep props compatible with the plugin applet contract.\n */\n`;
const entryName = contribution.entry.split("/").at(-1);
const entryPath = join(targetDir, entryName);
if (existsSync(entryPath)) {
  const body = readFileSync(entryPath, "utf8");
  if (!body.startsWith("/**\n * Ejected")) {
    writeFileSync(entryPath, `${header}${body}`);
  }
}
console.log(targetDir);
