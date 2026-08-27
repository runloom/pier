import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertCompiledIconStack,
  buildMacLayeredIcon,
  layeredIconFingerprint,
  MAC_ICON_APPEARANCES,
  MAC_ICON_COMPILE_CONTRACT,
  MAC_ICON_RENDITION_NAME,
} from "../../../scripts/app-icon-layered.mjs";

const ROOT = process.cwd();
const ICON_DOCUMENT = join(ROOT, "build/app-icon.icon");
const EXPECTED_ICON_DOCUMENT = {
  fill: {
    solid: "srgb:0.07843,0.09412,0.15294,1.00000",
  },
  groups: [
    {
      name: "harbor",
      layers: [
        {
          "image-name": "harbor.svg",
          name: "harbor",
          glass: false,
        },
        {
          "image-name": "berth-rim.svg",
          name: "berth-rim",
          glass: false,
        },
      ],
    },
    {
      name: "prompt",
      layers: [
        {
          "image-name": "prompt.svg",
          name: "prompt",
          glass: false,
        },
      ],
    },
  ],
  "supported-platforms": {
    squares: "shared",
  },
};

function documentFiles(directory: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (current: string, prefix = "") => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const entry of entries) {
      const relative = `${prefix}${entry.name}`;
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, `${relative}/`);
      } else {
        files.set(relative, readFileSync(absolute));
      }
    }
  };
  walk(directory);
  return files;
}

describe("Pier native layered app icon document", () => {
  it("uses two semantic groups and three vector layers", () => {
    expect(
      JSON.parse(readFileSync(join(ICON_DOCUMENT, "icon.json"), "utf8"))
    ).toEqual(EXPECTED_ICON_DOCUMENT);
    expect(readdirSync(join(ICON_DOCUMENT, "Assets")).sort()).toEqual([
      "berth-rim.svg",
      "harbor.svg",
      "prompt.svg",
    ]);
  });

  it.each([
    "harbor.svg",
    "berth-rim.svg",
    "prompt.svg",
  ])("keeps %s as a self-contained 1024-point vector", (name) => {
    const path = join(ICON_DOCUMENT, "Assets", name);
    expect(existsSync(path)).toBe(true);
    const source = readFileSync(path, "utf8");
    expect(source).toMatch(/<svg\b[^>]*viewBox="0 0 1024 1024"/);
    expect(source).not.toMatch(/<(?:image|text)\b/i);
    for (const match of source.matchAll(/\b(?:href|xlink:href)="([^"]+)"/g)) {
      expect(match[1]).toMatch(/^#/);
    }
  });

  it("declares the open berth curve as non-filling for CoreSVG", () => {
    const source = readFileSync(
      join(ICON_DOCUMENT, "Assets", "berth-rim.svg"),
      "utf8"
    );
    const berthCurve = source.match(/<path\s+id="berth-curve"[\s\S]*?\/>/)?.[0];

    expect(berthCurve).toBeDefined();
    expect(berthCurve).toContain('fill="none"');
  });

  it("stages the authored Icon Composer document byte-for-byte without rasterizing it", async () => {
    const root = mkdtempSync(join(tmpdir(), "pier-layered-document-"));
    const stagingDirectory = join(root, "staging");
    const outputDirectory = join(root, "output");
    const rasterize = vi.fn(() => {
      throw new Error("Layered SVG sources must not be rasterized");
    });

    try {
      const compileIconDocument = vi.fn(
        async ({
          outputDirectory: compiledOutput,
        }: {
          outputDirectory: string;
        }) => {
          writeFileSync(join(compiledOutput, "Assets.car"), "compiled-car");
          writeFileSync(
            join(compiledOutput, "partial.plist"),
            `<plist><dict><key>CFBundleIconFile</key><string>${MAC_ICON_RENDITION_NAME}</string><key>CFBundleIconName</key><string>${MAC_ICON_RENDITION_NAME}</string></dict></plist>`
          );
        }
      );

      await buildMacLayeredIcon(
        {
          iconDocument: ICON_DOCUMENT,
          master: join(ROOT, "build/app-icon-master.svg"),
        },
        stagingDirectory,
        outputDirectory,
        {
          compileIconDocument,
          rasterize,
          rsvgCommand: "must-not-run",
          xcrunCommand: "xcrun",
        }
      );

      expect(rasterize).not.toHaveBeenCalled();
      expect(compileIconDocument).toHaveBeenCalledOnce();
      expect(documentFiles(join(stagingDirectory, "app-icon.icon"))).toEqual(
        documentFiles(ICON_DOCUMENT)
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("fingerprints every authored layer", () => {
    const root = mkdtempSync(join(tmpdir(), "pier-layered-fingerprint-"));
    const copiedDocument = join(root, "app-icon.icon");
    cpSync(ICON_DOCUMENT, copiedDocument, { recursive: true });

    try {
      const before = layeredIconFingerprint(copiedDocument);
      const layer = join(copiedDocument, "Assets", "prompt.svg");
      writeFileSync(
        layer,
        `${readFileSync(layer, "utf8")}\n<!-- changed -->\n`
      );
      expect(layeredIconFingerprint(copiedDocument)).not.toBe(before);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("fingerprints the actool compile contract as well as document bytes", () => {
    const baseline = layeredIconFingerprint(ICON_DOCUMENT);
    expect(
      layeredIconFingerprint(ICON_DOCUMENT, {
        ...MAC_ICON_COMPILE_CONTRACT,
        minimumDeploymentTarget: "13.0",
      })
    ).not.toBe(baseline);
  });

  it("requires every native appearance to preserve both groups and all vector leaves", () => {
    const entries = [
      {
        Platform: MAC_ICON_COMPILE_CONTRACT.platform,
        PlatformVersion: MAC_ICON_COMPILE_CONTRACT.minimumDeploymentTarget,
      },
      {
        AssetType: "Icon Image",
        Name: MAC_ICON_RENDITION_NAME,
        PixelHeight: 1024,
        PixelWidth: 1024,
        Scale: 1,
      },
      ...MAC_ICON_APPEARANCES.flatMap((appearance) => [
        {
          Appearance: appearance,
          AssetType: "IconImageStack",
          CanvasHeight: 1024,
          CanvasWidth: 1024,
          LayerCount: 3,
          Name: MAC_ICON_RENDITION_NAME,
          Scale: 1,
        },
        {
          Appearance: appearance,
          AssetType: "IconGroup",
          LayerCount: 2,
          Name: `${MAC_ICON_RENDITION_NAME}/harbor`,
          Scale: 1,
          Layers: [
            {
              AssetType: "Vector",
              Name: `${MAC_ICON_RENDITION_NAME}_Assets/harbor`,
              Scale: 1,
            },
            {
              AssetType: "Vector",
              Name: `${MAC_ICON_RENDITION_NAME}_Assets/berth-rim`,
              Scale: 1,
            },
          ],
        },
        {
          Appearance: appearance,
          AssetType: "IconGroup",
          LayerCount: 1,
          Name: `${MAC_ICON_RENDITION_NAME}/prompt`,
          Scale: 1,
          Layers: [
            {
              AssetType: "Vector",
              Name: `${MAC_ICON_RENDITION_NAME}_Assets/prompt`,
              Scale: 1,
            },
          ],
        },
      ]),
      ...["harbor", "berth-rim", "prompt"].map((name) => ({
        AssetType: "Vector",
        Name: `${MAC_ICON_RENDITION_NAME}_Assets/${name}`,
        Scale: 1,
      })),
    ];

    const inspect = (candidate: unknown[]) => () => ({
      ok: true,
      stderr: "",
      stdout: JSON.stringify(candidate),
    });
    expect(() =>
      assertCompiledIconStack("Assets.car", inspect(entries))
    ).not.toThrow();

    for (const missing of MAC_ICON_APPEARANCES) {
      const incomplete = entries.filter(
        (entry) => !("Appearance" in entry && entry.Appearance === missing)
      );
      expect(
        () => assertCompiledIconStack("Assets.car", inspect(incomplete)),
        missing
      ).toThrow(/missing .*appearance/i);
    }

    const aquaStack = entries.find(
      (entry) =>
        "Appearance" in entry &&
        entry.Appearance === "NSAppearanceNameAqua" &&
        "AssetType" in entry &&
        entry.AssetType === "IconImageStack"
    );
    expect(aquaStack).toBeDefined();
    expect(() =>
      assertCompiledIconStack(
        "Assets.car",
        inspect([...entries, aquaStack as (typeof entries)[number]])
      )
    ).toThrow(/appearance/i);

    const duplicateVector = entries.filter(
      (entry) => !("Name" in entry && entry.Name.endsWith("/berth-rim"))
    );
    duplicateVector.push({
      AssetType: "Vector",
      Name: `${MAC_ICON_RENDITION_NAME}_Assets/harbor`,
      Scale: 1,
    });
    expect(() =>
      assertCompiledIconStack("Assets.car", inspect(duplicateVector))
    ).toThrow(/vector leaves/i);

    expect(() =>
      assertCompiledIconStack("Assets.car", inspect({} as unknown[]))
    ).toThrow(/non-array catalog/i);
  });
});
