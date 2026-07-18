/**
 * Shared mac host-release asset contract for local dist-builder checks and
 * GitHub Latest isolation.
 *
 * electron-builder default naming (x64 omits arch suffix):
 *   Pier-<ver>-arm64-mac.zip / Pier-<ver>-mac.zip
 *   Pier-<ver>-arm64.dmg     / Pier-<ver>.dmg
 *   latest-mac.yml
 */

/**
 * @param {string} version raw or v-prefixed
 * @returns {string}
 */
export function normalizeReleaseVersion(version) {
  const raw = String(version ?? "").trim();
  if (!raw) {
    throw new Error("release version is required");
  }
  return raw.startsWith("v") ? raw.slice(1) : raw;
}

/**
 * Required host release assets for dual-arch mac packaging.
 * @param {string} version
 * @returns {string[]}
 */
export function requiredMacReleaseAssetNames(version) {
  const v = normalizeReleaseVersion(version);
  return [
    "latest-mac.yml",
    `Pier-${v}-arm64-mac.zip`,
    `Pier-${v}-mac.zip`,
    `Pier-${v}-arm64.dmg`,
    `Pier-${v}.dmg`,
  ];
}

/**
 * Optional differential-update sidecars (nice-to-have, not hard-required).
 * @param {string} version
 * @returns {string[]}
 */
export function recommendedMacReleaseBlockmapNames(version) {
  const v = normalizeReleaseVersion(version);
  return [
    `Pier-${v}-arm64-mac.zip.blockmap`,
    `Pier-${v}-mac.zip.blockmap`,
    `Pier-${v}-arm64.dmg.blockmap`,
    `Pier-${v}.dmg.blockmap`,
  ];
}

/**
 * @param {Iterable<string>} assetNames
 * @param {string} version
 * @returns {string[]}
 */
export function validateMacReleaseAssetNames(assetNames, version) {
  const names = new Set(
    [...assetNames].map((n) => String(n ?? "").trim()).filter(Boolean)
  );
  const required = requiredMacReleaseAssetNames(version);
  const errors = [];
  for (const name of required) {
    if (!names.has(name)) {
      errors.push(`missing required mac release asset: ${name}`);
    }
  }
  return errors;
}

/**
 * Validate latest-mac.yml `files[].url` covers dual-arch zip + dmg.
 * @param {string} ymlText
 * @param {string} version
 * @returns {string[]}
 */
export function validateLatestMacYmlFiles(ymlText, version) {
  const v = normalizeReleaseVersion(version);
  const text = String(ymlText ?? "");
  const urls = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*url:\s*(\S+)\s*$/);
    if (m?.[1]) {
      urls.push(m[1]);
    }
  }
  const requiredFiles = [
    `Pier-${v}-arm64-mac.zip`,
    `Pier-${v}-mac.zip`,
    `Pier-${v}-arm64.dmg`,
    `Pier-${v}.dmg`,
  ];
  const errors = [];
  if (!new RegExp(`^version:\\s*['"]?${v}['"]?\\s*$`, "m").test(text)) {
    errors.push(`latest-mac.yml version does not match ${v}`);
  }
  for (const name of requiredFiles) {
    if (!urls.includes(name)) {
      errors.push(`latest-mac.yml files missing url: ${name}`);
    }
  }
  return errors;
}
