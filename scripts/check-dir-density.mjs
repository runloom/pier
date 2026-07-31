#!/usr/bin/env node
/**
 * Pier directory density gate (pairs with scripts/check-file-size.sh).
 *
 * Rules:
 *   - Count direct source files per directory under src/, packages star/src, tests/
 *   - Fail when count exceeds hard cap (see .pier/dir-density.json)
 *   - Resource/asset dirs use skipDirPatterns (not counted)
 *   - allowlist is debt-only: max is a ratchet (count must not exceed max);
 *     remove or lower the entry after a split lands under the hard cap
 *
 * Usage: node scripts/check-dir-density.mjs
 *        node scripts/check-dir-density.mjs --json
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(ROOT, ".pier", "dir-density.json");

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/** @typedef {{ maxDirectSourceFiles: number, softCap: number, scanRoots: string[], skipDirPatterns: string[], allowlist: Record<string, { max: number, reason: string }> }} DirDensityConfig */

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`missing config: ${relative(ROOT, CONFIG_PATH)}`);
  }
  /** @type {DirDensityConfig} */
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  if (
    typeof config.maxDirectSourceFiles !== "number" ||
    config.maxDirectSourceFiles < 1
  ) {
    throw new Error(
      "dir-density.json: maxDirectSourceFiles must be a positive number"
    );
  }
  return config;
}

/**
 * @param {string} posixPath
 * @param {string[]} patterns
 */
function matchesAnyPattern(posixPath, patterns) {
  for (const pattern of patterns) {
    // glob-lite: ** segment, * within segment, exact prefix/suffix
    const re = patternToRegExp(pattern);
    if (re.test(posixPath)) {
      return true;
    }
  }
  return false;
}

/** @param {string} pattern */
function patternToRegExp(pattern) {
  let i = 0;
  let out = "^";
  while (i < pattern.length) {
    if (pattern.startsWith("**/", i)) {
      out += "(?:.*/)?";
      i += 3;
      continue;
    }
    if (pattern.startsWith("**", i)) {
      out += ".*";
      i += 2;
      continue;
    }
    const ch = pattern[i];
    if (ch === "*") {
      out += "[^/]*";
      i += 1;
      continue;
    }
    if ("\\.[]{}()+-^$|".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
    i += 1;
  }
  out += "$";
  return new RegExp(out);
}

/**
 * @param {string} absDir
 * @returns {string[]}
 */
function listDirectSourceFiles(absDir) {
  const names = readdirSync(absDir);
  const files = [];
  for (const name of names) {
    if (name.startsWith(".")) {
      continue;
    }
    const abs = join(absDir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) {
      continue;
    }
    if (name.endsWith(".d.ts")) {
      continue;
    }
    const dot = name.lastIndexOf(".");
    if (dot < 0) {
      continue;
    }
    const ext = name.slice(dot).toLowerCase();
    if (!SOURCE_EXTS.has(ext)) {
      continue;
    }
    files.push(name);
  }
  return files;
}

/**
 * @param {string} absRoot
 * @param {string[]} skipPatterns
 * @param {{ path: string, count: number, files: string[] }[]} out
 */
function walk(absRoot, skipPatterns, out) {
  /** @type {string[]} */
  const stack = [absRoot];
  while (stack.length > 0) {
    const absDir = stack.pop();
    if (!absDir) {
      continue;
    }
    const rel = relative(ROOT, absDir).split(sep).join("/");
    if (rel && matchesAnyPattern(rel, skipPatterns)) {
      continue;
    }

    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      continue;
    }

    const files = listDirectSourceFiles(absDir);
    // Only report dirs that exist under scan roots (including empty of source is ok to skip)
    if (files.length > 0) {
      out.push({ path: rel || ".", count: files.length, files });
    }

    for (const ent of entries) {
      if (!ent.isDirectory()) {
        continue;
      }
      if (ent.name.startsWith(".")) {
        continue;
      }
      if (
        ent.name === "node_modules" ||
        ent.name === "dist" ||
        ent.name === "dist-package" ||
        ent.name === "dist-pkg" ||
        ent.name === "out" ||
        ent.name === "coverage"
      ) {
        continue;
      }
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (matchesAnyPattern(childRel, skipPatterns)) {
        continue;
      }
      stack.push(join(absDir, ent.name));
    }
  }
}

/**
 * @param {DirDensityConfig} config
 */
function collect(config) {
  /** @type {{ path: string, count: number, files: string[] }[]} */
  const dirs = [];
  for (const rootSpec of config.scanRoots) {
    if (rootSpec.includes("*")) {
      // e.g. packages/*/src
      const [prefix, rest] = rootSpec.split("/*/");
      const base = join(ROOT, prefix);
      if (!existsSync(base)) {
        continue;
      }
      for (const ent of readdirSync(base, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.name.startsWith(".")) {
          continue;
        }
        const candidate = join(base, ent.name, rest);
        if (existsSync(candidate)) {
          walk(candidate, config.skipDirPatterns, dirs);
        }
      }
      continue;
    }
    const abs = join(ROOT, rootSpec);
    if (!existsSync(abs)) {
      continue;
    }
    walk(abs, config.skipDirPatterns, dirs);
  }
  // de-dupe by path (packages/*/src may overlap if listed twice)
  const byPath = new Map();
  for (const d of dirs) {
    byPath.set(d.path, d);
  }
  return [...byPath.values()].sort(
    (a, b) => b.count - a.count || a.path.localeCompare(b.path)
  );
}

function main() {
  const wantJson = process.argv.includes("--json");
  const config = loadConfig();
  const hard = config.maxDirectSourceFiles;
  const soft = config.softCap ?? Math.min(25, hard);
  const allowlist = config.allowlist ?? {};
  const dirs = collect(config);

  /** @type {{ path: string, count: number, max: number, kind: 'hard' | 'allowlist' | 'soft', reason?: string }[]} */
  const rejects = [];
  /** @type {{ path: string, count: number }[]} */
  const warns = [];
  /** @type {string[]} */
  const staleAllowlist = [];

  for (const [path, entry] of Object.entries(allowlist)) {
    const found = dirs.find((d) => d.path === path);
    if (!found) {
      staleAllowlist.push(path);
      continue;
    }
    if (found.count > entry.max) {
      rejects.push({
        path,
        count: found.count,
        max: entry.max,
        kind: "allowlist",
        reason: entry.reason,
      });
    } else if (found.count <= hard) {
      // debt paid under hard cap — allowlist entry should be removed
      staleAllowlist.push(path);
    }
  }

  for (const d of dirs) {
    const allowed = allowlist[d.path];
    if (allowed) {
      // already handled above for reject; soft-warn if still large
      if (d.count > soft) {
        warns.push({ path: d.path, count: d.count });
      }
      continue;
    }
    if (d.count > hard) {
      rejects.push({
        path: d.path,
        count: d.count,
        max: hard,
        kind: "hard",
      });
    } else if (d.count > soft) {
      warns.push({ path: d.path, count: d.count });
    }
  }

  if (wantJson) {
    console.log(
      JSON.stringify(
        {
          hard,
          soft,
          rejects,
          warns,
          staleAllowlist,
          top: dirs.slice(0, 40).map((d) => ({ path: d.path, count: d.count })),
        },
        null,
        2
      )
    );
  } else {
    if (warns.length > 0) {
      console.log(`⚠ directory density soft cap (${soft}):`);
      for (const w of warns.sort((a, b) => b.count - a.count)) {
        const tag = allowlist[w.path] ? " [allowlisted]" : "";
        console.log(`  ⚠ ${w.path}: ${w.count} files${tag}`);
      }
      console.log("");
    }

    if (staleAllowlist.length > 0 && rejects.length === 0) {
      // report stale only as info when green; still fail if rejects empty? No — fail on stale so allowlist stays tight
    }

    if (rejects.length > 0) {
      console.log(
        `✗ directory density (hard cap ${hard}; allowlist ratchet — see .pier/dir-density.json):`
      );
      for (const r of rejects.sort((a, b) => b.count - a.count)) {
        if (r.kind === "allowlist") {
          console.log(
            `  ✗ ${r.path}: ${r.count} files (allowlist max ${r.max}${r.reason ? `; ${r.reason}` : ""})`
          );
        } else {
          console.log(`  ✗ ${r.path}: ${r.count} files (hard cap ${hard})`);
        }
      }
      console.log("");
      console.log("拆分建议:");
      console.log(
        "  - 按领域/功能分子目录（feature folder），不要按技术层无限堆 hooks/utils"
      );
      console.log(
        "  - 资源目录（favicons、locales、fixtures）加入 skipDirPatterns"
      );
      console.log("  - 过渡债写 allowlist.max 棘轮，修完删除条目");
      console.log("  - 详 AGENTS.md「目录密度门禁」");
      process.exitCode = 1;
    }

    if (staleAllowlist.length > 0) {
      console.log(
        "✗ stale dir-density allowlist entries (remove or path missing):"
      );
      for (const p of staleAllowlist) {
        const found = dirs.find((d) => d.path === p);
        if (found) {
          console.log(
            `  ✗ ${p}: count ${found.count} ≤ hard ${hard} — delete allowlist entry`
          );
        } else {
          console.log(`  ✗ ${p}: path missing or empty of source files`);
        }
      }
      process.exitCode = 1;
    }

    if (!process.exitCode) {
      console.log(
        `✓ directory density check pass (soft ${soft} / hard ${hard}; allowlist ${Object.keys(allowlist).length})`
      );
    }
  }

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main();
