// macOS 26 (Tahoe) layered app icon pipeline.
//
// The mark layer (Assets/pier-mark.png inside the Icon Composer document) is
// derived from app-icon-master.svg by stripping the plate rects and cropping
// to the optically scaled plate box; the document is then compiled with Xcode's
// actool into Assets.car so Tahoe renders the layered rendition natively
// instead of boxing the legacy ICNS onto a system plate.

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
const MAC_ICON_MARK_FILE = "pier-mark.png";
export const MAC_ICON_MARK_SIZE = 1024;
// Apple Big Sur layout of app-icon-master.svg: 1024 canvas, 824 plate ×1.06.
// The Tahoe mark layer is the master artwork minus the plate, cropped to the
// optically scaled plate box so the .icon canvas is the full-bleed plate area.
const MAC_ICON_PLATE = Object.freeze({
  canvas: 1024,
  inset: 100,
  opticalScale: 1.06,
  size: 824,
});
const MASTER_VIEW_BOX = 'viewBox="0 0 1024 1024"';
const MASTER_PLATE_RECT =
  '<rect x="100" y="100" width="824" height="824" rx="185" fill="#101725"/>';
const MASTER_PLATE_STROKE =
  '<rect x="103" y="103" width="818" height="818" rx="182" fill="none" stroke="#30394b" stroke-width="6"/>';

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

/**
 * Master rendition minus the plate rects, cropped to the optically scaled
 * plate box. Tahoe supplies plate, mask, and edge lighting itself; shipping
 * the old plate would reintroduce the double-border artifact.
 */
export function tahoeMarkSvg(masterSvg) {
  if (
    !(
      masterSvg.includes(MASTER_VIEW_BOX) &&
      masterSvg.includes(MASTER_PLATE_RECT) &&
      masterSvg.includes(MASTER_PLATE_STROKE)
    )
  ) {
    throw new Error(
      "app-icon-master.svg no longer matches the approved plate markers; update tahoeMarkSvg in scripts/app-icon-layered.mjs."
    );
  }
  const origin =
    MAC_ICON_PLATE.canvas / 2 +
    (MAC_ICON_PLATE.inset - MAC_ICON_PLATE.canvas / 2) *
      MAC_ICON_PLATE.opticalScale;
  const size = MAC_ICON_PLATE.size * MAC_ICON_PLATE.opticalScale;
  return masterSvg
    .replace(MASTER_PLATE_RECT, "")
    .replace(MASTER_PLATE_STROKE, "")
    .replace(MASTER_VIEW_BOX, `viewBox="${origin} ${origin} ${size} ${size}"`);
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
  const hasLayeredStack = entries.some(
    (entry) =>
      entry.AssetType === "IconImageStack" &&
      entry.Name === MAC_ICON_RENDITION_NAME
  );
  const hasFullSizeIcon = entries.some(
    (entry) =>
      entry.AssetType === "Icon Image" &&
      entry.Name === MAC_ICON_RENDITION_NAME &&
      entry.PixelWidth === MAC_ICON_MARK_SIZE
  );
  if (!(hasLayeredStack && hasFullSizeIcon)) {
    throw new Error(
      `Compiled Assets.car is missing the ${MAC_ICON_RENDITION_NAME} layered rendition`
    );
  }
}

export function compileIconDocumentWithActool(options) {
  runChecked(options.xcrunCommand, [
    "actool",
    options.documentDirectory,
    "--compile",
    options.outputDirectory,
    "--app-icon",
    MAC_ICON_RENDITION_NAME,
    "--include-all-app-icons",
    "--output-partial-info-plist",
    join(options.outputDirectory, "partial.plist"),
    "--platform",
    "macosx",
    "--minimum-deployment-target",
    "12.0",
    "--target-device",
    "mac",
    "--output-format",
    "human-readable-text",
    "--warnings",
    "--errors",
  ]);
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
export function layeredIconFingerprint(documentDirectory) {
  const hash = createHash("sha256");
  hash.update("pier-layered-icon-v1");
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
 * Regenerate the staged Icon Composer document's mark layer, then stage either
 * the reused or a freshly compiled Assets.car plus its fingerprint sidecar.
 * `dependencies.rasterize` / `dependencies.compileIconDocument` are injected by
 * build-app-icons.mjs; `validatePublishedCar` re-runs the rendition checks on a
 * reused car so a corrupted published artifact cannot ship silently.
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
  JSON.parse(documentText);
  if (!documentText.includes(`"${MAC_ICON_MARK_FILE}"`)) {
    throw new Error(
      `${sourceDocument} no longer references ${MAC_ICON_MARK_FILE}; align it with the generated mark layer.`
    );
  }

  const stagedDocument = join(stagingDirectory, MAC_ICON_DOCUMENT);
  cpSync(sources.iconDocument, stagedDocument, { recursive: true });
  const stagedAssets = join(stagedDocument, "Assets");
  mkdirSync(stagedAssets, { recursive: true });

  const workingDirectory = join(stagingDirectory, ".layered-icon-tool");
  mkdirSync(workingDirectory, { recursive: true });
  try {
    const markSvg = join(workingDirectory, "mark.svg");
    writeFileSync(markSvg, tahoeMarkSvg(readFileSync(sources.master, "utf8")));
    dependencies.rasterize(
      dependencies.rsvgCommand,
      markSvg,
      MAC_ICON_MARK_SIZE,
      join(stagedAssets, MAC_ICON_MARK_FILE)
    );

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
    if (
      !(
        partialText.includes("CFBundleIconName") &&
        partialText.includes(`<string>${MAC_ICON_RENDITION_NAME}</string>`)
      )
    ) {
      throw new Error(
        `Compiled icon partial Info.plist does not declare CFBundleIconName=${MAC_ICON_RENDITION_NAME}`
      );
    }
    renameSync(car, join(stagingDirectory, "Assets.car"));
    writeFileSync(join(stagingDirectory, "Assets.car.inputs"), fingerprint);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
}
