#!/usr/bin/env node
/**
 * Move source files into domain subfolders and rewrite imports repo-wide.
 *
 * Dry-run: node scripts/reorg-source-dir-density.mjs
 * Apply:   node scripts/reorg-source-dir-density.mjs --apply
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

/**
 * Each rule: files matching `match` (basename regex) under `fromDir` move into
 * `fromDir/toSubdir/`. Files already under a subdirectory are ignored.
 *
 * @type {{ fromDir: string, toSubdir: string, match: RegExp, exclude?: RegExp }[]}
 */
const MOVES = [
  // main ipc — terminal cluster
  {
    fromDir: "src/main/ipc",
    toSubdir: "terminal",
    match: /^terminal/,
  },
  // main services root — git helpers (not the git-review/ package)
  {
    fromDir: "src/main/services",
    toSubdir: "git",
    match: /^git-/,
  },
  {
    fromDir: "src/main/services",
    toSubdir: "git",
    match: /^worktree-/,
  },
  {
    fromDir: "src/main/services",
    toSubdir: "files",
    match: /^file-/,
  },
  // git plugin renderer — review surface
  {
    fromDir: "src/plugins/builtin/git/renderer",
    toSubdir: "review",
    match: /^git-review-/,
  },
  {
    fromDir: "src/plugins/builtin/git/renderer",
    toSubdir: "hooks",
    match: /^use-git-/,
  },
  {
    fromDir: "src/plugins/builtin/git/renderer",
    toSubdir: "worktree",
    match: /^worktree-/,
  },
  // files plugin renderer
  {
    fromDir: "src/plugins/builtin/files/renderer",
    toSubdir: "editor",
    match: /^(file-editor|code-mirror|cm-)/,
  },
  {
    fromDir: "src/plugins/builtin/files/renderer",
    toSubdir: "tree",
    match: /^(file-tree|files-tree)/,
  },
  {
    fromDir: "src/plugins/builtin/files/renderer",
    toSubdir: "document",
    match: /^(file-document|files-document|files-draft)/,
  },
  {
    fromDir: "src/plugins/builtin/files/renderer",
    toSubdir: "panel",
    match: /^(file-panel|files-panel|files-group)/,
  },
  {
    fromDir: "src/plugins/builtin/files/renderer",
    toSubdir: "search",
    match: /^files-content-search/,
  },
  {
    fromDir: "src/plugins/builtin/files/renderer",
    toSubdir: "markdown",
    match: /^markdown-/,
  },
  // packages/ui — product clusters (keep shadcn primitives flat)
  {
    fromDir: "packages/ui/src",
    toSubdir: "diff-view",
    match: /^(diff-view|use-diff-view)/,
  },
  {
    fromDir: "packages/ui/src",
    toSubdir: "file",
    match: /^file-/,
  },
  // project-skills
  {
    fromDir: "src/main/services/project-skills",
    toSubdir: "apply",
    match: /^apply-/,
  },
  {
    fromDir: "src/main/services/project-skills",
    toSubdir: "repair",
    match: /^repair-/,
  },
  {
    fromDir: "src/main/services/project-skills",
    toSubdir: "import",
    match: /^import-/,
  },
  {
    fromDir: "src/main/services/project-skills",
    toSubdir: "pier-bindings",
    match: /^pier-bindings/,
  },
  {
    fromDir: "src/main/services/project-skills",
    toSubdir: "store",
    match: /^store/,
  },
  {
    fromDir: "src/main/services/project-skills",
    toSubdir: "launch-gate",
    match: /^launch-gate/,
  },
  {
    fromDir: "src/main/services/project-skills",
    toSubdir: "system-skills",
    match: /^system-skill/,
  },
  // renderer lib/plugins
  {
    fromDir: "src/renderer/lib/plugins",
    toSubdir: "host",
    match: /^host-/,
  },
  {
    fromDir: "src/renderer/lib/plugins",
    toSubdir: "lifecycle",
    match: /^plugin-lifecycle/,
  },
  {
    fromDir: "src/renderer/lib/plugins",
    toSubdir: "runtime",
    match: /^runtime/,
  },
  {
    fromDir: "src/renderer/lib/plugins",
    toSubdir: "external",
    match: /^external-/,
  },
  {
    fromDir: "src/renderer/lib/plugins",
    toSubdir: "mermaid",
    match: /^mermaid-/,
  },
  // shared contracts by domain prefix
  {
    fromDir: "src/shared/contracts",
    toSubdir: "terminal",
    match: /^terminal-/,
  },
  {
    fromDir: "src/shared/contracts",
    toSubdir: "file",
    match: /^(file-|files-)/,
  },
  {
    fromDir: "src/shared/contracts",
    toSubdir: "agent",
    match: /^agent-/,
  },
  {
    fromDir: "src/shared/contracts",
    toSubdir: "git",
    match: /^(git-|worktree-)/,
  },
  {
    fromDir: "src/shared/contracts",
    toSubdir: "plugin",
    match: /^(plugin-|managed-plugin)/,
  },
  // terminal panel-kit hooks
  {
    fromDir: "src/renderer/panel-kits/terminal",
    toSubdir: "hooks",
    match: /^use-/,
  },
  // app-core commands
  {
    fromDir: "src/main/app-core",
    toSubdir: "commands",
    match: /-commands\.ts$/,
  },
  // git-review internals
  {
    fromDir: "src/main/services/git-review",
    toSubdir: "index",
    match: /^git-review-index/,
  },
  {
    fromDir: "src/main/services/git-review",
    toSubdir: "document",
    match: /^git-review-document/,
  },
  {
    fromDir: "src/main/services/git-review",
    toSubdir: "path",
    match: /^git-review-path/,
  },
  {
    fromDir: "src/main/services/git-review",
    toSubdir: "scheduler",
    match: /^git-review-scheduler/,
  },
  // integrations
  {
    fromDir: "src/main/services/agents/integrations",
    toSubdir: "evidence",
    match: /^evidence-/,
  },
  {
    fromDir: "src/main/services/agents/integrations",
    toSubdir: "transcript",
    match: /^(transcript-|claude-transcript|codex-transcript|grok-transcript)/,
  },
  {
    fromDir: "src/main/services/agents/integrations",
    toSubdir: "hooks",
    match: /^hook-/,
  },
  // workspace transfer cluster
  {
    fromDir: "src/renderer/components/workspace",
    toSubdir: "transfer",
    match: /^(panel-transfer|workspace-panel-transfer|attach-workspace)/,
  },
  // common shell clusters
  {
    fromDir: "src/renderer/components/common",
    toSubdir: "dialogs",
    match: /^(app-dialog|app-content-dialog|content-dialog|use-content-dialog)/,
  },
  {
    fromDir: "src/renderer/components/common",
    toSubdir: "notifications",
    match: /^notification-/,
  },
  {
    fromDir: "src/renderer/components/common",
    toSubdir: "command-palette",
    match: /^command-palette/,
  },
  {
    fromDir: "src/renderer/components/common",
    toSubdir: "terminal-debug",
    match: /^terminal-debug/,
  },
];

/**
 * @returns {{ from: string, to: string }[]}
 */
function planMoves() {
  /** @type {{ from: string, to: string }[]} */
  const planned = [];
  /** @type {Set<string>} */
  const claimed = new Set();

  for (const rule of MOVES) {
    const dirAbs = join(ROOT, rule.fromDir);
    if (!existsSync(dirAbs)) {
      continue;
    }
    for (const name of readdirSync(dirAbs)) {
      const fromAbs = join(dirAbs, name);
      if (!statSync(fromAbs).isFile()) {
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) || name.endsWith(".d.ts")) {
        continue;
      }
      if (rule.exclude?.test(name)) {
        continue;
      }
      if (!rule.match.test(name)) {
        continue;
      }
      const fromRel = `${rule.fromDir}/${name}`;
      if (claimed.has(fromRel)) {
        continue;
      }
      const toRel = `${rule.fromDir}/${rule.toSubdir}/${name}`;
      claimed.add(fromRel);
      planned.push({ from: fromRel, to: toRel });
    }
  }
  return planned;
}

/**
 * @param {string} content
 * @param {string} fromAbs
 * @param {string} toAbs
 */
function rewriteRelativeImportsInMovedFile(content, fromAbs, toAbs) {
  return content.replace(
    /(from\s+['"])(\.\.[^'"]+|\.\/[^'"]+)(['"])/g,
    (_full, a, spec, c) => {
      const targetAbs = join(dirname(fromAbs), spec);
      let relToNew = relative(dirname(toAbs), targetAbs).split(sep).join("/");
      if (!relToNew.startsWith(".")) {
        relToNew = `./${relToNew}`;
      }
      return `${a}${relToNew}${c}`;
    }
  );
}

/**
 * Map repo-relative path to import alias forms used in this monorepo.
 * @param {string} rel
 * @returns {string[]}
 */
function aliasForms(rel) {
  /** @type {string[]} */
  const forms = [rel];
  const add = (/** @type {string} */ s) => {
    forms.push(s);
  };
  if (rel.startsWith("src/main/")) {
    add(`@main/${rel.slice("src/main/".length)}`);
  }
  if (rel.startsWith("src/shared/")) {
    add(`@shared/${rel.slice("src/shared/".length)}`);
  }
  if (rel.startsWith("src/plugins/")) {
    add(`@plugins/${rel.slice("src/plugins/".length)}`);
  }
  if (rel.startsWith("src/preload/")) {
    add(`@preload/${rel.slice("src/preload/".length)}`);
  }
  if (rel.startsWith("src/renderer/")) {
    add(`@/${rel.slice("src/renderer/".length)}`);
  }
  if (rel.startsWith("packages/ui/src/")) {
    add(`@pier/ui/${rel.slice("packages/ui/src/".length)}`);
  }
  return forms;
}

/**
 * @param {Map<string, string>} fromToRel
 * @returns {Map<string, string>}
 */
function buildReplacementMap(fromToRel) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const [fromRel, toRel] of fromToRel) {
    const fromAliases = aliasForms(fromRel);
    const toAliases = aliasForms(toRel);
    for (let i = 0; i < fromAliases.length; i += 1) {
      map.set(fromAliases[i], toAliases[i] ?? toRel);
    }
  }
  // longest keys first when applying
  return map;
}

/**
 * @param {string} content
 * @param {string} fileAbs
 * @param {Map<string, string>} fromToRel
 * @param {Map<string, string>} replacementMap
 */
function rewriteAllPathRefs(content, fileAbs, fromToRel, replacementMap) {
  let next = content;

  // Apply longer paths first to avoid partial clobber
  const keys = [...replacementMap.keys()].sort((a, b) => b.length - a.length);
  for (const from of keys) {
    const to = replacementMap.get(from);
    if (!(to && next.includes(from))) {
      continue;
    }
    next = next.split(from).join(to);
  }

  // Relative imports that still point at old sibling locations
  next = next.replace(
    /(from\s+['"])(\.\.[^'"]+|\.\/[^'"]+)(['"])/g,
    (full, a, spec, c) => {
      const resolved = normalizeRel(join(dirname(fileAbs), spec));
      const relPosix = relative(ROOT, resolved).split(sep).join("/");
      for (const cand of expandPathCandidates(relPosix)) {
        const dest = fromToRel.get(cand);
        if (dest) {
          const destAbs = join(ROOT, dest);
          let relToNew = relative(dirname(fileAbs), destAbs)
            .split(sep)
            .join("/");
          if (!relToNew.startsWith(".")) {
            relToNew = `./${relToNew}`;
          }
          return `${a}${relToNew}${c}`;
        }
      }
      return full;
    }
  );

  return next;
}

/** @param {string} p */
function normalizeRel(p) {
  // collapse .. without requiring existence
  const parts = p.split(sep);
  /** @type {string[]} */
  const stack = [];
  for (const part of parts) {
    if (part === "..") {
      stack.pop();
    } else if (part !== ".") {
      stack.push(part);
    }
  }
  return stack.join(sep);
}

/** @param {string} p */
function hasExt(p) {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p);
}

/** @param {string} relPosix */
function expandPathCandidates(relPosix) {
  const out = new Set([relPosix]);
  if (!hasExt(relPosix)) {
    for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) {
      out.add(relPosix + ext);
    }
  }
  return out;
}

/**
 * Walk source files that may contain imports.
 * @returns {string[]}
 */
function listRewriteTargets() {
  /** @type {string[]} */
  const files = [];
  const roots = ["src", "packages", "tests", "scripts"];
  const skipDir = new Set([
    "node_modules",
    "dist",
    "dist-package",
    "dist-pkg",
    "out",
    "coverage",
    ".git",
  ]);

  /**
   * @param {string} abs
   */
  function walk(abs) {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) {
        continue;
      }
      const child = join(abs, ent.name);
      if (ent.isDirectory()) {
        if (skipDir.has(ent.name)) {
          continue;
        }
        walk(child);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs|md)$/.test(ent.name)) {
        files.push(child);
      }
    }
  }

  for (const r of roots) {
    const abs = join(ROOT, r);
    if (existsSync(abs)) {
      walk(abs);
    }
  }
  return files;
}

function main() {
  const planned = planMoves();
  console.log(
    `Planned source moves: ${planned.length}${APPLY ? " (APPLY)" : " (dry-run)"}`
  );
  const byDest = new Map();
  for (const m of planned) {
    const key = m.to.split("/").slice(0, -1).join("/");
    byDest.set(key, (byDest.get(key) ?? 0) + 1);
  }
  for (const [b, n] of [...byDest.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${b}/`);
  }

  if (!APPLY) {
    console.log("\nRe-run with --apply to execute.");
    return;
  }

  /** @type {Map<string, string>} */
  const fromTo = new Map(planned.map((m) => [m.from, m.to]));
  const replacementMap = buildReplacementMap(fromTo);

  // 1) Move files (write rewritten content to new path, delete old)
  for (const m of planned) {
    const fromAbs = join(ROOT, m.from);
    const toAbs = join(ROOT, m.to);
    mkdirSync(dirname(toAbs), { recursive: true });
    let content = readFileSync(fromAbs, "utf8");
    content = rewriteRelativeImportsInMovedFile(content, fromAbs, toAbs);
    writeFileSync(toAbs, content);
    unlinkSync(fromAbs);
    console.log(`  mv ${m.from} → ${m.to}`);
  }

  // 2) Repo-wide import rewrite for remaining files (and already-moved files)
  const targets = listRewriteTargets();
  let rewritten = 0;
  for (const abs of targets) {
    const before = readFileSync(abs, "utf8");
    const after = rewriteAllPathRefs(before, abs, fromTo, replacementMap);
    if (after !== before) {
      writeFileSync(abs, after);
      rewritten += 1;
    }
  }
  console.log(`Rewrote imports in ${rewritten} files.`);

  // 3) packages/ui exports for nested feature folders
  patchPierUiPackageExports();

  console.log(
    "Done. Next: node scripts/check-dir-density.mjs && pnpm typecheck"
  );
}

function patchPierUiPackageExports() {
  const pkgPath = join(ROOT, "packages/ui/package.json");
  if (!existsSync(pkgPath)) {
    return;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const exports = pkg.exports ?? {};
  // Nested feature folders (single-segment * does not cross '/').
  exports["./diff-view/*"] = "./src/diff-view/*";
  exports["./file/*"] = "./src/file/*";
  // Keep flat primitive map
  if (!exports["./*"]) {
    exports["./*"] = "./src/*.tsx";
  }
  pkg.exports = exports;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log("Updated packages/ui/package.json exports for nested folders.");
}

main();
