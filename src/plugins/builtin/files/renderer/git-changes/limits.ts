export const FILE_CHANGES_AUTO_BYTES = 2 * 1024 * 1024;
export const FILE_CHANGES_MAX_BYTES = 10 * 1024 * 1024;
export const FILE_CHANGES_AUTO_LINES = 50_000;
export const FILE_CHANGES_DEBOUNCE_MS = 150;
export function comparisonSize(
  contents: string
): "auto" | "on-demand" | "unavailable" {
  if (contents.length > FILE_CHANGES_MAX_BYTES) return "unavailable";
  const bytes = new TextEncoder().encode(contents).byteLength;
  if (bytes > FILE_CHANGES_MAX_BYTES) return "unavailable";
  if (bytes > FILE_CHANGES_AUTO_BYTES) return "on-demand";
  let lines = 1;
  for (let i = 0; i < contents.length; i++) {
    if (contents.charCodeAt(i) === 10 && ++lines > FILE_CHANGES_AUTO_LINES)
      return "on-demand";
  }
  return "auto";
}
