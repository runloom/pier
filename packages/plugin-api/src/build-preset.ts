/**
 * Vite/Rollup build preset for external plugin authors. Rewrites bare
 * `react` / `react/jsx-runtime` / `react-dom/*` imports to `@pier/plugin-api`
 * shim aliases (design §7.4). External plugin bundles must not include a
 * second React copy.
 */

export function createPluginBuildPreset(): {
  alias: Record<string, string>;
  external: readonly string[];
} {
  return {
    alias: {
      react: "@pier/plugin-api/react",
      "react-dom": "@pier/plugin-api/react-dom-client",
      "react-dom/client": "@pier/plugin-api/react-dom-client",
      "react/jsx-dev-runtime": "@pier/plugin-api/jsx-dev-runtime",
      "react/jsx-runtime": "@pier/plugin-api/jsx-runtime",
    },
    external: [
      "@pier/plugin-api",
      "@pier/plugin-api/react",
      "@pier/plugin-api/jsx-runtime",
      "@pier/plugin-api/jsx-dev-runtime",
      "@pier/plugin-api/react-dom-client",
      "@pier/ui",
      "lucide-react",
    ],
  };
}
