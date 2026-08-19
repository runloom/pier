export const CANVAS_MATERIAL_FAMILY_IDS = [
  "layout",
  "control",
  "viz",
  "data",
] as const;

export type CanvasMaterialFamilyId =
  (typeof CANVAS_MATERIAL_FAMILY_IDS)[number];

export interface CanvasMaterialProp {
  /** Present on component props and hook parameters; omitted on return fields. */
  defaultValue?: string;
  descriptionKey: string;
  name: string;
  type: string;
}

export interface CanvasMaterialNestedType {
  name: string;
  props?: readonly CanvasMaterialProp[];
  signature: string;
}

export interface CanvasMaterialCatalogEntry {
  nestedTypes?: readonly CanvasMaterialNestedType[];
  parameters?: readonly CanvasMaterialProp[];
  props: readonly CanvasMaterialProp[];
  returnsSignature?: string;
  signature?: string;
  usage: string;
}

export type CanvasMaterialSurface = "canvas-file" | "component" | "host-api";

export interface CanvasSystemMaterial {
  commandCount: number;
  eventCount: number;
  exportName: string;
  family: CanvasMaterialFamilyId;
  id: string;
  importLine: string;
  memberExports: readonly string[];
  nestedTypes: readonly CanvasMaterialNestedType[];
  parameters: readonly CanvasMaterialProp[];
  props: readonly CanvasMaterialProp[];
  returnsSignature: string;
  signature: string;
  surface: CanvasMaterialSurface;
  usage: string;
}
