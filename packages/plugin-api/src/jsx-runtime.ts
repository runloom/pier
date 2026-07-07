import "./react.ts";

const shared = globalThis.__PIER_PLUGIN_SHARED__;
if (!shared) {
  throw new Error(
    "Pier shared runtime not installed before plugin renderer loaded"
  );
}

const { React } = shared;

// react/jsx-runtime exports jsx / jsxs / Fragment.
// jsx-runtime is a distinct module in React 17+; expose it from shared runtime.
export const jsx = (
  React as unknown as { jsx: (...args: unknown[]) => unknown }
).jsx;
export const jsxs = (
  React as unknown as { jsxs: (...args: unknown[]) => unknown }
).jsxs;
export const Fragment = React.Fragment;
