import { clipboard, type NativeImage } from "electron";

/**
 * Grok (and similar agent TUIs) treat short bracketed pastes as clipboard
 * pastes and probe NSPasteboard for images. Enhanced-input sendText injects
 * via paste, so a leftover screenshot becomes `[Image #N]` after plain text.
 *
 * While a suppress session is open, the system pasteboard is forced text-only
 * (no raster). Nested begin/end is ref-counted so multi-step agent sends
 * (path paste then body) keep the board clean until the outer end.
 *
 * 恢复纪律（金标准）：剪贴板是全局资源，end 回写快照前必须验证窗口期内
 * 没有其他写入者（用户复制、终端 OSC 52）。begin 后板上是 text-only 快照
 * 文本（或空）；end 时文本变了、或出现了新光栅，说明有人写过 —— 保留新
 * 内容，放弃恢复。已知残留（不可判定）：窗口期内写入与快照完全相同的
 * 文本无法区分（Electron 不暴露 changeCount）——此时仍会还原快照，若快照
 * 带图，等于给同文本剪贴板重新挂回旧截图，且丢弃该次写入的富文本 flavor。
 * 根治需经 native 侧暴露 NSPasteboard.changeCount 作写入者判定（后续项）。
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
  // begin 把板置为 text-only 快照文本；文本变化或新光栅 = 窗口期有其他
  // 写入者，保留新内容。
  const boardChanged =
    clipboard.readText() !== saved.text || !clipboard.readImage().isEmpty();
  if (boardChanged) {
    return;
  }
  if (saved.hadImage) {
    clipboard.write({
      image: saved.image,
      text: saved.text,
    });
  }
  // 无图快照：板上已是快照文本（或空），无需冗余回写。
}

/** Test helper: reset module state between unit tests. */
export function resetClipboardImageSuppressForTests(): void {
  depth = 0;
  snapshot = null;
}
