/**
 * Non-PATH L0 language servers that need custom launch logic.
 * Plain PATH languages live in the shared language matrix.
 */

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
    async resolveLaunch({ rootPath }) {
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

      const launch = await pathFallback.resolveLaunch({
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
