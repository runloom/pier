import type { Extension } from "@codemirror/state";
import { ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { EditorView } from "codemirror";
import { gitGutterField, resyncGitGutterColors } from "./git-gutter.ts";

/**
 * 主题 class（light/dark）变化时重解析 --diff-*-fg，不重拉 git。
 * 仅当已有 markers 时 dispatch。
 */
export function createGitGutterThemeResyncPlugin(): Extension {
  return ViewPlugin.fromClass(
    class {
      readonly #view: EditorView;
      readonly #observer: MutationObserver;
      #destroyed = false;
      #themeKey: string;

      constructor(view: EditorView) {
        this.#view = view;
        this.#themeKey = readDocumentThemeKey();
        this.#observer = new MutationObserver(() => {
          this.#resyncIfThemeChanged();
        });
        if (typeof document !== "undefined") {
          this.#observer.observe(document.documentElement, {
            attributeFilter: ["class"],
            attributes: true,
          });
        }
      }

      update(_update: ViewUpdate): void {
        this.#resyncIfThemeChanged();
      }

      destroy(): void {
        this.#destroyed = true;
        this.#observer.disconnect();
      }

      #resyncIfThemeChanged(): void {
        const key = readDocumentThemeKey();
        if (key === this.#themeKey) {
          return;
        }
        this.#themeKey = key;
        if (this.#view.state.field(gitGutterField).markers.size === 0) {
          return;
        }
        queueMicrotask(() => {
          if (this.#destroyed) {
            return;
          }
          if (this.#view.state.field(gitGutterField).markers.size === 0) {
            return;
          }
          resyncGitGutterColors(this.#view);
        });
      }
    }
  );
}

function readDocumentThemeKey(): string {
  if (typeof document === "undefined") {
    return "";
  }
  return document.documentElement.className;
}
