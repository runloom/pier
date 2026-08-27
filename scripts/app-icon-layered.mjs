// macOS 26 (Tahoe) layered app icon pipeline.
//
// The checked-in Icon Composer document is the authored source of truth. Its
// three SVG layers preserve the terminal, berth, and harbor geometry as vectors
// while macOS owns the outer mask and container lighting.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const MAC_ICON_DOCUMENT = "app-icon.icon";
// actool --app-icon name; must match the packaged CFBundleIconName.
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
const MAC_ICON_VECTOR_GROUPS = Object.freeze([
  {
    layerCount: 2,
    layers: ["harbor", "berth-rim"],
    name: "harbor",
  },
  {
    layerCount: 1,
    layers: ["prompt"],
    name: "prompt",
  },
]);

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

/**
 * The compiled car must carry both the layered stack and a full-size flat
 * rendition under the packaged icon name. `inspect` is injectable so tests can
 * pin this contract without spawning the real assetutil.
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
    throw new Error(
      `assetutil returned a non-array catalog for ${carPath}`
    );
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

  const expectedVectorNames = new Set(
    MAC_ICON_VECTOR_GROUPS.flatMap((group) =>
      group.layers.map(
        (layer) => `${MAC_ICON_RENDITION_NAME}_Assets/${layer}`
      )
    )
  );
  const topLevelVectors = entries.filter(
    (entry) =>
      entry.AssetType === "Vector" &&
      typeof entry.Name === "string" &&
      entry.Name.startsWith(`${MAC_ICON_RENDITION_NAME}_Assets/`)
  );
  const topLevelVectorNames = new Set(
    topLevelVectors.map((entry) => entry.Name)
  );
  if (
    topLevelVectors.length !== expectedVectorNames.size ||
    topLevelVectorNames.size !== expectedVectorNames.size ||
    topLevelVectors.some((entry) => entry.Scale !== 1) ||
    [...expectedVectorNames].some((name) => !topLevelVectorNames.has(name))
  ) {
    missing.push("three top-level vector leaves");
  }

  for (const appearance of MAC_ICON_APPEARANCES) {
    const stacks = entries.filter(
      (entry) =>
        entry.Appearance === appearance &&
        entry.AssetType === "IconImageStack" &&
        entry.Name === MAC_ICON_RENDITION_NAME
    );
    const stack = stacks[0];
    if (
      stacks.length !== 1 ||
      stack.LayerCount !== 3 ||
      stack.CanvasWidth !== MAC_ICON_MARK_SIZE ||
      stack.CanvasHeight !== MAC_ICON_MARK_SIZE ||
      stack.Scale !== 1
    ) {
      missing.push(`${appearance} appearance stack`);
    }

    for (const expected of MAC_ICON_VECTOR_GROUPS) {
      const expectedNames = new Set(
        expected.layers.map(
          (layer) => `${MAC_ICON_RENDITION_NAME}_Assets/${layer}`
        )
      );
      const groups = entries.filter(
        (entry) =>
          entry.Appearance === appearance &&
          entry.AssetType === "IconGroup" &&
          entry.Name === `${MAC_ICON_RENDITION_NAME}/${expected.name}`
      );
      const group = groups[0];
      let validGroup =
        groups.length === 1 &&
        group.LayerCount === expected.layerCount &&
        group.Scale === 1 &&
        Array.isArray(group.Layers) &&
        group.Layers.length === expected.layerCount;
      if (validGroup) {
        const vectorLayerNames = new Set(
          group.Layers.filter(
            (layer) => layer.AssetType === "Vector" && layer.Scale === 1
          ).map((layer) => layer.Name)
        );
        validGroup =
          vectorLayerNames.size === expectedNames.size &&
          [...expectedNames].every((name) => vectorLayerNames.has(name));
      }
      if (!validGroup) {
        missing.push(`${appearance} appearance ${expected.name} vector group`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Compiled Assets.car is missing complete appearance coverage for the ${MAC_ICON_RENDITION_NAME} three-layer vector rendition: ${missing.join(
        ", "
      )}`
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
  assertCompiledIconStack(join(options.outputDirectory, "Assets.car"));
}

/**
 * Content fingerprint of an Icon Composer document. actool output embeds
 * volatile metadata, so the compiled car cannot be byte-compared; the
 * committed `Assets.car.inputs` sidecar records which document produced
 * `Assets.car` and gates both rebuild skipping and CI freshness checks.
 * Entries sort byte-wise (not locale collation) so the digest is host-stable;
 * bump the version salt to force a global recompile (e.g. actool upgrades).
 */
export function layeredIconFingerprint(
  documentDirectory,
  compileContract = MAC_ICON_COMPILE_CONTRACT
) {
  const hash = createHash("sha256");
  hash.update("pier-layered-icon-v3");
  hash.update("\0");
  hash.update(
    JSON.stringify({
      appIcon: compileContract.appIcon,
      appearances: MAC_ICON_APPEARANCES,
      includeAllAppIcons: compileContract.includeAllAppIcons,
      minimumDeploymentTarget: compileContract.minimumDeploymentTarget,
      outputFormat: compileContract.outputFormat,
      platform: compileContract.platform,
      schemaVersion: compileContract.schemaVersion,
      targetDevice: compileContract.targetDevice,
      vectorGroups: MAC_ICON_VECTOR_GROUPS,
    })
  );
  hash.update("\0");
  const walk = (directory, prefix) => {
    const entries = readdirSync(directory, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.name !== b.name) {
        return a.name < b.name ? -1 : 1;
      }
      return 0;
    });
    for (const entry of entries) {
      const relative = `${prefix}${entry.name}`;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, `${relative}/`);
        continue;
      }
      hash.update(relative);
      hash.update("\0");
      hash.update(readFileSync(absolute));
      hash.update("\0");
    }
  };
  walk(documentDirectory, "");
  return `${hash.digest("hex")}\n`;
}

export function assertActoolAvailable(command) {
  const result = spawnSync(command, ["--find", "actool"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error(
      "Xcode actool is required to compile the macOS 26 layered icon (build/app-icon.icon → build/Assets.car). Install Xcode 26 or newer and select it with xcode-select.",
      result.error ? { cause: result.error } : undefined
    );
  }
}

/**
 * Stage the authored Icon Composer document byte-for-byte, then reuse or compile
 * Assets.car plus its fingerprint sidecar. `validatePublishedCar` re-runs the
 * rendition checks on a reused car so a corrupted artifact cannot ship.
 */
export async function buildMacLayeredIcon(
  sources,
  stagingDirectory,
  outputDirectory,
  dependencies
) {
  const sourceDocument = join(sources.iconDocument, "icon.json");
  if (!existsSync(sourceDocument)) {
    throw new Error(`Icon Composer source is missing: ${sourceDocument}`);
  }
  const documentText = readFileSync(sourceDocument, "utf8");
  const document = JSON.parse(documentText);
  for (const expected of MAC_ICON_VECTOR_GROUPS) {
    const group = document.groups?.find(
      (candidate) => candidate.name === expected.name
    );
    if (!group || group.layers?.length !== expected.layerCount) {
      throw new Error(
        `${sourceDocument} must preserve the ${expected.name} semantic vector group.`
      );
    }
    for (const layerName of expected.layers) {
      const layer = group.layers.find(
        (candidate) =>
          candidate.name === layerName &&
          candidate["image-name"] === `${layerName}.svg`
      );
      const layerPath = join(
        sources.iconDocument,
        "Assets",
        `${layerName}.svg`
      );
      if (!(layer && existsSync(layerPath))) {
        throw new Error(
          `${sourceDocument} is missing the ${layerName}.svg vector layer.`
        );
      }
    }
  }

  const stagedDocument = join(stagingDirectory, MAC_ICON_DOCUMENT);
  cpSync(sources.iconDocument, stagedDocument, { recursive: true });

  const workingDirectory = join(stagingDirectory, ".layered-icon-tool");
  mkdirSync(workingDirectory, { recursive: true });
  try {
    // actool embeds volatile metadata, so identical inputs never produce
    // identical car bytes. Reuse the published car while the fingerprint of
    // the staged document matches the committed sidecar; delete the sidecar
    // to force a recompile (e.g. after an actool upgrade).
    const fingerprint = layeredIconFingerprint(stagedDocument);
    const publishedCar = join(outputDirectory, "Assets.car");
    const publishedInputs = join(outputDirectory, "Assets.car.inputs");
    const publishedFingerprint = existsSync(publishedInputs)
      ? readFileSync(publishedInputs, "utf8")
      : null;
    if (existsSync(publishedCar) && publishedFingerprint === fingerprint) {
      if (dependencies.validatePublishedCar) {
        assertCompiledIconStack(publishedCar);
      }
      copyFileSync(publishedCar, join(stagingDirectory, "Assets.car"));
      writeFileSync(join(stagingDirectory, "Assets.car.inputs"), fingerprint);
      return;
    }

    const compileDirectory = join(workingDirectory, "out");
    mkdirSync(compileDirectory, { recursive: true });
    await dependencies.compileIconDocument({
      documentDirectory: stagedDocument,
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
    renameSync(car, join(stagingDirectory, "Assets.car"));
    writeFileSync(join(stagingDirectory, "Assets.car.inputs"), fingerprint);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
}
