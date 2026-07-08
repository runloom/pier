import * as React from "react";
import * as ReactJSXDevRuntime from "react/jsx-dev-runtime";
import * as ReactJSXRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

declare global {
  // eslint-disable-next-line no-var
  var __PIER_PLUGIN_SHARED__:
    | {
        React: typeof React;
        ReactDOM: typeof ReactDOM;
        ReactDOMClient: typeof ReactDOMClient;
        ReactJSXDevRuntime: typeof ReactJSXDevRuntime;
        ReactJSXRuntime: typeof ReactJSXRuntime;
      }
    | undefined;
}

describe("@pier/plugin-api JSX runtime shims", () => {
  afterEach(() => {
    globalThis.__PIER_PLUGIN_SHARED__ = undefined;
    vi.resetModules();
  });

  it("exports jsx/jsxs from the host react/jsx-runtime singleton", async () => {
    globalThis.__PIER_PLUGIN_SHARED__ = {
      React,
      ReactDOM,
      ReactDOMClient,
      ReactJSXDevRuntime,
      ReactJSXRuntime,
    };

    const runtime = await import(
      "../../../packages/plugin-api/src/jsx-runtime.ts"
    );

    expect(runtime.jsx).toBe(ReactJSXRuntime.jsx);
    expect(runtime.jsxs).toBe(ReactJSXRuntime.jsxs);
    expect(runtime.Fragment).toBe(ReactJSXRuntime.Fragment);
  });

  it("exports jsxDEV from the host react/jsx-dev-runtime singleton", async () => {
    globalThis.__PIER_PLUGIN_SHARED__ = {
      React,
      ReactDOM,
      ReactDOMClient,
      ReactJSXDevRuntime,
      ReactJSXRuntime,
    };

    const runtime = await import(
      "../../../packages/plugin-api/src/jsx-dev-runtime.ts"
    );

    expect(runtime.jsxDEV).toBe(ReactJSXDevRuntime.jsxDEV);
    expect(runtime.Fragment).toBe(ReactJSXDevRuntime.Fragment);
  });

  it("exports react-dom and react-dom/client functions from host singletons", async () => {
    globalThis.__PIER_PLUGIN_SHARED__ = {
      React,
      ReactDOM,
      ReactDOMClient,
      ReactJSXDevRuntime,
      ReactJSXRuntime,
    };

    const runtime = await import(
      "../../../packages/plugin-api/src/react-dom-client.ts"
    );

    expect(runtime.createRoot).toBe(ReactDOMClient.createRoot);
    expect(runtime.hydrateRoot).toBe(ReactDOMClient.hydrateRoot);
    expect(runtime.createPortal).toBe(ReactDOM.createPortal);
    expect(runtime.flushSync).toBe(ReactDOM.flushSync);
  });
});
