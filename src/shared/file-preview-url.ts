export const FILE_PREVIEW_SCHEME = "pier-file-preview";

export interface FilePreviewLocator {
  path: string;
  revision: string;
  root: string;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function createFilePreviewUrl(locator: FilePreviewLocator): string {
  const url = new URL(`${FILE_PREVIEW_SCHEME}://file`);
  url.searchParams.set("root", encodeBase64Url(locator.root));
  url.searchParams.set("path", encodeBase64Url(locator.path));
  url.searchParams.set("revision", locator.revision);
  return url.toString();
}
