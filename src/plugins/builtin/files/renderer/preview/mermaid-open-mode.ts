export type MermaidOpenMode = "preview" | "source";

export const MERMAID_OPEN_MODE_KEY = "pier.files.mermaid.openMode";

function preferenceStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Diagram files are opened as a rendered diagram on first contact; the source
 * toggle is remembered per user afterwards.
 */
export function readMermaidOpenMode(): MermaidOpenMode {
  return preferenceStorage()?.getItem(MERMAID_OPEN_MODE_KEY) === "source"
    ? "source"
    : "preview";
}

export function writeMermaidOpenMode(mode: MermaidOpenMode): void {
  preferenceStorage()?.setItem(MERMAID_OPEN_MODE_KEY, mode);
}
