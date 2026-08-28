import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export const MAC_HELPER_SUFFIXES = Object.freeze([
  "",
  " (GPU)",
  " (Plugin)",
  " (Renderer)",
]);

const STALE_HELPER_ICON_RESOURCES = Object.freeze([
  "electron.icns",
  "AppIcon.icns",
  "Assets.car",
]);

function xmlText(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function plistRootDictRange(source) {
  const plist = /<plist\b[^>]*>/i.exec(source);
  if (!plist) {
    throw new Error("plist is missing its <plist> root");
  }
  const tags = /<dict\b[^>]*>|<\/dict\s*>/gi;
  tags.lastIndex = plist.index + plist[0].length;
  let depth = 0;
  let openEnd;
  for (let match = tags.exec(source); match; match = tags.exec(source)) {
    if (/^<dict\b/i.test(match[0])) {
      if (depth === 0 && openEnd === undefined) {
        openEnd = tags.lastIndex;
      }
      depth += 1;
      continue;
    }
    if (openEnd === undefined || depth === 0) {
      throw new Error("plist has an unmatched </dict>");
    }
    depth -= 1;
    if (depth === 0) {
      return { closeStart: match.index, openEnd };
    }
  }
  throw new Error("plist root dictionary is not closed");
}

function plistRootStrings(source) {
  const range = plistRootDictRange(source);
  const inner = source.slice(range.openEnd, range.closeStart);
  const tokens =
    /<(?:dict|array)\b[^>]*>|<\/(?:dict|array)\s*>|<key\b[^>]*>[\s\S]*?<\/key\s*>|<string\b[^>]*>[\s\S]*?<\/string\s*>|<(?:true|false)\s*\/>|<(?:integer|real|date|data)\b[^>]*>[\s\S]*?<\/(?:integer|real|date|data)\s*>/gi;
  const entries = [];
  const rootKeys = [];
  let containerDepth = 0;
  let pendingKey;
  for (let match = tokens.exec(inner); match; match = tokens.exec(inner)) {
    const token = match[0];
    const absoluteStart = range.openEnd + match.index;
    const absoluteEnd = range.openEnd + tokens.lastIndex;
    if (/^<(?:dict|array)\b/i.test(token)) {
      if (containerDepth === 0) {
        pendingKey = undefined;
      }
      containerDepth += 1;
      continue;
    }
    if (/^<\/(?:dict|array)/i.test(token)) {
      containerDepth -= 1;
      if (containerDepth < 0) {
        throw new Error("plist root contains an unmatched container close");
      }
      continue;
    }
    if (containerDepth !== 0) {
      continue;
    }
    if (/^<key\b/i.test(token)) {
      const rawKey = token
        .replace(/^<key\b[^>]*>/i, "")
        .replace(/<\/key\s*>$/i, "");
      pendingKey = {
        key: xmlText(rawKey.trim()),
        start: absoluteStart,
      };
      rootKeys.push(pendingKey.key);
      continue;
    }
    if (/^<string\b/i.test(token) && pendingKey) {
      const rawValue = token
        .replace(/^<string\b[^>]*>/i, "")
        .replace(/<\/string\s*>$/i, "");
      entries.push({
        end: absoluteEnd,
        key: pendingKey.key,
        start: pendingKey.start,
        value: xmlText(rawValue),
      });
    }
    pendingKey = undefined;
  }
  if (containerDepth !== 0) {
    throw new Error("plist root contains an unclosed container");
  }
  return { entries, range, rootKeys };
}

export function rootPlistStringValue(source, key) {
  const parsed = plistRootStrings(source);
  const entry = parsed.entries.find((candidate) => candidate.key === key);
  if (entry) {
    return entry.value;
  }
  if (parsed.rootKeys.includes(key)) {
    return null;
  }
}

function updateRootPlistStrings(source, set, remove) {
  const parsed = plistRootStrings(source);
  const targets = new Set([...Object.keys(set), ...remove]);
  for (const key of targets) {
    const keyCount = parsed.rootKeys.filter(
      (candidate) => candidate === key
    ).length;
    const stringCount = parsed.entries.filter(
      (entry) => entry.key === key
    ).length;
    if (keyCount !== stringCount) {
      throw new Error(
        `Cannot update ${key}: the root plist value is not a string`
      );
    }
  }

  let next = source;
  const removals = parsed.entries
    .filter((entry) => targets.has(entry.key))
    .sort((a, b) => b.start - a.start);
  for (const entry of removals) {
    next = `${next.slice(0, entry.start)}${next.slice(entry.end)}`;
  }

  const nextRange = plistRootDictRange(next);
  const additions = Object.entries(set)
    .map(
      ([key, value]) =>
        `\t<key>${xmlEscape(key)}</key>\n\t<string>${xmlEscape(value)}</string>`
    )
    .join("\n");
  if (additions) {
    next = `${next.slice(0, nextRange.closeStart)}${additions}\n${next.slice(nextRange.closeStart)}`;
  }
  return next;
}

/**
 * Give every production Helper the exact canonical ICNS before electron-builder
 * signs the bundle. Helpers deliberately stay ICNS-only: the main Pier app is
 * the sole owner of the macOS native Assets.car rendition.
 */
export async function installMacHelperIcons(appPath, options = {}) {
  const app = resolve(appPath);
  const iconPath = resolve(options.iconPath ?? "build/icon.icns");
  const productName = options.productName ?? basename(app, ".app");
  const canonicalIcon = await readFile(iconPath);

  // Build the complete mutation plan first so a malformed or missing Helper
  // cannot leave a half-branded application bundle behind.
  const plans = await Promise.all(
    MAC_HELPER_SUFFIXES.map(async (suffix) => {
      const helperName = `${productName} Helper${suffix}.app`;
      const contents = join(
        app,
        "Contents",
        "Frameworks",
        helperName,
        "Contents"
      );
      const plistPath = join(contents, "Info.plist");
      let plist;
      try {
        plist = await readFile(plistPath, "utf8");
      } catch (error) {
        throw new Error(
          `${helperName} is missing a readable Contents/Info.plist`,
          { cause: error }
        );
      }
      const nextPlist = updateRootPlistStrings(
        plist,
        { CFBundleIconFile: "icon.icns" },
        ["CFBundleIconName"]
      );
      if (
        rootPlistStringValue(nextPlist, "CFBundleIconFile") !== "icon.icns" ||
        rootPlistStringValue(nextPlist, "CFBundleIconName") !== undefined
      ) {
        throw new Error(`${helperName} root icon keys failed validation`);
      }
      return {
        nextPlist,
        plistPath,
        resources: join(contents, "Resources"),
      };
    })
  );

  for (const plan of plans) {
    await mkdir(plan.resources, { recursive: true });
    await Promise.all(
      STALE_HELPER_ICON_RESOURCES.map((name) =>
        rm(join(plan.resources, name), { force: true })
      )
    );
    await writeFile(join(plan.resources, "icon.icns"), canonicalIcon);
    await writeFile(plan.plistPath, plan.nextPlist, "utf8");
  }

  return {
    helperCount: plans.length,
    iconBytes: canonicalIcon.byteLength,
  };
}

export async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }
  const productName = context.packager.appInfo.productFilename;
  await installMacHelperIcons(join(context.appOutDir, `${productName}.app`), {
    productName,
  });
}

export default afterPack;
