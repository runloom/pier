// @vitest-environment node
import {
  LIVE_MODULE_REALM_TEARDOWN_NAME,
  LIVE_MODULE_RUNTIME_IDS,
  liveModuleRuntimeIdFromUrl,
  liveModuleRuntimeUrl,
} from "@shared/live-module-url.ts";
import { describe, expect, it } from "vitest";
import {
  createLiveModuleProtocolHandler,
  isAllowedLiveModuleCorsOrigin,
  runtimeShimSource,
} from "../../../../src/main/live-modules/protocol-handler.ts";
import {
  appendScopedCssInjector,
  scopedCssInjectorSnippet,
} from "../../../../src/main/services/live-modules/css-inject.ts";
import { LIVE_MODULE_HOST_GLOBAL_READER_NAME } from "../../../../src/main/services/live-modules/host-global-source.ts";
import { pierHostStubSource } from "../../../../src/main/services/live-modules/host-stub.ts";
import { pierCanvasStubSource } from "../../../../src/main/services/live-modules/stub-sources.ts";

/**
 * Live modules evaluate in a disposable same-origin iframe realm
 * (`@plugins/api/live-module-realm.ts`). Host React / canvas / host singletons
 * and injected CSS must therefore go through `parent`. Document/window listeners
 * and DOM factories are forwarded by the realm bootstrap façade — Solid/Vue
 * event delegation then lands on the host document without a per-framework
 * compile snippet.
 */
describe("live-module disposable realm compatibility (main side)", () => {
  it("serves a realm bootstrap runtime that imports the module and reports through parent", () => {
    expect(LIVE_MODULE_RUNTIME_IDS).toContain("realm-bootstrap");
    const url = liveModuleRuntimeUrl("realm-bootstrap");
    expect(liveModuleRuntimeIdFromUrl(url)).toBe("realm-bootstrap");
    const source = runtimeShimSource("realm-bootstrap");
    expect(source).toContain("dataset.pierLiveRealm");
    expect(source).toContain("dataset.pierLiveModule");
    expect(source).toContain("host?.__PIER_LIVE_REALMS__");
    expect(source).toMatch(/import\(moduleUrl\)\.then\(/u);
    expect(source).toContain("bridge.resolve(realmId, namespace)");
    expect(source).toContain("bridge.reject(realmId, error)");
    expect(source).not.toMatch(/\beval\s*\(/u);
  });

  it("forwards host document/window surfaces and tears forwarded listeners down", () => {
    const source = runtimeShimSource("realm-bootstrap");
    expect(source).toContain("forwardEvents(document, hostDocument)");
    expect(source).toContain("forwardEvents(globalThis, host)");
    expect(source).toContain('"createElement"');
    expect(source).toContain('"innerWidth"');
    expect(source).toContain(LIVE_MODULE_REALM_TEARDOWN_NAME);
    // Timers / rAF stay in the realm so a dropped iframe cannot pin callbacks
    // on the host window.
    expect(source).not.toContain('"requestAnimationFrame"');
    expect(source).not.toContain('"cancelAnimationFrame"');
    expect(source).not.toContain('"setTimeout"');
    expect(source).not.toContain('"setInterval"');
  });

  it("serves the bootstrap over pier-live://runtime/realm-bootstrap", async () => {
    const handler = createLiveModuleProtocolHandler(() => null);
    const response = await handler(
      new Request(liveModuleRuntimeUrl("realm-bootstrap"))
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/javascript/u);
    expect(await response.text()).toContain("import(moduleUrl)");
  });

  it("echoes CORS Origin for opaque, file, localhost, and pier-live hosts", async () => {
    expect(isAllowedLiveModuleCorsOrigin("null")).toBe(true);
    expect(isAllowedLiveModuleCorsOrigin("file://")).toBe(true);
    expect(isAllowedLiveModuleCorsOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedLiveModuleCorsOrigin("pier-live://runtime")).toBe(true);
    expect(isAllowedLiveModuleCorsOrigin("pier-live://module")).toBe(true);
    expect(isAllowedLiveModuleCorsOrigin("https://evil.example")).toBe(false);

    const handler = createLiveModuleProtocolHandler(() => null);
    const url = liveModuleRuntimeUrl("realm-bootstrap");
    for (const origin of [
      "null",
      "file://",
      "http://localhost:5173",
      "pier-live://runtime",
    ]) {
      const response = await handler(new Request(url, { headers: { origin } }));
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("vary")).toBe("Origin");
    }
    const forbidden = await handler(
      new Request(url, { headers: { origin: "https://evil.example" } })
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("reads host singletons through the parent-aware reader in every shim and stub", () => {
    for (const id of [
      "react",
      "react-dom",
      "react-dom-client",
      "jsx-runtime",
      "jsx-dev-runtime",
    ] as const) {
      const source = runtimeShimSource(id);
      expect(source).toContain(
        `function ${LIVE_MODULE_HOST_GLOBAL_READER_NAME}(`
      );
      expect(source).toContain(
        `${LIVE_MODULE_HOST_GLOBAL_READER_NAME}("__PIER_PLUGIN_SHARED__")`
      );
      expect(source).not.toMatch(/=\s*globalThis\.__PIER_PLUGIN_SHARED__/u);
    }
    expect(pierCanvasStubSource()).toContain(
      `${LIVE_MODULE_HOST_GLOBAL_READER_NAME}("__PIER_LIVE_CANVAS__")`
    );
    expect(pierHostStubSource()).toContain(
      `${LIVE_MODULE_HOST_GLOBAL_READER_NAME}("__PIER_LIVE_HOST__")`
    );
  });

  it("injects CSS into the host (parent) document, not the realm document", () => {
    for (const injector of [
      appendScopedCssInjector("export {};", ".a{color:red}", "m.canvas.tsx"),
      scopedCssInjectorSnippet(".b{}", "m.canvas.vue", "local"),
    ]) {
      expect(injector).toContain("doc = globalThis.parent.document");
      expect(injector).toContain("doc.head.appendChild(s)");
      expect(injector).not.toMatch(/\bdocument\.head\./u);
    }
  });
});
