export type SvgOpenMode = "preview" | "source";

export const SVG_OPEN_MODE_KEY = "pier.files.svg.openMode";

function preferenceStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readSvgOpenMode(): SvgOpenMode {
  return preferenceStorage()?.getItem(SVG_OPEN_MODE_KEY) === "preview"
    ? "preview"
    : "source";
}

export function writeSvgOpenMode(mode: SvgOpenMode): void {
  preferenceStorage()?.setItem(SVG_OPEN_MODE_KEY, mode);
}
