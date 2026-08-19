import {
  PIER_CANVAS_COMPONENT_EXPORT_NAMES,
  PIER_CANVAS_VALUE_EXPORT_NAMES,
} from "@shared/pier-canvas-export-names.ts";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/locales/en/index.ts";
import { zhCN } from "@/i18n/locales/zh-CN/index.ts";
import { catalogedMaterialIds } from "@/lib/canvas-materials/catalog.ts";
import {
  CANVAS_MATERIAL_GROUPS,
  ungroupedPierCanvasExports,
} from "@/lib/canvas-materials/groups.ts";
import { CANVAS_SYSTEM_MATERIALS } from "@/lib/canvas-materials/registry.ts";
import { CANVAS_MATERIAL_FAMILY_IDS } from "@/lib/canvas-materials/types.ts";

const GALLERY_VALUE_EXPORTS = PIER_CANVAS_VALUE_EXPORT_NAMES;

describe("canvas material registry", () => {
  it("covers every visual pier/canvas export exactly once", () => {
    expect(ungroupedPierCanvasExports()).toEqual([]);
    const members = CANVAS_MATERIAL_GROUPS.flatMap((group) => [
      ...group.members,
    ]);
    expect(new Set(members).size).toBe(members.length);
    expect(members).toEqual(
      expect.arrayContaining([
        ...PIER_CANVAS_COMPONENT_EXPORT_NAMES,
        ...GALLERY_VALUE_EXPORTS,
      ])
    );
  });

  it("keeps overview hooks out of the materials gallery", () => {
    const ids = CANVAS_SYSTEM_MATERIALS.map((row) => row.id);
    expect(ids).not.toContain("useActivityOverview");
    expect(ids).not.toContain("useSystemResources");
    expect(ids).not.toContain("useCostOverview");
    expect(ids).toContain("canvasFile");
    expect(ids).toContain("file");
    expect(ids).toContain("git");
  });

  it("registers four visual families and keeps Button as a control card", () => {
    const families = new Set(CANVAS_SYSTEM_MATERIALS.map((row) => row.family));
    expect([...families].sort()).toEqual(
      [...CANVAS_MATERIAL_FAMILY_IDS].sort()
    );
    const button = CANVAS_SYSTEM_MATERIALS.find((row) => row.id === "Button");
    expect(button?.family).toBe("control");
    expect(button?.importLine).toContain('from "pier/canvas"');
    expect(button?.props.map((prop) => prop.name)).toEqual([
      "variant",
      "disabled",
      "type",
    ]);
  });

  it("install line binds every pier/canvas identifier the usage sample uses", () => {
    const exportNames = new Set<string>([
      ...PIER_CANVAS_COMPONENT_EXPORT_NAMES,
      ...PIER_CANVAS_VALUE_EXPORT_NAMES,
    ]);
    for (const material of CANVAS_SYSTEM_MATERIALS) {
      const referenced = [...material.usage.matchAll(/[A-Za-z][A-Za-z0-9]*/g)]
        .map((match) => match[0])
        .filter((word) => exportNames.has(word));
      for (const name of referenced) {
        expect(
          material.importLine,
          `${material.id} usage references ${name} but install line omits it`
        ).toMatch(new RegExp(`[{,]\\s*${name}\\s*[,}]`));
      }
    }
  });

  it("does not invent a catalog file or declare command", () => {
    const source = CANVAS_SYSTEM_MATERIALS.map((row) => row.id).join("\n");
    expect(source).not.toContain("canvas-catalog");
    expect(source).not.toContain("declare");
  });

  it("has a lead line for every system material in both locales", () => {
    for (const material of CANVAS_SYSTEM_MATERIALS) {
      if (material.surface === "host-api") {
        expect(material.commandCount + material.eventCount).toBeGreaterThan(0);
        continue;
      }
      expect(
        zhCN.settings.materials.lead,
        `zh lead ${material.id}`
      ).toHaveProperty(material.id);
      expect(
        en.settings.materials.lead,
        `en lead ${material.id}`
      ).toHaveProperty(material.id);
    }
  });

  it("catalogs props for every system material", () => {
    const ids = CANVAS_SYSTEM_MATERIALS.map((material) => material.id).sort();
    expect([...catalogedMaterialIds()].sort()).toEqual(ids);
    for (const material of CANVAS_SYSTEM_MATERIALS) {
      expect(material.usage.length).toBeGreaterThan(0);
      expect(material.props.length).toBeGreaterThan(0);
      const described = [
        ...material.props,
        ...material.parameters,
        ...material.nestedTypes.flatMap((type) => type.props ?? []),
      ];
      for (const prop of described) {
        const key = prop.descriptionKey.replace("settings.materials.prop.", "");
        expect(
          en.settings.materials.prop,
          `en prop ${material.id}.${prop.name}`
        ).toHaveProperty(key);
        expect(
          zhCN.settings.materials.prop,
          `zh prop ${material.id}.${prop.name}`
        ).toHaveProperty(key);
      }
      if (material.surface === "host-api") {
        expect(material.signature, material.id).toMatch(
          /^host\.(invoke|subscribe|snapshot)/
        );
        expect(material.returnsSignature, material.id).toMatch(/^type /);
        expect(material.importLine, material.id).not.toContain("pier/canvas");
        expect(material.importLine, material.id).toContain('from "pier/host"');
        if (material.usage.includes("useHostSnapshot")) {
          expect(material.importLine, material.id).toContain("useHostSnapshot");
        }
        if (/\bhost\./.test(material.usage)) {
          expect(material.importLine, material.id).toMatch(
            /[{,]\s*host\s*[,}]/
          );
        }
      }
      if (material.surface === "canvas-file") {
        expect(material.signature, material.id).toMatch(/^function /);
        expect(material.returnsSignature, material.id).toMatch(/interface /);
        expect(material.importLine, material.id).toContain("useCanvasFile");
        expect(material.importLine, material.id).toContain(
          'from "pier/canvas"'
        );
        expect(material.importLine, material.id).not.toMatch(
          /[{,]\s*canvasFile\s*[,}]/
        );
      }
    }
  });
});
