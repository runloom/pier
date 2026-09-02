import {
  importLiveModuleInDisposableRealm,
  LIVE_MODULE_REALM_ATTRIBUTE,
  LIVE_MODULE_REALM_CONTAINER_ID,
  LIVE_MODULE_REALM_MODULE_ATTRIBUTE,
  toHostError,
} from "@plugins/api/live-module-realm.ts";
import {
  LIVE_MODULE_REALM_TEARDOWN_NAME,
  liveModuleRuntimeUrl,
} from "@shared/live-module-url.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * jsdom does not execute the bootstrap module script, so these tests drive the
 * `parent.__PIER_LIVE_REALMS__` bridge by hand — exactly what the bootstrap
 * does after `import(moduleUrl)` settles inside the realm.
 */
function realmFrames(): HTMLIFrameElement[] {
  return [
    ...document.querySelectorAll<HTMLIFrameElement>(
      `iframe[${LIVE_MODULE_REALM_ATTRIBUTE}]`
    ),
  ];
}

function bridge() {
  const value = globalThis.__PIER_LIVE_REALMS__;
  if (!value) {
    throw new Error("realm bridge not installed");
  }
  return value;
}

describe("live-module disposable realm", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("evaluates through a same-origin iframe that loads only the external bootstrap module", async () => {
    const pending = importLiveModuleInDisposableRealm(
      "pier-live://module/abcdefghijklmnopqrstuv"
    );
    const [frame] = realmFrames();
    expect(frame).toBeDefined();
    expect(frame?.parentElement?.id).toBe(LIVE_MODULE_REALM_CONTAINER_ID);
    // Rendered (rAF keeps running) but invisible; never `display:none`.
    expect(frame?.style.display).not.toBe("none");
    expect(frame?.getAttribute("aria-hidden")).toBe("true");
    expect(frame?.hasAttribute("src")).toBe(false);
    expect(frame?.hasAttribute("sandbox")).toBe(false);

    const realmDocument = frame?.contentDocument;
    const realmId = frame?.getAttribute(LIVE_MODULE_REALM_ATTRIBUTE) ?? "";
    expect(
      realmDocument?.documentElement.getAttribute(LIVE_MODULE_REALM_ATTRIBUTE)
    ).toBe(realmId);
    expect(
      realmDocument?.documentElement.getAttribute(
        LIVE_MODULE_REALM_MODULE_ATTRIBUTE
      )
    ).toBe("pier-live://module/abcdefghijklmnopqrstuv");
    const scripts = [...(realmDocument?.querySelectorAll("script") ?? [])];
    expect(scripts.map((s) => [s.type, s.getAttribute("src")])).toEqual([
      ["module", liveModuleRuntimeUrl("realm-bootstrap")],
    ]);
    expect(scripts[0]?.textContent).toBe("");

    const namespace = { default: () => null };
    bridge().resolve(realmId, namespace);
    const realm = await pending;
    expect(realm.namespace).toBe(namespace);
    expect(realmFrames()).toHaveLength(1);

    realm.dispose();
    expect(realmFrames()).toHaveLength(0);
  });

  it("runs the realm teardown (forwarded host listeners) before dropping the iframe", async () => {
    const pending = importLiveModuleInDisposableRealm(
      "pier-live://module/gggggggggggggggggggggggg"
    );
    const frame = realmFrames()[0];
    const realmId = frame?.getAttribute(LIVE_MODULE_REALM_ATTRIBUTE) ?? "";
    const teardown = vi.fn();
    (frame?.contentWindow as unknown as Record<string, unknown> | null)![
      LIVE_MODULE_REALM_TEARDOWN_NAME
    ] = teardown;
    bridge().resolve(realmId, {});
    const realm = await pending;
    realm.dispose();
    expect(teardown).toHaveBeenCalledOnce();
    expect(realmFrames()).toHaveLength(0);
  });

  it("disposeSoon removes the realm after the current task", async () => {
    vi.useFakeTimers();
    const pending = importLiveModuleInDisposableRealm(
      "pier-live://module/aaaaaaaaaaaaaaaaaaaaaaaa"
    );
    const realmId =
      realmFrames()[0]?.getAttribute(LIVE_MODULE_REALM_ATTRIBUTE) ?? "";
    bridge().resolve(realmId, {});
    const realm = await pending;
    realm.disposeSoon();
    expect(realmFrames()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(realmFrames()).toHaveLength(0);
  });

  it("rejects with a host Error and tears the realm down when the module fails to evaluate", async () => {
    const pending = importLiveModuleInDisposableRealm(
      "pier-live://module/bbbbbbbbbbbbbbbbbbbbbbbb"
    );
    const frame = realmFrames()[0];
    const realmId = frame?.getAttribute(LIVE_MODULE_REALM_ATTRIBUTE) ?? "";
    const teardown = vi.fn();
    (frame?.contentWindow as unknown as Record<string, unknown> | null)![
      LIVE_MODULE_REALM_TEARDOWN_NAME
    ] = teardown;
    // A realm Error is a foreign-realm object: emulate with a plain error-like value.
    bridge().reject(realmId, {
      message: "boom from realm",
      name: "SyntaxError",
    });
    await expect(pending).rejects.toMatchObject({
      message: "boom from realm",
      name: "SyntaxError",
    });
    await expect(pending).rejects.toBeInstanceOf(Error);
    expect(teardown).toHaveBeenCalledOnce();
    expect(realmFrames()).toHaveLength(0);
  });

  it("rejects when the bootstrap script fails to load", async () => {
    const pending = importLiveModuleInDisposableRealm(
      "pier-live://module/cccccccccccccccccccccccc"
    );
    const script = realmFrames()[0]?.contentDocument?.querySelector("script");
    script?.dispatchEvent(new Event("error"));
    await expect(pending).rejects.toThrow(/bootstrap failed to load/u);
    expect(realmFrames()).toHaveLength(0);
  });

  it("times out and tears down when the realm never reports back", async () => {
    vi.useFakeTimers();
    const pending = importLiveModuleInDisposableRealm(
      "pier-live://module/dddddddddddddddddddddddd",
      { timeoutMs: 1000 }
    );
    const rejection = expect(pending).rejects.toThrow(/timed out/u);
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
    expect(realmFrames()).toHaveLength(0);
  });

  it("keeps concurrent realms apart", async () => {
    const first = importLiveModuleInDisposableRealm(
      "pier-live://module/eeeeeeeeeeeeeeeeeeeeeeee"
    );
    const second = importLiveModuleInDisposableRealm(
      "pier-live://module/ffffffffffffffffffffffff"
    );
    const [firstId, secondId] = realmFrames().map(
      (frame) => frame.getAttribute(LIVE_MODULE_REALM_ATTRIBUTE) ?? ""
    );
    expect(firstId).not.toBe(secondId);
    bridge().resolve(secondId ?? "", { second: true });
    bridge().resolve(firstId ?? "", { first: true });
    expect((await first).namespace).toEqual({ first: true });
    expect((await second).namespace).toEqual({ second: true });
  });

  it("rebuilds foreign-realm errors as host errors", () => {
    const own = new Error("own");
    expect(toHostError(own)).toBe(own);
    const rebuilt = toHostError({
      message: "foreign",
      name: "TypeError",
      stack: "TypeError: foreign\n  at x",
    });
    expect(rebuilt).toBeInstanceOf(Error);
    expect(rebuilt.message).toBe("foreign");
    expect(rebuilt.name).toBe("TypeError");
    expect(rebuilt.stack).toContain("at x");
    expect(toHostError("plain").message).toBe("plain");
  });
});
