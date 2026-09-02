import { isUnresolvedConflictCacheKey } from "./file-diff.ts";

export function syncUnresolvedConflictHost(
  element: Element,
  cacheKey: string | undefined
): void {
  if (!isUnresolvedConflictCacheKey(cacheKey)) {
    element.removeAttribute("data-pier-unresolved-conflict");
    return;
  }
  element.setAttribute("data-pier-unresolved-conflict", "");
}

export function clearUnresolvedConflictHost(element: Element): void {
  element.removeAttribute("data-pier-unresolved-conflict");
}
