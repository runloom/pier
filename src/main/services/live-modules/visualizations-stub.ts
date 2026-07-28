import type { PluginBuild } from "esbuild";

const STUB_NAMESPACE = "pier-live-visualizations-stub";
const STUB_PATH = "pier:visualizations-stub";

export function pierVisualizationsStubSource(): string {
  return [
    "function getVisualizations() {",
    "  const runtime = globalThis.__PIER_LIVE_VISUALIZATIONS__;",
    "  if (!runtime) {",
    '    throw new Error("Live module pier/visualizations runtime missing — call installLiveModuleRuntime()");',
    "  }",
    "  return runtime;",
    "}",
    "export function mountDiagram(...args) {",
    "  return getVisualizations().mountDiagram(...args);",
    "}",
    "export default { mountDiagram };",
    "",
  ].join("\n");
}

export function registerVisualizationsStub(build: PluginBuild): void {
  build.onResolve({ filter: /^pier\/visualizations$/ }, () => ({
    namespace: STUB_NAMESPACE,
    path: STUB_PATH,
  }));
  build.onLoad({ filter: /.*/, namespace: STUB_NAMESPACE }, () => ({
    contents: pierVisualizationsStubSource(),
    loader: "js",
  }));
}
