import "./react.ts";

const shared = globalThis.__PIER_PLUGIN_SHARED__;
if (!shared) {
  throw new Error(
    "Pier shared runtime not installed before plugin renderer loaded"
  );
}

const { ReactJSXRuntime } = shared;

// react/jsx-runtime exports jsx / jsxs / Fragment.
// jsx-runtime is a distinct module in React 17+; expose it from shared runtime.
export const jsx = ReactJSXRuntime.jsx;
export const jsxs = ReactJSXRuntime.jsxs;
export const Fragment = ReactJSXRuntime.Fragment;
