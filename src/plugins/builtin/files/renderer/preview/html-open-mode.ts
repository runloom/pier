export type HtmlOpenMode = "preview" | "source";

export const HTML_OPEN_MODE_KEY = "pier.files.html.openMode";

function preferenceStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readHtmlOpenMode(): HtmlOpenMode {
  return preferenceStorage()?.getItem(HTML_OPEN_MODE_KEY) === "preview"
    ? "preview"
    : "source";
}

export function writeHtmlOpenMode(mode: HtmlOpenMode): void {
  preferenceStorage()?.setItem(HTML_OPEN_MODE_KEY, mode);
}
