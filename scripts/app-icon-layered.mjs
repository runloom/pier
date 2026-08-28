// macOS 26+ native app-icon pipeline.
//
// A validated 1024px ICNS frame is staged in a minimal Icon Composer document,
// then discarded. Only Assets.car and the authored SVG fingerprint are
// published.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const MAC_ICON_DOCUMENT = "app-icon.icon";
export const MAC_ICON_RENDITION_NAME = "app-icon";
export const MAC_ICON_MARK_SIZE = 1024;
export const MAC_ICON_APPEARANCES = Object.freeze([
  "NSAppearanceNameAqua",
  "NSAppearanceNameDarkAqua",
  "ISAppearanceTintable",
]);
export const MAC_ICON_COMPILE_CONTRACT = Object.freeze({
  appIcon: MAC_ICON_RENDITION_NAME,
  includeAllAppIcons: true,
  minimumDeploymentTarget: "12.0",
  outputFormat: "human-readable-text",
  platform: "macosx",
  schemaVersion: 1,
  targetDevice: "mac",
});
export const MAC_ICON_RENDER_CONTRACT = Object.freeze({
  frame: "ic10",
  input: "svg",
  renderer: "electron-builder-pinned-icons-tool",
  resize: "lanczos",
  size: MAC_ICON_MARK_SIZE,
  version: 1,
});
export const MAC_ICON_DOCUMENT_MANIFEST = Object.freeze({
  fill: {
    solid: "srgb:0.00000,0.00000,0.00000,0.00000",
  },
  groups: [
    {
      layers: [
        {
          glass: false,
          "image-name": "app-icon-source.png",
          name: "pier",
        },
      ],
      name: "artwork",
      shadow: {
        kind: "none",
        opacity: 0,
      },
      specular: false,
      translucency: {
        enabled: false,
        value: 0,
      },
    },
  ],
  "supported-platforms": {
    squares: "shared",
  },
});

function runChecked(command, args) {
  const result = spawnSync(command, args, {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.error) {
    throw new Error(`${command} could not start: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} → exit ${result.status}`);
  }
}

function assetUtilInfo(carPath) {
  const info = spawnSync("assetutil", ["--info", carPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: !info.error && info.status === 0,
    stdout: info.stdout ?? "",
    stderr: info.stderr ?? "",
  };
}

const SEMANTIC_RENDITION_KEYS = Object.freeze([
  "Appearance",
  "AssetType",
  "CanvasHeight",
  "CanvasWidth",
  "Color components",
  "ColorModel",
  "Colorspace",
  "LayerCount",
  "Name",
  "Opaque",
  "PixelHeight",
  "PixelWidth",
  "Scale",
  "SHA1Digest",
]);

/**
 * Return a stable signature of the rendered catalog content. actool writes
 * volatile timestamps, UUID-bearing rendition names, compression sizes, and
 * tool metadata into Assets.car, so byte equality is not reproducible even
 * for identical input. Visible rendition digests and geometry are stable.
 */
export function compiledIconSemanticSignature(
  carPath,
  inspect = assetUtilInfo
) {
  const info = inspect(carPath);
  if (!info.ok) {
    throw new Error(
      `assetutil could not inspect the compiled ${carPath}${info.stderr ? `\n${info.stderr}` : ""}`
    );
  }
  let entries;
  try {
    entries = JSON.parse(info.stdout);
  } catch (error) {
    throw new Error(`assetutil returned invalid JSON for ${carPath}`, {
      cause: error,
    });
  }
  if (!Array.isArray(entries)) {
    throw new Error(`assetutil returned a non-array catalog for ${carPath}`);
  }
  const renditions = entries
    .filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        entry.AssetType !== "Icon Image" &&
        typeof entry.SHA1Digest === "string"
    )
    .map((entry) =>
      Object.fromEntries(
        SEMANTIC_RENDITION_KEYS.flatMap((key) =>
          key in entry ? [[key, entry[key]]] : []
        )
      )
    )
    .map((entry) => JSON.stringify(entry))
    .sort();
  if (renditions.length === 0) {
    throw new Error(
      `Compiled ${carPath} does not expose visible rendition digests`
    );
  }
  return JSON.stringify(renditions);
}

export function stageMacIconDocument(sourcePng, documentDirectory) {
  if (!existsSync(sourcePng)) {
    throw new Error(`Canonical app icon is missing: ${sourcePng}`);
  }
  const assetsDirectory = join(documentDirectory, "Assets");
  mkdirSync(assetsDirectory, { recursive: true });
  copyFileSync(sourcePng, join(assetsDirectory, "app-icon-source.png"));
  writeFileSync(
    join(documentDirectory, "icon.json"),
    `${JSON.stringify(MAC_ICON_DOCUMENT_MANIFEST, null, 2)}\n`
  );
}

/**
 * @param {string} sourceSvg
 * @param {Buffer} sourcePngBytes
 * @param {Readonly<Record<string, unknown>>} [compileContract]
 */
export function macIconFingerprint(
  sourceSvg,
  sourcePngBytes,
  compileContract = MAC_ICON_COMPILE_CONTRACT
) {
  const hash = createHash("sha256");
  hash.update("pier-svg-native-icon-v2\0");
  hash.update(
    JSON.stringify({
      appearances: MAC_ICON_APPEARANCES,
      compileContract,
      document: MAC_ICON_DOCUMENT_MANIFEST,
      renderer: MAC_ICON_RENDER_CONTRACT,
    })
  );
  hash.update("\0svg\0");
  hash.update(readFileSync(sourceSvg));
  hash.update("\0png\0");
  hash.update(sourcePngBytes);
  return `${hash.digest("hex")}\n`;
}

/**
 * The compiled catalog must contain a full-size fallback plus one bitmap stack
 * for each native appearance. Exact rendition order and volatile Xcode
 * metadata are intentionally ignored.
 */
export function assertCompiledIconStack(carPath, inspect = assetUtilInfo) {
  const info = inspect(carPath);
  if (!info.ok) {
    throw new Error(
      `assetutil could not inspect the compiled ${carPath}${info.stderr ? `\n${info.stderr}` : ""}`
    );
  }
  let entries;
  try {
    entries = JSON.parse(info.stdout);
  } catch (error) {
    throw new Error(
      `assetutil returned unparseable output for ${carPath}: ${info.stdout.slice(0, 200)}`,
      { cause: error }
    );
  }
  if (!Array.isArray(entries)) {
    throw new Error(`assetutil returned a non-array catalog for ${carPath}`);
  }

  const missing = [];
  const hasCompileMetadata = entries.some(
    (entry) =>
      entry.Platform === MAC_ICON_COMPILE_CONTRACT.platform &&
      entry.PlatformVersion ===
        MAC_ICON_COMPILE_CONTRACT.minimumDeploymentTarget
  );
  if (!hasCompileMetadata) {
    missing.push(
      `${MAC_ICON_COMPILE_CONTRACT.platform} ${MAC_ICON_COMPILE_CONTRACT.minimumDeploymentTarget} compile metadata`
    );
  }
  const hasFullSizeIcon = entries.some(
    (entry) =>
      entry.AssetType === "Icon Image" &&
      entry.Name === MAC_ICON_RENDITION_NAME &&
      entry.PixelWidth === MAC_ICON_MARK_SIZE &&
      entry.PixelHeight === MAC_ICON_MARK_SIZE &&
      entry.Scale === 1
  );
  if (!hasFullSizeIcon) {
    missing.push(`${MAC_ICON_MARK_SIZE}px full-size fallback`);
  }

  const images = entries.filter(
    (entry) =>
      entry.AssetType === "Image" &&
      entry.Name === `${MAC_ICON_RENDITION_NAME}_Assets/app-icon-source`
  );
  const image = images[0];
  if (
    images.length !== 1 ||
    image.Opaque !== false ||
    image.PixelWidth !== MAC_ICON_MARK_SIZE ||
    image.PixelHeight !== MAC_ICON_MARK_SIZE ||
    image.Scale !== 1
  ) {
    missing.push("one full-size PNG leaf");
  }
  if (
    entries.some(
      (entry) =>
        entry.AssetType === "Vector" &&
        typeof entry.Name === "string" &&
        entry.Name.startsWith(`${MAC_ICON_RENDITION_NAME}_Assets/`)
    )
  ) {
    missing.push("zero vector leaves");
  }
  const hasTransparentFill = entries.some(
    (entry) =>
      entry.AssetType === "Color" &&
      entry.Scale === 1 &&
      Array.isArray(entry["Color components"]) &&
      entry["Color components"].length === 4 &&
      entry["Color components"].every((component) => component === 0)
  );
  if (!hasTransparentFill) {
    missing.push("transparent native fill");
  }

  for (const appearance of MAC_ICON_APPEARANCES) {
    const stacks = entries.filter(
      (entry) =>
        entry.Appearance === appearance &&
        entry.AssetType === "IconImageStack" &&
        entry.Name === MAC_ICON_RENDITION_NAME
    );
    const stack = stacks[0];
    const stackLayers = Array.isArray(stack?.Layers) ? stack.Layers : [];
    const transparentFills = stackLayers.filter(
      (layer) =>
        layer.AssetType === "Color" &&
        Array.isArray(layer["Color components"]) &&
        layer["Color components"].length === 4 &&
        layer["Color components"].every((component) => component === 0)
    );
    const groupReferences = stackLayers.filter(
      (layer) =>
        layer.AssetType === "IconGroup" &&
        layer.Name === `${MAC_ICON_RENDITION_NAME}/artwork`
    );
    const groupReferencesDisableEffects = groupReferences.every(
      (layer) =>
        layer.LayerShadowOpacity == null &&
        layer.LayerShadowStyle == null &&
        layer.LayerHasSpecular == null &&
        layer.LayerTranslucency == null
    );
    if (
      stacks.length !== 1 ||
      stack.LayerCount !== 2 ||
      stack.CompositeImagePresent !== false ||
      stack.CanvasWidth !== MAC_ICON_MARK_SIZE ||
      stack.CanvasHeight !== MAC_ICON_MARK_SIZE ||
      stack.Scale !== 1 ||
      transparentFills.length !== 1 ||
      groupReferences.length === 0 ||
      !groupReferencesDisableEffects
    ) {
      missing.push(`${appearance} appearance stack`);
    }

    const groups = entries.filter(
      (entry) =>
        entry.Appearance === appearance &&
        entry.AssetType === "IconGroup" &&
        entry.Name === `${MAC_ICON_RENDITION_NAME}/artwork`
    );
    const group = groups[0];
    if (
      groups.length !== 1 ||
      group.LayerCount !== 1 ||
      group.Scale !== 1 ||
      !Array.isArray(group.Layers) ||
      group.Layers.length !== 1 ||
      group.Layers[0]?.AssetType !== "Image" ||
      group.Layers[0]?.Name !==
        `${MAC_ICON_RENDITION_NAME}_Assets/app-icon-source` ||
      group.Layers[0]?.Opaque !== false ||
      group.Layers[0]?.PixelWidth !== MAC_ICON_MARK_SIZE ||
      group.Layers[0]?.PixelHeight !== MAC_ICON_MARK_SIZE ||
      group.Layers[0]?.LayerPosition !== "0,0" ||
      group.Layers[0]?.LayerSize !== "1024,1024" ||
      group.Layers[0]?.LayerHasLightingEffects === true ||
      group.Layers[0]?.Scale !== 1
    ) {
      missing.push(`${appearance} appearance PNG group`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Compiled Assets.car is missing complete appearance coverage for the ${MAC_ICON_RENDITION_NAME} single-PNG rendition: ${missing.join(
        ", "
      )}`
    );
  }
}

export function assertCompiledIconIntegrity(carPath, command = "assetutil") {
  const result = spawnSync(command, ["-Z", carPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `assetutil integrity validation failed for ${carPath}${result.stderr ? `\n${result.stderr}` : ""}`,
      result.error ? { cause: result.error } : undefined
    );
  }
}

export function compileIconDocumentWithActool(options) {
  const args = [
    "actool",
    options.documentDirectory,
    "--compile",
    options.outputDirectory,
    "--app-icon",
    MAC_ICON_COMPILE_CONTRACT.appIcon,
  ];
  if (MAC_ICON_COMPILE_CONTRACT.includeAllAppIcons) {
    args.push("--include-all-app-icons");
  }
  args.push(
    "--output-partial-info-plist",
    join(options.outputDirectory, "partial.plist"),
    "--platform",
    MAC_ICON_COMPILE_CONTRACT.platform,
    "--minimum-deployment-target",
    MAC_ICON_COMPILE_CONTRACT.minimumDeploymentTarget,
    "--target-device",
    MAC_ICON_COMPILE_CONTRACT.targetDevice,
    "--output-format",
    MAC_ICON_COMPILE_CONTRACT.outputFormat,
    "--warnings",
    "--errors"
  );
  runChecked(options.xcrunCommand, args);
  const car = join(options.outputDirectory, "Assets.car");
  assertCompiledIconStack(car);
  assertCompiledIconIntegrity(car);
}

export function assertActoolAvailable(command) {
  const result = spawnSync(command, ["--find", "actool"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error(
      "Xcode actool is required to compile the macOS 26 PNG icon stack. Install Xcode 26 or newer and select it with xcode-select.",
      result.error ? { cause: result.error } : undefined
    );
  }
}

export async function buildMacLayeredIcon(
  sourcePng,
  sourceSvg,
  stagingDirectory,
  outputDirectory,
  dependencies
) {
  const fingerprint = macIconFingerprint(sourceSvg, readFileSync(sourcePng));
  const publishedCar = join(outputDirectory, "Assets.car");

  const workingDirectory = join(stagingDirectory, ".layered-icon-tool");
  const documentDirectory = join(workingDirectory, MAC_ICON_DOCUMENT);
  const compileDirectory = join(workingDirectory, "out");
  mkdirSync(compileDirectory, { recursive: true });
  try {
    stageMacIconDocument(sourcePng, documentDirectory);
    await dependencies.compileIconDocument({
      documentDirectory,
      outputDirectory: compileDirectory,
      xcrunCommand: dependencies.xcrunCommand,
    });

    const car = join(compileDirectory, "Assets.car");
    if (!existsSync(car)) {
      throw new Error("actool did not produce Assets.car");
    }
    const partial = join(compileDirectory, "partial.plist");
    const partialText = existsSync(partial)
      ? readFileSync(partial, "utf8")
      : "";
    const hasPlistValue = (key) =>
      new RegExp(
        `<key>\\s*${key}\\s*</key>\\s*<string>\\s*${MAC_ICON_RENDITION_NAME}\\s*</string>`
      ).test(partialText);
    if (
      !(hasPlistValue("CFBundleIconFile") && hasPlistValue("CFBundleIconName"))
    ) {
      throw new Error(
        `Compiled icon partial Info.plist must declare CFBundleIconFile and CFBundleIconName as ${MAC_ICON_RENDITION_NAME}`
      );
    }
    let preservePublishedCar = false;
    if (existsSync(publishedCar)) {
      try {
        if (dependencies.validatePublishedCar) {
          assertCompiledIconStack(publishedCar);
          assertCompiledIconIntegrity(publishedCar);
        }
        preservePublishedCar =
          dependencies.compiledIconSemanticSignature(publishedCar) ===
          dependencies.compiledIconSemanticSignature(car);
      } catch {
        preservePublishedCar = false;
      }
    }
    if (preservePublishedCar) {
      copyFileSync(publishedCar, join(stagingDirectory, "Assets.car"));
    } else {
      renameSync(car, join(stagingDirectory, "Assets.car"));
    }
    writeFileSync(join(stagingDirectory, "Assets.car.inputs"), fingerprint);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
}
