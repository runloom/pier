// @vitest-environment jsdom
import {
  findCanvasExternalAnchor,
  isCanvasExternalHttpUrl,
  useCanvasExternalLinks,
} from "@plugins/builtin/files/renderer/preview/use-canvas-external-links.ts";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("canvas external links", () => {
  it("accepts only http(s) absolute urls", () => {
    expect(isCanvasExternalHttpUrl("https://cursor.com/blog/canvas")).toBe(
      true
    );
    expect(isCanvasExternalHttpUrl("http://example.com")).toBe(true);
    expect(isCanvasExternalHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isCanvasExternalHttpUrl("/relative")).toBe(false);
    expect(isCanvasExternalHttpUrl("not a url")).toBe(false);
  });

  it("resolves the closest http(s) anchor from a click target", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<p><a href="https://play.grafana.org/"><span>Play</span></a></p>';
    const span = root.querySelector("span");
    const anchor = findCanvasExternalAnchor(span);
    expect(anchor?.href).toContain("https://play.grafana.org/");
  });

  it("ignores non-http anchors", () => {
    const root = document.createElement("div");
    root.innerHTML = '<a href="#section">in page</a>';
    const link = root.querySelector("a");
    expect(findCanvasExternalAnchor(link)).toBeNull();
  });
});

describe("useCanvasExternalLinks", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("opens modifier primary-clicks through external navigation", async () => {
    const host = document.createElement("div");
    host.innerHTML = '<a href="https://example.com/docs">Docs</a>';
    document.body.append(host);
    const open = vi.fn(async () => ({ opened: true as const }));
    renderHook(() =>
      useCanvasExternalLinks({
        context: {
          dialogs: { alert: vi.fn(async () => undefined) },
          externalNavigation: { open },
          notifications: { info: vi.fn() },
        } as never,
        enabled: true,
        hostRef: { current: host },
        t: (_key, fallback) => fallback ?? _key,
      })
    );
    const link = host.querySelector("a");
    expect(link).toBeTruthy();
    link?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        button: 0,
        cancelable: true,
        metaKey: true,
      })
    );
    await waitFor(() => {
      expect(open).toHaveBeenCalledWith("https://example.com/docs");
    });
  });
});
