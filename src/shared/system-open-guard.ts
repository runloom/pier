/**
 * Paths that must not be handed to the OS default app from Pier product flows.
 *
 * On macOS, Launch Services often maps `.ts` to MPEG-2 transport stream
 * (QuickTime / video players) rather than TypeScript editors. Terminal path
 * clicks and similar host fallbacks should open these in Pier Files instead.
 *
 * Matching is last-segment based: either a known extension, a known extensionless
 * basename (Dockerfile), or a known dotfile (.env / .gitignore).
 */

/** Filename extensions (without leading dot), matched case-insensitively. */
const PIER_PREFERRED_EXTENSIONS = new Set([
  // TypeScript / JavaScript (`.ts` is the critical macOS MPEG-TS collision)
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  // Common text / config edited in Pier
  "json",
  "jsonc",
  "md",
  "mdx",
  "txt",
  "css",
  "scss",
  "sass",
  "less",
  "html",
  "htm",
  "xml",
  "yml",
  "yaml",
  "toml",
  "ini",
  "env",
  "sh",
  "bash",
  "zsh",
  "fish",
  "rs",
  "go",
  "py",
  "rb",
  "php",
  "java",
  "kt",
  "swift",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "m",
  "mm",
  "cs",
  "fs",
  "vue",
  "svelte",
  "astro",
  "sql",
  "graphql",
  "gql",
  "styl",
  "tf",
  "tfvars",
  "hcl",
  "svg",
  "lock",
]);

/**
 * Extensionless basenames (and multi-dot names that are not “.ext” style).
 * Matched case-insensitively on the full leaf name.
 */
const PIER_PREFERRED_BASENAMES = new Set([
  "dockerfile",
  "makefile",
  "gnumakefile",
  "cmakelists.txt",
  "go.mod",
  "go.sum",
  "cargo.toml",
  "cargo.lock",
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "readme",
  "readme.md",
  "license",
  "licence",
  "changelog",
  "authors",
  "contributors",
]);

function basenameOf(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

/**
 * True when product code must not call `shell.openPath` / `files.openPath`
 * for this path as an automatic fallback (prefer Pier editor / fail toast).
 */
export function shouldNeverSystemOpen(path: string): boolean {
  const base = basenameOf(path.trim()).toLowerCase();
  if (!base || base === "." || base === "..") {
    return false;
  }
  if (PIER_PREFERRED_BASENAMES.has(base)) {
    return true;
  }
  // Dotfiles like `.env` / `.gitignore` (single leading dot, no further dots)
  if (base.startsWith(".") && !base.includes(".", 1)) {
    const name = base.slice(1);
    return (
      PIER_PREFERRED_EXTENSIONS.has(name) ||
      name === "gitignore" ||
      name === "gitattributes" ||
      name === "editorconfig" ||
      name === "prettierrc" ||
      name === "eslintrc" ||
      name === "npmrc" ||
      name === "nvmrc"
    );
  }
  // Multi-dot names like `.eslintrc.json` — treat trailing segment as extension
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return false;
  }
  const ext = base.slice(dot + 1);
  return PIER_PREFERRED_EXTENSIONS.has(ext);
}

/** Parent dir + leaf for `openFilesDiskPath` / files disk source. */
export function splitAbsoluteDiskTarget(absolutePath: string): {
  path: string;
  root: string;
} {
  const normalized =
    absolutePath.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  if (normalized === "/") {
    return { path: "", root: "/" };
  }
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return { path: normalized.slice(1), root: "/" };
  }
  return {
    path: normalized.slice(slash + 1),
    root: normalized.slice(0, slash),
  };
}
