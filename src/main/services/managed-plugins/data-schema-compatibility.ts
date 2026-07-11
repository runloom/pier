import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ManagedPluginPackageManifest,
  managedPluginDataSchemaMarkerSchema,
} from "@shared/contracts/managed-plugin.ts";

function compare(actual: number, operator: string, expected: number): boolean {
  if (operator === ">=") return actual >= expected;
  if (operator === "<=") return actual <= expected;
  if (operator === ">") return actual > expected;
  if (operator === "<") return actual < expected;
  return actual === expected;
}

export function supportsIntegerSchemaVersion(
  range: string,
  version: number
): boolean {
  const clauses = range.trim().split(/\s+/);
  if (clauses.length === 0) return false;
  return clauses.every((clause) => {
    const match = /^(>=|<=|>|<|=)?(\d+)$/.exec(clause);
    if (!match) return false;
    const expected = Number.parseInt(match[2]!, 10);
    return compare(version, match[1] ?? "=", expected);
  });
}

export async function assertPluginDataSchemaCompatibility(options: {
  manifest: ManagedPluginPackageManifest;
  pluginId: string;
  workDir: string;
}): Promise<void> {
  const markerPath = join(
    options.workDir,
    options.pluginId,
    ".pier-plugin-data-schemas.json"
  );
  if (!existsSync(markerPath)) return;
  const marker = managedPluginDataSchemaMarkerSchema.parse(
    JSON.parse(await readFile(markerPath, "utf8"))
  );
  for (const [name, persisted] of Object.entries(marker.schemas)) {
    const declared = options.manifest.dataSchemas?.[name];
    if (!declared) {
      throw new Error(`plugin data schema is not declared: ${name}`);
    }
    if (!supportsIntegerSchemaVersion(declared.read, persisted.version)) {
      throw new Error(
        `plugin data schema ${name}@${persisted.version} is incompatible with ${declared.read}`
      );
    }
  }
}
