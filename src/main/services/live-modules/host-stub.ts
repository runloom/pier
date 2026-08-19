import type { PluginBuild } from "esbuild";

const STUB_NAMESPACE = "pier-live-host-stub";
const STUB_PATH = "pier:host-stub";

export function pierHostStubSource(): string {
  return [
    "function getHostRuntime() {",
    "  const runtime = globalThis.__PIER_LIVE_HOST__;",
    "  if (!runtime) {",
    '    throw new Error("Live module pier/host runtime missing — call installLiveModuleRuntime()");',
    "  }",
    "  return runtime;",
    "}",
    "export const host = new Proxy({}, {",
    "  get(_target, prop) {",
    "    const api = getHostRuntime().host;",
    "    const value = api[prop];",
    '    return typeof value === "function" ? value.bind(api) : value;',
    "  },",
    "});",
    "export function useHostSnapshot(...args) {",
    "  return getHostRuntime().useHostSnapshot(...args);",
    "}",
    "",
  ].join("\n");
}

export function registerHostStub(build: PluginBuild): void {
  build.onResolve({ filter: /^pier\/host$/ }, () => ({
    namespace: STUB_NAMESPACE,
    path: STUB_PATH,
  }));
  build.onLoad({ filter: /.*/, namespace: STUB_NAMESPACE }, () => ({
    contents: pierHostStubSource(),
    loader: "js",
  }));
}
