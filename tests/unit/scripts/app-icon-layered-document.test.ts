import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCompiledIconStack,
  compiledIconSemanticSignature,
  MAC_ICON_APPEARANCES,
  MAC_ICON_COMPILE_CONTRACT,
  MAC_ICON_DOCUMENT_MANIFEST,
  MAC_ICON_MARK_SIZE,
  MAC_ICON_RENDITION_NAME,
  macIconFingerprint,
  stageMacIconDocument,
} from "../../../scripts/app-icon-layered.mjs";

const ROOT = process.cwd();
const SOURCE = join(ROOT, "build/app-icon-source.svg");

function completeCatalogEntries() {
  return [
    {
      Platform: MAC_ICON_COMPILE_CONTRACT.platform,
      PlatformVersion: MAC_ICON_COMPILE_CONTRACT.minimumDeploymentTarget,
    },
    {
      AssetType: "Icon Image",
      Name: MAC_ICON_RENDITION_NAME,
      PixelHeight: MAC_ICON_MARK_SIZE,
      PixelWidth: MAC_ICON_MARK_SIZE,
      Scale: 1,
    },
    {
      AssetType: "Color",
      "Color components": [0, 0, 0, 0],
      Scale: 1,
    },
    {
      AssetType: "Image",
      Name: `${MAC_ICON_RENDITION_NAME}_Assets/app-icon-source`,
      Opaque: false,
      PixelHeight: MAC_ICON_MARK_SIZE,
      PixelWidth: MAC_ICON_MARK_SIZE,
      Scale: 1,
    },
    ...MAC_ICON_APPEARANCES.flatMap((appearance) => [
      {
        Appearance: appearance,
        AssetType: "IconImageStack",
        CanvasHeight: MAC_ICON_MARK_SIZE,
        CanvasWidth: MAC_ICON_MARK_SIZE,
        CompositeImagePresent: false,
        LayerCount: 2,
        Layers: [
          {
            AssetType: "Color",
            "Color components": [0, 0, 0, 0],
            Scale: 1,
          },
          {
            AssetType: "IconGroup",
            Name: `${MAC_ICON_RENDITION_NAME}/artwork`,
            Scale: 1,
          },
        ],
        Name: MAC_ICON_RENDITION_NAME,
        Scale: 1,
      },
      {
        Appearance: appearance,
        AssetType: "IconGroup",
        LayerCount: 1,
        Layers: [
          {
            AssetType: "Image",
            LayerPosition: "0,0",
            LayerSize: "1024,1024",
            Name: `${MAC_ICON_RENDITION_NAME}_Assets/app-icon-source`,
            Opaque: false,
            PixelHeight: MAC_ICON_MARK_SIZE,
            PixelWidth: MAC_ICON_MARK_SIZE,
            Scale: 1,
          },
        ],
        Name: `${MAC_ICON_RENDITION_NAME}/artwork`,
        Scale: 1,
      },
    ]),
  ];
}

function inspect(entries: unknown) {
  return () => ({
    ok: true,
    stderr: "",
    stdout: JSON.stringify(entries),
  });
}

describe("Pier generated native PNG app icon document", () => {
  it("stages one byte-identical PNG with all native material effects disabled", () => {
    const root = mkdtempSync(join(tmpdir(), "pier-native-icon-document-"));
    const document = join(root, "app-icon.icon");
    try {
      const temporaryPng = join(root, "app-icon-source.png");
      writeFileSync(temporaryPng, Buffer.from("extracted-ic10-png"));
      stageMacIconDocument(temporaryPng, document);
      expect(
        JSON.parse(readFileSync(join(document, "icon.json"), "utf8"))
      ).toEqual(MAC_ICON_DOCUMENT_MANIFEST);
      expect(
        readFileSync(join(document, "Assets/app-icon-source.png"))
      ).toEqual(readFileSync(temporaryPng));
      expect(existsSync(join(ROOT, "build/app-icon.icon"))).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("changes the fingerprint when SVG bytes change but the ic10 PNG stays constant", () => {
    const root = mkdtempSync(join(tmpdir(), "pier-native-icon-fingerprint-"));
    const copy = join(root, "source.svg");
    const sourcePng = Buffer.from("constant-ic10-png");
    copyFileSync(SOURCE, copy);
    try {
      const baseline = macIconFingerprint(copy, sourcePng);
      writeFileSync(
        copy,
        Buffer.concat([readFileSync(copy), Buffer.from("changed")])
      );
      expect(macIconFingerprint(copy, sourcePng)).not.toBe(baseline);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("changes the fingerprint when ic10 PNG bytes change but the SVG stays constant", () => {
    const root = mkdtempSync(join(tmpdir(), "pier-native-icon-fingerprint-"));
    const copy = join(root, "source.svg");
    const sourcePng = Buffer.from("first-ic10-png");
    copyFileSync(SOURCE, copy);
    try {
      const baseline = macIconFingerprint(copy, sourcePng);
      expect(macIconFingerprint(copy, Buffer.from("second-ic10-png"))).not.toBe(
        baseline
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("fingerprints the actool compile contract", () => {
    const root = mkdtempSync(join(tmpdir(), "pier-native-icon-fingerprint-"));
    const copy = join(root, "source.svg");
    const sourcePng = Buffer.from("constant-ic10-png");
    copyFileSync(SOURCE, copy);
    try {
      const baseline = macIconFingerprint(copy, sourcePng);
      copyFileSync(SOURCE, copy);
      expect(
        macIconFingerprint(copy, sourcePng, {
          ...MAC_ICON_COMPILE_CONTRACT,
          minimumDeploymentTarget: "13.0",
        })
      ).not.toBe(baseline);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("accepts exactly one full-size PNG group in every native appearance", () => {
    const entries = completeCatalogEntries();
    expect(() =>
      assertCompiledIconStack("Assets.car", inspect(entries))
    ).not.toThrow();

    for (const appearance of MAC_ICON_APPEARANCES) {
      const incomplete = entries.filter(
        (entry) => !("Appearance" in entry && entry.Appearance === appearance)
      );
      expect(
        () => assertCompiledIconStack("Assets.car", inspect(incomplete)),
        appearance
      ).toThrow(/appearance/i);
    }
  });

  it("rejects duplicate, vector, opaque, or incorrectly sized native leaves", () => {
    const entries = completeCatalogEntries();
    const topImage = entries.find(
      (entry) => "AssetType" in entry && entry.AssetType === "Image"
    );
    expect(topImage).toBeDefined();
    expect(() =>
      assertCompiledIconStack("Assets.car", inspect([...entries, topImage]))
    ).toThrow(/PNG leaf/i);

    const vectorized = entries.map((entry) =>
      "AssetType" in entry && entry.AssetType === "Image"
        ? { ...entry, AssetType: "Vector" }
        : entry
    );
    expect(() =>
      assertCompiledIconStack("Assets.car", inspect(vectorized))
    ).toThrow(/PNG/i);

    expect(() => assertCompiledIconStack("Assets.car", inspect({}))).toThrow(
      /non-array catalog/i
    );
  });

  it("rejects any native shadow, specular, or translucency reintroduced by Xcode", () => {
    for (const field of [
      "LayerShadowOpacity",
      "LayerShadowStyle",
      "LayerHasSpecular",
      "LayerTranslucency",
    ]) {
      const mutated = completeCatalogEntries().map((entry) => {
        if (
          !(
            "AssetType" in entry &&
            entry.AssetType === "IconImageStack" &&
            "Layers" in entry
          )
        ) {
          return entry;
        }
        const layers = entry.Layers as Record<string, unknown>[];
        return {
          ...entry,
          Layers: layers.map((layer) =>
            layer.AssetType === "IconGroup" ? { ...layer, [field]: 1 } : layer
          ),
        };
      });
      expect(
        () => assertCompiledIconStack("Assets.car", inspect(mutated)),
        field
      ).toThrow(/appearance stack/i);
    }
  });

  it("rejects active lighting effects on every appearance image leaf", () => {
    for (const appearance of MAC_ICON_APPEARANCES) {
      const mutated = completeCatalogEntries().map((entry) => {
        const isTargetImageGroup =
          "Appearance" in entry &&
          entry.Appearance === appearance &&
          "AssetType" in entry &&
          entry.AssetType === "IconGroup" &&
          "Layers" in entry;
        if (!isTargetImageGroup) {
          return entry;
        }
        const layers = entry.Layers as Record<string, unknown>[];
        return {
          ...entry,
          Layers: layers.map((layer) =>
            layer.AssetType === "Image"
              ? {
                  ...layer,
                  LayerGathersSpecularByElement: true,
                  LayerHasLightingEffects: true,
                }
              : layer
          ),
        };
      });

      expect(
        () => assertCompiledIconStack("Assets.car", inspect(mutated)),
        appearance
      ).toThrow(/PNG group/i);
    }
  });

  it("allows gather-specular metadata without active lighting effects", () => {
    const entries = completeCatalogEntries().map((entry) => {
      if (
        !(
          "AssetType" in entry &&
          entry.AssetType === "IconGroup" &&
          "Layers" in entry
        )
      ) {
        return entry;
      }
      const layers = entry.Layers as Record<string, unknown>[];
      return {
        ...entry,
        Layers: layers.map((layer) =>
          layer.AssetType === "Image"
            ? { ...layer, LayerGathersSpecularByElement: true }
            : layer
        ),
      };
    });

    expect(() =>
      assertCompiledIconStack("Assets.car", inspect(entries))
    ).not.toThrow();
  });

  it("compares compiled catalogs by visible rendition digests, not volatile metadata", () => {
    const first = [
      {
        AssetStorageVersion: "Xcode 26.3",
        Timestamp: 1,
      },
      {
        Appearance: "NSAppearanceNameAqua",
        AssetType: "Image",
        Name: "app-icon_Assets/app-icon-source",
        PixelHeight: 1024,
        PixelWidth: 1024,
        RenditionName: "source-volatile-a.png",
        SHA1Digest: "VISIBLE-DIGEST",
        SizeOnDisk: 100,
      },
      {
        AssetType: "Icon Image",
        Name: MAC_ICON_RENDITION_NAME,
        PixelHeight: 32,
        PixelWidth: 32,
        SHA1Digest: "VOLATILE-FALLBACK-A",
      },
    ];
    const second = [
      {
        AssetStorageVersion: "Xcode 26.6",
        Timestamp: 2,
      },
      {
        Appearance: "NSAppearanceNameAqua",
        AssetType: "Image",
        Name: "app-icon_Assets/app-icon-source",
        PixelHeight: 1024,
        PixelWidth: 1024,
        RenditionName: "source-volatile-b.png",
        SHA1Digest: "VISIBLE-DIGEST",
        SizeOnDisk: 200,
      },
      {
        AssetType: "Icon Image",
        Name: MAC_ICON_RENDITION_NAME,
        PixelHeight: 32,
        PixelWidth: 32,
        SHA1Digest: "VOLATILE-FALLBACK-B",
      },
    ];

    expect(compiledIconSemanticSignature("first.car", inspect(first))).toBe(
      compiledIconSemanticSignature("second.car", inspect(second))
    );
    (second[1] as Record<string, unknown>).SHA1Digest =
      "DIFFERENT-VISIBLE-DIGEST";
    expect(compiledIconSemanticSignature("first.car", inspect(first))).not.toBe(
      compiledIconSemanticSignature("second.car", inspect(second))
    );
  });
});
