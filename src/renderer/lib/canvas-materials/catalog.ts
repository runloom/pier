import { PIER_CANVAS_EXPORT_NAMES } from "@shared/pier-canvas-export-names.ts";
import { CATALOG_ENTRIES, CLASS_NAME_PROP } from "./catalog-entries.ts";
import { hostApiDomainIds } from "./host-api-catalog.ts";
import type { CanvasMaterialCatalogEntry } from "./types.ts";

export type { CanvasMaterialCatalogEntry } from "./types.ts";

const EXPORT_NAME_SET: ReadonlySet<string> = new Set(PIER_CANVAS_EXPORT_NAMES);

export function catalogEntryFor(id: string): CanvasMaterialCatalogEntry {
  return (
    CATALOG_ENTRIES[id] ?? {
      props: [CLASS_NAME_PROP],
      usage: `<${id} />`,
    }
  );
}

/**
 * Install line covers every `pier/canvas` export the usage sample references
 * (group members and cross-group helpers alike), so copying Install + Usage
 * into a canvas never leaves unbound identifiers.
 */
export function importLineFor(exportName: string, usage = ""): string {
  const names = new Set<string>([exportName]);
  for (const match of usage.matchAll(/[A-Za-z][A-Za-z0-9]*/g)) {
    if (EXPORT_NAME_SET.has(match[0])) {
      names.add(match[0]);
    }
  }
  return `import { ${[...names].sort((a, b) => a.localeCompare(b)).join(", ")} } from "pier/canvas"`;
}

export function catalogedMaterialIds(): string[] {
  return [...Object.keys(CATALOG_ENTRIES), ...hostApiDomainIds()];
}
