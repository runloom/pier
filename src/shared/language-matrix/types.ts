/**
 * L0 language matrix — single source of truth for editor identity + PATH LSP.
 * Special non-PATH factories (bundled TypeScript, Vue hybrid) stay outside.
 */

import type { LspProviderDescriptor } from "@shared/contracts/lsp-provider.ts";

export interface LanguageMatrixLspSpec {
  readonly args?: readonly string[];
  readonly binaryHint: string;
  readonly command: string;
  readonly commandCandidates?: readonly string[];
  readonly displayName: string;
  /** When omitted, uses the row's editor extensions. */
  readonly extensions?: readonly string[];
  readonly id: string;
  readonly injectTypescriptSdk?: boolean;
  readonly installCommand?: string;
  readonly languageIdByExtension?: Readonly<Record<string, string>>;
  readonly languageIds: readonly string[];
  readonly launchCandidates?: ReadonlyArray<{
    readonly args?: readonly string[];
    readonly command: string;
  }>;
  /**
   * When any `markers` file/dir exists at the language-server root, PATH
   * launchCandidates whose `command` is listed here are tried first.
   * Dart/FVM: prefer `fvm` over a global `dart` when `.fvmrc` is present.
   */
  readonly preferLaunchCommandsWhenMarkers?: {
    readonly commands: readonly string[];
    readonly markers: readonly string[];
  };
  readonly priority: number;
  readonly rootMarkers: readonly string[];
  /**
   * Binaries resolved against the language-server root (not PATH). Tried
   * before PATH launchCandidates so a project-local SDK (e.g. FVM) wins.
   * `command` is a relative path; `..` segments are rejected.
   */
  readonly workspaceRelativeCommands?: ReadonlyArray<{
    readonly args?: readonly string[];
    readonly command: string;
  }>;
}

/**
 * One matrix row: editor track always; PATH LSP optional (display-only languages).
 */
export interface LanguageMatrixRow {
  /**
   * Basename matchers (case-insensitive), e.g. `dockerfile`, `dockerfile.*`.
   */
  readonly basenameMatchers?: readonly string[];
  /**
   * Files badge / highlight language id (e.g. `cpp`, `zig`).
   * Omit only for LSP-only rows (none today).
   */
  readonly editorLanguageId?: string;
  /**
   * Extensions with leading `.` (lowercased at consume time for maps).
   */
  readonly extensions: readonly string[];
  /** Stable product key (usually equals editorLanguageId or primary language). */
  readonly id: string;
  readonly lsp?: LanguageMatrixLspSpec;
}

export type PathLspDescriptor = LspProviderDescriptor & {
  readonly binaryHint: string;
};
