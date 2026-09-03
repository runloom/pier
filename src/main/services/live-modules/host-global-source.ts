/**
 * Reader for host singletons. Realm `globalThis` is the iframe; fall back to
 * `parent`. Cross-origin `parent` access is swallowed.
 */
export const LIVE_MODULE_HOST_GLOBAL_READER_NAME = "__pierLiveHostGlobal";

export function liveModuleHostGlobalReaderSource(): string {
  return [
    `function ${LIVE_MODULE_HOST_GLOBAL_READER_NAME}(name) {`,
    "  const own = globalThis[name];",
    "  if (own != null) return own;",
    "  try {",
    "    const parent = globalThis.parent;",
    "    if (parent && parent !== globalThis) return parent[name];",
    "  } catch {",
    "    // Cross-origin parent: not a Pier realm.",
    "  }",
    "  return undefined;",
    "}",
  ].join("\n");
}

/** Expression reading `name` via the reader (reader must be in scope). */
export function liveModuleHostGlobalExpression(name: string): string {
  return `${LIVE_MODULE_HOST_GLOBAL_READER_NAME}(${JSON.stringify(name)})`;
}
