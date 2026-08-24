import { catalogEntryFor, importLineFor } from "./catalog.ts";
import { CANVAS_MATERIAL_GROUPS } from "./groups.ts";
import { hostApiSystemMaterials } from "./host-api-catalog.ts";
import type { CanvasSystemMaterial } from "./types.ts";

export { CANVAS_MATERIAL_FAMILY_IDS } from "./types.ts";

function groupedSystemMaterials(): CanvasSystemMaterial[] {
  return CANVAS_MATERIAL_GROUPS.map((group) => {
    const catalog = catalogEntryFor(group.id);
    const isHookSurface = group.family === "data";
    const surface = isHookSurface ? "canvas-file" : "component";
    // data 家族每行对应单个 hook，exportName 取该 hook 本名，避免混入 useCanvasFile。
    const exportName = isHookSurface
      ? (group.members[0] ?? group.id)
      : group.id;
    return {
      commandCount: 0,
      eventCount: 0,
      exportName,
      family: group.family,
      id: group.id,
      importLine: importLineFor(exportName, catalog.usage),
      memberExports: group.members,
      nestedTypes: catalog.nestedTypes ?? [],
      parameters: catalog.parameters ?? [],
      props: catalog.props,
      returnsSignature: catalog.returnsSignature ?? "",
      signature: catalog.signature ?? "",
      surface,
      usage: catalog.usage,
    };
  });
}

function isVisualGroup(family: CanvasSystemMaterial["family"]): boolean {
  return family !== "data";
}

const GROUPED_SYSTEM_MATERIALS = groupedSystemMaterials();

export const CANVAS_SYSTEM_MATERIALS: readonly CanvasSystemMaterial[] = [
  ...GROUPED_SYSTEM_MATERIALS.filter((material) =>
    isVisualGroup(material.family)
  ),
  ...hostApiSystemMaterials(),
  ...GROUPED_SYSTEM_MATERIALS.filter((material) => material.family === "data"),
];
