import type { PierDiffViewItem } from "./items.ts";

/**
 * The worker-timeout fallback renders diffs inline on the renderer main
 * thread. That is safe for a single small file and catastrophic for a large
 * review: one `git add` of hundreds of files can queue enough diffs that the
 * worker watchdog fires, and the inline retry then blocks input/heartbeats
 * long enough for Electron to declare the renderer unresponsive.
 *
 * Keep the inline fallback for small views only. Large views stay on the
 * worker or surface a retry; they must never be moved onto the main thread.
 */
export const INLINE_FALLBACK_MAX_ITEMS = 16;
export const INLINE_FALLBACK_MAX_PATCH_BYTES = 256 * 1024;

export function allowInlineDiffFallback(
  items: readonly PierDiffViewItem[]
): boolean {
  if (items.length > INLINE_FALLBACK_MAX_ITEMS) {
    return false;
  }
  let patchBytes = 0;
  for (const item of items) {
    patchBytes += item.patch?.length ?? 0;
    if (patchBytes > INLINE_FALLBACK_MAX_PATCH_BYTES) {
      return false;
    }
  }
  return true;
}
