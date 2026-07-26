import { clipboard, type NativeImage } from "electron";

/**
 * Grok (and similar agent TUIs) treat short bracketed pastes as clipboard
 * pastes and probe NSPasteboard for images. Enhanced-input sendText injects
 * via paste, so a leftover screenshot becomes `[Image #N]` after plain text.
 *
 * While a suppress session is open, the system pasteboard is forced text-only
 * (no raster). Nested begin/end is ref-counted so multi-step agent sends
 * (path paste then body) keep the board clean until the outer end.
 */

interface ClipboardSnapshot {
  hadImage: boolean;
  image: NativeImage;
  text: string;
}

let depth = 0;
let snapshot: ClipboardSnapshot | null = null;

export function beginClipboardImageSuppress(): void {
  if (depth === 0) {
    const image = clipboard.readImage();
    snapshot = {
      hadImage: !image.isEmpty(),
      image,
      text: clipboard.readText(),
    };
    // Text-only board: keep prior text so unrelated copy is not wiped to empty
    // when we only need to drop the raster flavor for Grok's probe gate.
    if (snapshot.text.length > 0) {
      clipboard.writeText(snapshot.text);
    } else {
      clipboard.clear();
    }
  }
  depth += 1;
}

export function endClipboardImageSuppress(): void {
  if (depth === 0) {
    return;
  }
  depth -= 1;
  if (depth > 0 || snapshot === null) {
    return;
  }
  const saved = snapshot;
  snapshot = null;
  if (saved.hadImage) {
    clipboard.write({
      image: saved.image,
      text: saved.text,
    });
    return;
  }
  if (saved.text.length > 0) {
    clipboard.writeText(saved.text);
    return;
  }
  clipboard.clear();
}

/** Test helper: reset module state between unit tests. */
export function resetClipboardImageSuppressForTests(): void {
  depth = 0;
  snapshot = null;
}
