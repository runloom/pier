import {
  LIVE_MODULE_SCHEME,
  type LiveModuleRuntimeId,
  liveModuleAssetTicketFromUrl,
  liveModuleRuntimeIdFromUrl,
  liveModuleTicketFromUrl,
} from "@shared/live-module-url.ts";
import { isDevRuntime } from "../runtime-mode.ts";
import {
  liveModuleHostGlobalExpression,
  liveModuleHostGlobalReaderSource,
} from "../services/live-modules/host-global-source.ts";
import type { LiveModulesService } from "../services/live-modules/service.ts";
import { realmBootstrapSource } from "./realm-bootstrap-source.ts";

/**
 * CORS allowlist. Module scripts send Origin; Fetch requires echoing it
 * (`null` for opaque file/about:blank; `pier-live://runtime|module|asset` for
 * the intra-protocol graph). Tickets still gate bytes.
 */
export function isAllowedLiveModuleCorsOrigin(origin: string | null): boolean {
  if (!origin) {
    return false;
  }
  if (origin === "null" || origin.startsWith("file:")) {
    return true;
  }
  try {
    const url = new URL(origin);
    if (url.protocol === `${LIVE_MODULE_SCHEME}:`) {
      return (
        url.hostname === "runtime" ||
        url.hostname === "module" ||
        url.hostname === "asset"
      );
    }
    if (url.protocol === "file:") {
      return true;
    }
    if (!isDevRuntime()) {
      return false;
    }
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

/**
 * Host singletons are read through the parent-aware reader: shims evaluate in
 * the disposable live-module realm, where `globalThis` is the iframe window.
 */
export function runtimeShimSource(id: LiveModuleRuntimeId): string {
  const reader = liveModuleHostGlobalReaderSource();
  const shared = `${reader}\nconst shared = ${liveModuleHostGlobalExpression("__PIER_PLUGIN_SHARED__")};`;
  switch (id) {
    case "react":
      // Keep ≥ packages/plugin-api/src/react.ts public surface (+ React 19 hooks).
      return `
${shared}
if (!shared?.React) throw new Error("Live module React runtime missing");
const React = shared.React;
export default React;
export const {
  Children, Component, Fragment, Profiler, PureComponent, StrictMode, Suspense,
  cloneElement, createContext, createElement, createRef, forwardRef, isValidElement,
  lazy, memo, startTransition, use, useCallback, useContext, useDebugValue,
  useDeferredValue, useEffect, useId, useImperativeHandle, useInsertionEffect,
  useLayoutEffect, useMemo, useOptimistic, useReducer, useRef, useState,
  useSyncExternalStore, useTransition, version
} = React;
// Optional React 19.2+ exports — bind only if present on the host singleton.
export const useActionState = React.useActionState;
export const useEffectEvent = React.useEffectEvent;
export const cache = React.cache;
`;
    case "react-dom":
      return `
${shared}
if (!shared?.ReactDOM) throw new Error("Live module ReactDOM runtime missing");
const ReactDOM = shared.ReactDOM;
export default ReactDOM;
export const { createPortal, flushSync, version } = ReactDOM;
export const useFormStatus = ReactDOM.useFormStatus;
export const useFormState = ReactDOM.useFormState;
`;
    case "react-dom-client":
      return `
${shared}
if (!shared?.ReactDOMClient) throw new Error("Live module react-dom/client runtime missing");
const ReactDOMClient = shared.ReactDOMClient;
export default ReactDOMClient;
export const { createRoot, hydrateRoot } = ReactDOMClient;
`;
    case "jsx-runtime":
      return `
${shared}
if (!shared?.ReactJSXRuntime) throw new Error("Live module jsx-runtime missing");
const runtime = shared.ReactJSXRuntime;
export const { Fragment, jsx, jsxs } = runtime;
`;
    case "jsx-dev-runtime":
      return `
${shared}
if (!shared?.ReactJSXDevRuntime) throw new Error("Live module jsx-dev-runtime missing");
const runtime = shared.ReactJSXDevRuntime;
export const { Fragment, jsx, jsxs, jsxDEV } = runtime;
`;
    case "realm-bootstrap":
      return realmBootstrapSource();
    default: {
      const _exhaustive: never = id;
      return `throw new Error("unknown runtime ${String(_exhaustive)}")`;
    }
  }
}

export function createLiveModuleProtocolHandler(
  getService: () => LiveModulesService | null
): (request: Request) => Promise<Response> {
  return async (request) => {
    const origin = request.headers.get("origin");
    const headers: Record<string, string> = {
      "cache-control": "no-store",
      "content-type": "text/javascript; charset=utf-8",
      "x-content-type-options": "nosniff",
    };
    // Missing Origin: not a CORS request (same-origin / no-cors). Present
    // Origin must be allowlisted and echoed — Fetch forbids `*`.
    if (origin) {
      if (!isAllowedLiveModuleCorsOrigin(origin)) {
        return new Response("forbidden origin", { status: 403 });
      }
      headers["access-control-allow-origin"] = origin;
      headers.vary = "Origin";
    }

    const runtimeId = liveModuleRuntimeIdFromUrl(request.url);
    if (runtimeId) {
      return new Response(runtimeShimSource(runtimeId), {
        headers,
        status: 200,
      });
    }

    const assetTicket = liveModuleAssetTicketFromUrl(request.url);
    if (assetTicket) {
      const service = getService();
      const asset = service?.getAssetByTicket(assetTicket);
      if (!asset) {
        return new Response("not found", { status: 404 });
      }
      return new Response(Uint8Array.from(asset.bytes), {
        headers: {
          ...headers,
          "content-type": asset.mimeType,
        },
        status: 200,
      });
    }

    const ticket = liveModuleTicketFromUrl(request.url);
    if (!ticket) {
      return new Response("bad live module URL", { status: 400 });
    }
    const service = getService();
    const artifact = service?.getArtifactByTicket(ticket);
    if (!artifact) {
      return new Response("not found", { status: 404 });
    }
    return new Response(Uint8Array.from(artifact.bytes), {
      headers,
      status: 200,
    });
  };
}
