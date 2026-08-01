import type { Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import { canonicalFilesLspHttpsUrl } from "./html-sanitizer.ts";

type GetOpenExternal = () => (url: string) => void;

class FilesLspDocumentationLinks {
  readonly #getOpenExternal: GetOpenExternal;
  readonly #view: EditorView;

  readonly #handleClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const anchor = target.closest("a");
    if (!anchor) {
      return;
    }
    const documentation = anchor.closest(".cm-lsp-documentation");
    if (!(documentation && this.#view.dom.contains(documentation))) {
      return;
    }

    event.preventDefault();
    const url = canonicalFilesLspHttpsUrl(anchor.getAttribute("href") ?? "");
    if (url !== null) {
      this.#getOpenExternal()(url);
    }
  };

  constructor(view: EditorView, getOpenExternal: GetOpenExternal) {
    this.#getOpenExternal = getOpenExternal;
    this.#view = view;
    view.dom.addEventListener("click", this.#handleClick);
  }

  destroy(): void {
    this.#view.dom.removeEventListener("click", this.#handleClick);
  }
}

export function filesLspDocumentationLinksExtension(
  getOpenExternal: GetOpenExternal
): Extension {
  return ViewPlugin.define(
    (view) => new FilesLspDocumentationLinks(view, getOpenExternal)
  );
}
