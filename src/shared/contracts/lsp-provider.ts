/**
 * Language-server provider contract (main-side registry).
 * Launch specs are plain data so SessionHost stays language-agnostic.
 */

export interface LspDocumentSelector {
  extensions: readonly string[];
  languageIds: readonly string[];
}

export interface LspServerLaunchSpec {
  args: readonly string[];
  command: string;
  cwd: string;
  env?: Readonly<Record<string, string>>;
}

export interface LspServerProvider {
  readonly displayName: string;
  readonly id: string;

  /**
   * Map path → LSP languageId for didOpen. null if path is not served.
   */
  languageIdForPath(path: string): string | null;

  matchPath(path: string): boolean;
  readonly priority: number;

  resolveLaunch(input: {
    rootPath: string;
    workspaceKey: string;
  }): LspServerLaunchSpec | null | Promise<LspServerLaunchSpec | null>;

  resolveRoot(input: {
    fallbackWorkspaceRoot: string;
    filePath: string;
  }): string;
  readonly rootMarkers: readonly string[];
  readonly selector: LspDocumentSelector;
}
