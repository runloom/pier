import "./react.ts";

const shared = globalThis.__PIER_PLUGIN_SHARED__;
if (!shared) {
  throw new Error(
    "Pier shared runtime not installed before plugin renderer loaded"
  );
}

const { ReactDOM, ReactDOMClient } = shared;

export default ReactDOM;

export const {
  createPortal,
  flushSync,
  preconnect,
  prefetchDNS,
  preinit,
  preinitModule,
  preload,
  preloadModule,
  requestFormReset,
  unstable_batchedUpdates,
  useFormState,
  useFormStatus,
  version,
} = ReactDOM;

export const { createRoot, hydrateRoot } = ReactDOMClient;
