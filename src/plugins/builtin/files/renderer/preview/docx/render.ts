import { renderAsync } from "docx-preview";

export interface RenderedDocx {
  content: HTMLElement;
  styles: HTMLElement;
}

/**
 * Render into detached nodes. The caller commits them only after its
 * cancellation check, so a slow render cannot append stale content (or
 * skip sanitizing) after a revision change.
 */
export async function renderDocxDocument(input: {
  bytes: Uint8Array;
}): Promise<RenderedDocx> {
  const content = document.createElement("div");
  const styles = document.createElement("div");
  await renderAsync(input.bytes, content, styles, {
    breakPages: true,
    className: "pier-docx",
    ignoreHeight: true,
    inWrapper: true,
    renderFooters: true,
    renderHeaders: true,
    useBase64URL: true,
  });
  return { content, styles };
}
