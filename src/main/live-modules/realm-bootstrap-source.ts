import { LIVE_MODULE_REALM_TEARDOWN_NAME } from "@shared/live-module-url.ts";

/**
 * `pier-live://runtime/realm-bootstrap`. Production CSP has no unsafe-inline
 * / unsafe-eval. Host DOM factories and listeners are forwarded; timers stay
 * in the realm. `__pierLiveRealmTeardown` removes forwarded host listeners
 * before the iframe is dropped.
 */

const HOST_DOCUMENT_ACCESSORS = [
  "activeElement",
  "body",
  "documentElement",
  "fonts",
  "head",
  "scrollingElement",
  "styleSheets",
] as const;

const HOST_DOCUMENT_METHODS = [
  "createAttribute",
  "createComment",
  "createDocumentFragment",
  "createElement",
  "createElementNS",
  "createEvent",
  "createRange",
  "createTextNode",
  "createTreeWalker",
  "elementFromPoint",
  "elementsFromPoint",
  "getElementById",
  "getElementsByClassName",
  "getElementsByName",
  "getElementsByTagName",
  "getElementsByTagNameNS",
  "getSelection",
  "hasFocus",
  "querySelector",
  "querySelectorAll",
] as const;

const HOST_WINDOW_ACCESSORS = [
  "devicePixelRatio",
  "innerHeight",
  "innerWidth",
  "outerHeight",
  "outerWidth",
  "pageXOffset",
  "pageYOffset",
  "screenLeft",
  "screenTop",
  "screenX",
  "screenY",
  "scrollX",
  "scrollY",
  "visualViewport",
] as const;

const HOST_WINDOW_METHODS = [
  "getComputedStyle",
  "getSelection",
  "matchMedia",
  "scroll",
  "scrollBy",
  "scrollTo",
] as const;

export function realmBootstrapSource(): string {
  return `
const root = document.documentElement;
const realmId = root.dataset.pierLiveRealm;
const moduleUrl = root.dataset.pierLiveModule;
let host;
try {
  host = globalThis.parent && globalThis.parent !== globalThis ? globalThis.parent : undefined;
} catch {
  host = undefined;
}
const bridge = host?.__PIER_LIVE_REALMS__;
if (!(host && bridge && realmId && moduleUrl)) {
  throw new Error("Live module realm bridge missing");
}
const hostDocument = host.document;
const tracked = [];

function shadowAccessor(target, source, name) {
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    get() { return source[name]; },
    set(value) { source[name] = value; },
  });
}
function shadowMethod(target, source, name) {
  const fn = source[name];
  if (typeof fn !== "function") return;
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: (...args) => fn.apply(source, args),
  });
}
function forwardEvents(target, source) {
  Object.defineProperty(target, "addEventListener", {
    configurable: true, writable: true,
    value(type, listener, options) {
      tracked.push([source, type, listener, options]);
      return source.addEventListener(type, listener, options);
    },
  });
  Object.defineProperty(target, "removeEventListener", {
    configurable: true, writable: true,
    value(type, listener, options) { return source.removeEventListener(type, listener, options); },
  });
  Object.defineProperty(target, "dispatchEvent", {
    configurable: true, writable: true,
    value(event) { return source.dispatchEvent(event); },
  });
}

for (const name of ${JSON.stringify(HOST_DOCUMENT_ACCESSORS)}) shadowAccessor(document, hostDocument, name);
for (const name of ${JSON.stringify(HOST_DOCUMENT_METHODS)}) shadowMethod(document, hostDocument, name);
forwardEvents(document, hostDocument);
for (const name of ${JSON.stringify(HOST_WINDOW_ACCESSORS)}) shadowAccessor(globalThis, host, name);
for (const name of ${JSON.stringify(HOST_WINDOW_METHODS)}) shadowMethod(globalThis, host, name);
forwardEvents(globalThis, host);

globalThis.${LIVE_MODULE_REALM_TEARDOWN_NAME} = () => {
  for (const [source, type, listener, options] of tracked) {
    try { source.removeEventListener(type, listener, options); } catch {}
  }
  tracked.length = 0;
};

import(moduleUrl).then(
  (namespace) => bridge.resolve(realmId, namespace),
  (error) => bridge.reject(realmId, error)
);
`;
}
