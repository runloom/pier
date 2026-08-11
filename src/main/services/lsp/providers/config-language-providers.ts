import type { LspServerProvider } from "@shared/contracts/lsp-provider.ts";
import { normalizeFsRoot, resolveRootByMarkers } from "../resolve-root.ts";
import {
  resolveTypescriptSdkLibForVue,
  resolveVueTypescriptPluginLocation,
} from "../resolve-typescript-sdk.ts";
import { createPathLspProvider } from "./create-path-provider.ts";
import {
  resolveBundledTypescriptLanguageServer,
  resolveUnpackedAsarPath,
} from "./typescript-provider.ts";

const PACKAGE_ROOT_MARKERS = ["package.json"] as const;
const WORKSPACE_ROOT_MARKERS = [
  "package.json",
  ".git",
  "pnpm-workspace.yaml",
] as const;

export function createJsonLspProvider(): LspServerProvider {
  return createPathLspProvider({
    args: ["--stdio"],
    command: "vscode-json-language-server",
    displayName: "JSON",
    extensions: [".json", ".jsonc"],
    id: "json",
    installCommand: "npm i -g vscode-langservers-extracted",
    languageIdByExtension: {
      ".json": "json",
      ".jsonc": "jsonc",
    },
    languageIds: ["json", "jsonc"],
    priority: 80,
    rootMarkers: [...PACKAGE_ROOT_MARKERS],
    source: "core",
  });
}

export function createCssLspProvider(): LspServerProvider {
  return createPathLspProvider({
    args: ["--stdio"],
    command: "vscode-css-language-server",
    displayName: "CSS / SCSS",
    extensions: [".css", ".scss"],
    id: "css",
    installCommand: "npm i -g vscode-langservers-extracted",
    languageIdByExtension: {
      ".css": "css",
      ".scss": "scss",
    },
    languageIds: ["css", "scss"],
    priority: 80,
    rootMarkers: [...PACKAGE_ROOT_MARKERS],
    source: "core",
  });
}

export function createHtmlLspProvider(): LspServerProvider {
  return createPathLspProvider({
    args: ["--stdio"],
    command: "vscode-html-language-server",
    displayName: "HTML",
    extensions: [".html", ".htm"],
    id: "html",
    installCommand: "npm i -g vscode-langservers-extracted",
    languageIds: ["html"],
    priority: 80,
    rootMarkers: [...PACKAGE_ROOT_MARKERS],
    source: "core",
  });
}

export function createYamlLspProvider(): LspServerProvider {
  return createPathLspProvider({
    args: ["--stdio"],
    command: "yaml-language-server",
    displayName: "YAML",
    extensions: [".yaml", ".yml"],
    id: "yaml",
    installCommand: "npm i -g yaml-language-server",
    languageIds: ["yaml"],
    priority: 80,
    rootMarkers: [...WORKSPACE_ROOT_MARKERS],
    source: "core",
  });
}

/**
 * Marksman: `marksman server` for LSP over stdio.
 * @see https://github.com/artempyanykh/marksman
 */
export function createMarkdownLspProvider(): LspServerProvider {
  return createPathLspProvider({
    args: ["server"],
    command: "marksman",
    displayName: "Markdown",
    extensions: [".md", ".mdx"],
    id: "markdown",
    installCommand: "brew install marksman",
    languageIdByExtension: {
      ".md": "markdown",
      ".mdx": "mdx",
    },
    languageIds: ["markdown", "mdx"],
    priority: 80,
    rootMarkers: [...WORKSPACE_ROOT_MARKERS],
    source: "core",
  });
}

/**
 * Vue language service for go-to-definition / hover in `<script>` and imports.
 *
 * Vue Language Server 3 is hybrid-only (needs client-side `tsserver/request`
 * bridging). Pier's single-session host does not implement that bridge yet.
 * Instead we run the **bundled** typescript-language-server with
 * `@vue/typescript-plugin` (discovered from the workspace or a global
 * `vue-language-server` install) and inject plugin `initializationOptions`
 * at initialize time.
 *
 * Falls back to PATH `vue-language-server --stdio --tsdk=` when the plugin
 * cannot be resolved (process stays up; definition quality is limited).
 *
 * @see https://github.com/vuejs/language-tools
 */
export function createVueLspProvider(): LspServerProvider {
  const pathFallback = createPathLspProvider({
    args: ["--stdio"],
    command: "vue-language-server",
    displayName: "Vue",
    extensions: [".vue"],
    id: "vue",
    installCommand: "npm i -g @vue/language-server",
    languageIds: ["vue"],
    priority: 90,
    rootMarkers: [...PACKAGE_ROOT_MARKERS],
    source: "core",
  });

  return {
    displayName: "Vue",
    id: "vue",
    installCommand: "npm i -g @vue/language-server",
    priority: 90,
    rootMarkers: [...PACKAGE_ROOT_MARKERS],
    source: "core",
    selector: {
      extensions: [".vue"],
      languageIds: ["vue"],
    },
    languageIdForPath(path) {
      return pathFallback.languageIdForPath(path);
    },
    matchPath(path) {
      return pathFallback.matchPath(path);
    },
    resolveRoot(input) {
      return resolveRootByMarkers({
        fallbackWorkspaceRoot: input.fallbackWorkspaceRoot,
        filePath: input.filePath,
        markers: PACKAGE_ROOT_MARKERS,
      });
    },
    resolveLaunch({ rootPath }) {
      const pluginLocation = resolveVueTypescriptPluginLocation(rootPath);
      const bundled = resolveBundledTypescriptLanguageServer();
      if (pluginLocation && bundled) {
        return {
          args: bundled.args,
          command: bundled.command,
          cwd: normalizeFsRoot(rootPath),
          env: { ELECTRON_RUN_AS_NODE: "1" },
          initializationOptions: {
            plugins: [
              {
                languages: ["vue"],
                location: resolveUnpackedAsarPath(pluginLocation),
                name: "@vue/typescript-plugin",
              },
            ],
          },
        };
      }

      // Fallback: bare Vue LS (no hybrid bridge) + compatible tsdk.
      const launch = pathFallback.resolveLaunch({
        rootPath,
        workspaceKey: "vue-fallback",
      });
      if (!launch) {
        return null;
      }
      const tsdk = resolveTypescriptSdkLibForVue(rootPath);
      if (!tsdk) {
        return launch;
      }
      return {
        ...launch,
        args: [...launch.args, `--tsdk=${tsdk}`],
      };
    },
  };
}

/**
 * Svelte language server (`svelte-language-server`).
 * Binary: `svelteserver --stdio`
 * @see https://github.com/sveltejs/language-tools
 */
export function createSvelteLspProvider(): LspServerProvider {
  return createPathLspProvider({
    args: ["--stdio"],
    command: "svelteserver",
    commandCandidates: ["svelteserver", "svelte-language-server"],
    displayName: "Svelte",
    extensions: [".svelte"],
    id: "svelte",
    installCommand: "npm i -g svelte-language-server",
    languageIds: ["svelte"],
    priority: 90,
    rootMarkers: [...PACKAGE_ROOT_MARKERS],
    source: "core",
  });
}

export function createConfigLanguageLspProviders(): LspServerProvider[] {
  return [
    createJsonLspProvider(),
    createCssLspProvider(),
    createHtmlLspProvider(),
    createYamlLspProvider(),
    createMarkdownLspProvider(),
    createVueLspProvider(),
    createSvelteLspProvider(),
  ];
}
