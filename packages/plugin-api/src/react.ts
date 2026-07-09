/**
 * React classic runtime shim. Reads from host-installed shared runtime
 * (`globalThis.__PIER_PLUGIN_SHARED__`) so plugin bundles do NOT contain
 * a second React copy (design §7.4). Build preset rewrites bare `react`
 * imports to this shim.
 *
 * Shim MUST be a superset of `react` public exports; a fixture test in
 * Task 12 will fail if a React upgrade adds a new hook we haven't exposed.
 */

interface PierPluginShared {
  React: typeof import("react");
  ReactDOM: typeof import("react-dom");
  ReactDOMClient: typeof import("react-dom/client");
  ReactJSXDevRuntime: typeof import("react/jsx-dev-runtime");
  ReactJSXRuntime: typeof import("react/jsx-runtime");
}

// Runtime access — the injection happens before plugin renderer entries load.
// The cast is required because globalThis has no typed knowledge of our field.
declare global {
  // eslint-disable-next-line no-var
  var __PIER_PLUGIN_SHARED__: PierPluginShared | undefined;
}

const shared = globalThis.__PIER_PLUGIN_SHARED__;
if (!shared) {
  throw new Error(
    "Pier shared runtime (__PIER_PLUGIN_SHARED__) not installed before plugin renderer loaded"
  );
}

const { React } = shared;

export default React;
export const {
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  use,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} = React;
