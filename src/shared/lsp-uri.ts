/**
 * file:// URI helpers and LSP language ids for Pier's editor integration.
 * Keep path encoding rules here so main host and renderer client stay aligned.
 */

const JS_TS_LANGUAGE_BY_EXT: Readonly<Record<string, string>> = {
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".cjs": "javascript",
  ".mjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".cts": "typescript",
  ".mts": "typescript",
};

export function fileUriFromAbsolutePath(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, "/");
  // Absolute POSIX path → file:///… ; Windows drive paths kept as file:///C:/…
  const withLeading =
    normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)
      ? normalized
      : `/${normalized}`;
  const pathForUri = withLeading.startsWith("/")
    ? withLeading
    : `/${withLeading}`;
  return `file://${pathForUri
    .split("/")
    .map((segment, index) => {
      if (index === 0) {
        return "";
      }
      // Keep drive letter colon unescaped on Windows segments like "C:".
      if (/^[A-Za-z]:$/.test(segment)) {
        return segment;
      }
      return encodeURIComponent(segment).replace(/%2F/gi, "/");
    })
    .join("/")}`;
}

export function absolutePathFromFileUri(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "file:") {
      return null;
    }
    let pathname = decodeURIComponent(parsed.pathname);
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname.length > 0 ? pathname : null;
  } catch {
    return null;
  }
}

export function lspLanguageIdForPath(path: string): string | null {
  const base = path.replace(/\\/g, "/");
  const slash = base.lastIndexOf("/");
  const name = slash >= 0 ? base.slice(slash + 1) : base;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  const ext = name.slice(dot).toLowerCase();
  return JS_TS_LANGUAGE_BY_EXT[ext] ?? null;
}

export function isLspSupportedPath(path: string): boolean {
  return lspLanguageIdForPath(path) !== null;
}
