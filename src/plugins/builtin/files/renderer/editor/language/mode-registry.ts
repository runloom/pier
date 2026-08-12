/**
 * Runtime registry for plugin / L1 editor language modes (display track).
 * L0 builtin extension maps stay in language-detection.ts and always win first.
 */

import type { EditorHighlightPreset } from "@shared/contracts/plugin/language-mode.ts";

export type EditorLanguageModeSource = "custom" | "plugin";

export interface EditorLanguageModeEntry {
  displayName: string;
  extensions: readonly string[];
  highlight: EditorHighlightPreset;
  /** Editor / LSP language id (e.g. zig, csharp). */
  languageId: string;
  priority: number;
  source: EditorLanguageModeSource;
  /** Contribution key for diagnostics (pluginId:modeId or custom:id). */
  sourceId: string;
}

function normalizeExt(ext: string): string {
  const trimmed = ext.trim().toLowerCase();
  if (trimmed.length === 0) {
    return "";
  }
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function extensionKeyFromPath(path: string): string {
  const base = path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "";
  const lowered = base.toLowerCase();
  const dot = lowered.lastIndexOf(".");
  if (dot <= 0 || dot === lowered.length - 1) {
    return "";
  }
  return lowered.slice(dot);
}

class EditorLanguageModeRegistryImpl {
  #pluginModes: EditorLanguageModeEntry[] = [];
  #customModes: EditorLanguageModeEntry[] = [];
  #byExtension = new Map<string, EditorLanguageModeEntry>();
  #byLanguageId = new Map<string, EditorLanguageModeEntry>();
  readonly #listeners = new Set<() => void>();

  replacePluginModes(modes: readonly EditorLanguageModeEntry[]): void {
    this.#pluginModes = [...modes];
    this.#rebuild();
  }

  replaceCustomModes(modes: readonly EditorLanguageModeEntry[]): void {
    this.#customModes = [...modes];
    this.#rebuild();
  }

  clear(): void {
    this.#pluginModes = [];
    this.#customModes = [];
    this.#rebuild();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  languageIdForPath(path: string): string | null {
    const ext = extensionKeyFromPath(path);
    if (!ext) {
      return null;
    }
    return this.#byExtension.get(ext)?.languageId ?? null;
  }

  modeForLanguageId(languageId: string): EditorLanguageModeEntry | null {
    return this.#byLanguageId.get(languageId) ?? null;
  }

  labelForLanguageId(languageId: string): string | null {
    return this.#byLanguageId.get(languageId)?.displayName ?? null;
  }

  highlightForLanguageId(languageId: string): EditorHighlightPreset | null {
    return this.#byLanguageId.get(languageId)?.highlight ?? null;
  }

  list(): readonly EditorLanguageModeEntry[] {
    return [...this.#pluginModes, ...this.#customModes];
  }

  #rebuild(): void {
    const byExt = new Map<string, EditorLanguageModeEntry>();
    const byId = new Map<string, EditorLanguageModeEntry>();
    // Lower priority first so higher overwrites.
    const ordered = [...this.#pluginModes, ...this.#customModes].sort(
      (left, right) => left.priority - right.priority
    );
    for (const mode of ordered) {
      byId.set(mode.languageId, mode);
      for (const raw of mode.extensions) {
        const ext = normalizeExt(raw);
        if (!ext) {
          continue;
        }
        byExt.set(ext, mode);
      }
    }
    this.#byExtension = byExt;
    this.#byLanguageId = byId;
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

export const editorLanguageModeRegistry = new EditorLanguageModeRegistryImpl();
