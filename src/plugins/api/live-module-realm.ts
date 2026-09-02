import {
  LIVE_MODULE_REALM_TEARDOWN_NAME,
  liveModuleRuntimeUrl,
} from "@shared/live-module-url.ts";

/**
 * Disposable same-origin `about:blank` iframe for one live-module generation.
 * Host `import()` would pin each hot-reload URL in the window module map.
 * Same origin keeps React as the host singleton via `parent`. The frame stays
 * `visibility:hidden` (not `display:none`) so realm rAF runs. `instanceof`
 * against host constructors does not hold across realms.
 */
export interface LiveModuleRealm {
  /** Remove the realm now. Everything it evaluated becomes collectable. */
  dispose(): void;
  /**
   * Remove the realm after the current task: React root unmount is deferred by
   * a microtask and runs effect cleanups that still belong to this realm.
   */
  disposeSoon(): void;
  /** Module namespace evaluated inside the realm. */
  readonly namespace: Record<string, unknown>;
}

export interface LiveModuleRealmBridge {
  reject(realmId: string, error: unknown): void;
  resolve(realmId: string, namespace: Record<string, unknown>): void;
}

declare global {
  // eslint-disable-next-line no-var
  var __PIER_LIVE_REALMS__: LiveModuleRealmBridge | undefined;
}

export const LIVE_MODULE_REALM_IMPORT_TIMEOUT_MS = 30_000;
export const LIVE_MODULE_REALM_CONTAINER_ID = "pier-live-realms";
export const LIVE_MODULE_REALM_ATTRIBUTE = "data-pier-live-realm";
export const LIVE_MODULE_REALM_MODULE_ATTRIBUTE = "data-pier-live-module";

interface PendingRealm {
  reject(error: unknown): void;
  resolve(namespace: Record<string, unknown>): void;
}

const pendingRealms = new Map<string, PendingRealm>();
let realmSequence = 0;
let bridgeInstalled = false;

function ensureRealmBridge(): void {
  if (bridgeInstalled && globalThis.__PIER_LIVE_REALMS__) {
    return;
  }
  bridgeInstalled = true;
  const bridge: LiveModuleRealmBridge = {
    reject(realmId, error) {
      pendingRealms.get(realmId)?.reject(error);
    },
    resolve(realmId, namespace) {
      pendingRealms.get(realmId)?.resolve(namespace);
    },
  };
  Object.defineProperty(globalThis, "__PIER_LIVE_REALMS__", {
    configurable: true,
    enumerable: false,
    value: bridge,
    writable: false,
  });
}

/** Cross-realm errors fail `instanceof Error`; rebuild a host Error with the same face. */
export function toHostError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const source = error as {
      message?: unknown;
      name?: unknown;
      stack?: unknown;
    };
    const rebuilt = new Error(
      typeof source.message === "string" ? source.message : String(error)
    );
    if (typeof source.name === "string" && source.name.length > 0) {
      rebuilt.name = source.name;
    }
    if (typeof source.stack === "string") {
      rebuilt.stack = source.stack;
    }
    return rebuilt;
  }
  return new Error(String(error));
}

/** Run the realm's teardown (forwarded host listeners) then drop the iframe. */
function discardRealmFrame(frame: HTMLIFrameElement): void {
  try {
    const realmWindow = frame.contentWindow as
      | (Window & { [LIVE_MODULE_REALM_TEARDOWN_NAME]?: () => void })
      | null;
    realmWindow?.[LIVE_MODULE_REALM_TEARDOWN_NAME]?.();
  } catch {
    // Realm already gone or cross-origin: nothing left to unhook.
  }
  frame.remove();
}

function realmContainer(doc: Document): HTMLElement {
  const existing = doc.getElementById(LIVE_MODULE_REALM_CONTAINER_ID);
  if (existing) {
    return existing;
  }
  const container = doc.createElement("div");
  container.id = LIVE_MODULE_REALM_CONTAINER_ID;
  container.setAttribute("aria-hidden", "true");
  // Rendered but invisible — `display:none` would pause rAF inside the realms.
  // Full-viewport so realm-side media queries and viewport metrics match the
  // host even where the façade does not reach.
  container.style.cssText =
    "position:fixed;inset:0;visibility:hidden;overflow:hidden;pointer-events:none;z-index:-1;";
  (doc.body ?? doc.documentElement).appendChild(container);
  return container;
}

export interface LiveModuleRealmImportOptions {
  document?: Document;
  timeoutMs?: number;
}

type LiveModuleRealmImporter = (
  url: string,
  options: LiveModuleRealmImportOptions
) => Promise<LiveModuleRealm>;

let importerForTests: LiveModuleRealmImporter | null = null;

/**
 * jsdom cannot execute module scripts inside an iframe, so component tests
 * swap the realm importer for the same-realm `import()` below.
 */
export function setLiveModuleRealmImporterForTests(
  importer: LiveModuleRealmImporter | null
): void {
  importerForTests = importer;
}

/** Test double: evaluates in the host realm; dispose is a no-op. */
export async function importLiveModuleInSameRealmForTests(
  url: string
): Promise<LiveModuleRealm> {
  const namespace = (await import(/* @vite-ignore */ url)) as Record<
    string,
    unknown
  >;
  return {
    namespace,
    dispose: () => undefined,
    disposeSoon: () => undefined,
  };
}

export function importLiveModuleInDisposableRealm(
  url: string,
  options: LiveModuleRealmImportOptions = {}
): Promise<LiveModuleRealm> {
  if (importerForTests) {
    return importerForTests(url, options);
  }
  ensureRealmBridge();
  const doc = options.document ?? document;
  const timeoutMs = options.timeoutMs ?? LIVE_MODULE_REALM_IMPORT_TIMEOUT_MS;
  realmSequence += 1;
  const realmId = `realm-${Date.now().toString(36)}-${realmSequence}`;
  const frame = doc.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute(LIVE_MODULE_REALM_ATTRIBUTE, realmId);
  frame.tabIndex = -1;
  frame.style.cssText = "width:100%;height:100%;border:0;pointer-events:none;";

  return new Promise<LiveModuleRealm>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const removeFrame = (): void => {
      pendingRealms.delete(realmId);
      discardRealmFrame(frame);
    };
    const fail = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      removeFrame();
      reject(toHostError(error));
    };
    pendingRealms.set(realmId, {
      reject: fail,
      resolve: (namespace) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer !== null) {
          clearTimeout(timer);
        }
        pendingRealms.delete(realmId);
        resolve({
          namespace,
          dispose: () => {
            discardRealmFrame(frame);
          },
          disposeSoon: () => {
            setTimeout(() => {
              discardRealmFrame(frame);
            }, 0);
          },
        });
      },
    });

    realmContainer(doc).appendChild(frame);
    const realmDocument = frame.contentDocument;
    if (!realmDocument) {
      fail(new Error("Live module realm document unavailable"));
      return;
    }
    realmDocument.documentElement.setAttribute(
      LIVE_MODULE_REALM_ATTRIBUTE,
      realmId
    );
    realmDocument.documentElement.setAttribute(
      LIVE_MODULE_REALM_MODULE_ATTRIBUTE,
      url
    );
    const script = realmDocument.createElement("script");
    script.type = "module";
    script.src = liveModuleRuntimeUrl("realm-bootstrap");
    script.addEventListener("error", () => {
      fail(new Error("Live module realm bootstrap failed to load"));
    });
    (realmDocument.head ?? realmDocument.documentElement).appendChild(script);
    timer = setTimeout(() => {
      fail(
        new Error(`Live module realm import timed out after ${timeoutMs}ms`)
      );
    }, timeoutMs);
  });
}
