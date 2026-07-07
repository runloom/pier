import "./react.ts";

const shared = globalThis.__PIER_PLUGIN_SHARED__;
if (!shared) {
  throw new Error(
    "Pier shared runtime not installed before plugin renderer loaded"
  );
}

const { React } = shared;

export const jsxDEV = (
  React as unknown as { jsxDEV: (...args: unknown[]) => unknown }
).jsxDEV;
export const Fragment = React.Fragment;
