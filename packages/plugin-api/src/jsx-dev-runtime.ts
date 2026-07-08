import "./react.ts";

const shared = globalThis.__PIER_PLUGIN_SHARED__;
if (!shared) {
  throw new Error(
    "Pier shared runtime not installed before plugin renderer loaded"
  );
}

const { ReactJSXDevRuntime } = shared;

export const jsxDEV = ReactJSXDevRuntime.jsxDEV;
export const Fragment = ReactJSXDevRuntime.Fragment;
