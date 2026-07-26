import * as React from "react";
import * as ReactJSXDevRuntime from "react/jsx-dev-runtime";
import * as ReactJSXRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import { installLiveModuleRuntime } from "../live-modules/install-runtime.ts";

/**
 * Install host React singletons on `globalThis.__PIER_PLUGIN_SHARED__` so
 * external plugin bundles can consume them via `@pier/plugin-api` shims
 * without embedding a second React copy (design §7.4, plan Task 6).
 * Also installs Live Modules `pier/canvas` + shell CSS.
 *
 * MUST be called before loading any external renderer plugin entry.
 */

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

export function installPluginSharedRuntime(): void {
  if (!globalThis.__PIER_PLUGIN_SHARED__) {
    globalThis.__PIER_PLUGIN_SHARED__ = {
      React,
      ReactDOM,
      ReactDOMClient,
      ReactJSXDevRuntime,
      ReactJSXRuntime,
    };
  }
  // Always refresh canvas exports / shell (HMR-friendly).
  installLiveModuleRuntime();
}
