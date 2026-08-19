import { isImageDiffCacheKey } from "./file-diff.ts";

export function syncImageDiffHost(
  element: Element,
  cacheKey: string | undefined,
  fileType: string | undefined
): void {
  if (!isImageDiffCacheKey(cacheKey)) {
    element.removeAttribute("data-pier-image-diff");
    return;
  }
  element.setAttribute(
    "data-pier-image-diff",
    fileType === "deleted" ? "deleted" : "compare"
  );
}

export function clearImageDiffHost(element: Element): void {
  element.removeAttribute("data-pier-image-diff");
}
