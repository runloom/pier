import { bindDocxLinks } from "@plugins/builtin/files/renderer/preview/docx/links.ts";
import { sanitizeDocxShadow } from "@plugins/builtin/files/renderer/preview/docx/sanitize.ts";
import { describe, expect, it, vi } from "vitest";

function createShadow(): ShadowRoot {
  const host = document.createElement("div");
  return host.attachShadow({ mode: "open" });
}

describe("sanitizeDocxShadow", () => {
  it("removes active tags, event handlers and external images", () => {
    const root = createShadow();
    root.innerHTML = `
      <script>alert(1)</script>
      <iframe src="https://example.com"></iframe>
      <object data="x"></object>
      <embed src="x">
      <link rel="stylesheet" href="https://example.com/x.css">
      <meta http-equiv="refresh" content="0">
      <form><input><button>go</button></form>
      <img src="https://example.com/tracker.png">
      <img src="data:image/png;base64,AA">
      <a href="https://example.com" onclick="alert(1)" srcdoc="x">link</a>
      <p style="background: url(https://example.com/x.png)">text</p>
      <div style="color: red">safe</div>
    `;

    sanitizeDocxShadow(root);

    for (const tag of [
      "script",
      "iframe",
      "object",
      "embed",
      "link",
      "meta",
      "form",
      "input",
      "button",
    ]) {
      expect(root.querySelector(tag)).toBeNull();
    }

    const external = root.querySelector(
      "img:not([src]), img[data-pier-blocked-image]"
    );
    expect(external?.getAttribute("src")).toBeNull();
    expect(external?.getAttribute("data-pier-blocked-image")).toBe("true");
    expect(root.querySelector('img[src^="data:image/"]')).not.toBeNull();

    const link = root.querySelector("a");
    expect(link?.hasAttribute("onclick")).toBe(false);
    expect(link?.hasAttribute("srcdoc")).toBe(false);

    const styled = root.querySelector("p");
    expect(styled?.hasAttribute("style")).toBe(false);
    expect(root.querySelector("div")?.getAttribute("style")).toBe("color: red");
  });

  it("strips @import and external url() from injected styles", () => {
    const root = createShadow();
    const style = document.createElement("style");
    style.textContent = `
      @import url("https://example.com/x.css");
      .a { background: url(https://example.com/a.png); }
      .b { background: url(data:image/png;base64,AA); }
    `;
    root.append(style);

    sanitizeDocxShadow(root);

    const css = root.querySelector("style")?.textContent ?? "";
    expect(css).not.toContain("@import");
    expect(css).not.toContain("https://example.com/a.png");
    expect(css).toContain("data:image/png;base64,AA");
  });
});

describe("bindDocxLinks", () => {
  function click(anchor: HTMLAnchorElement): MouseEvent {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    anchor.dispatchEvent(event);
    return event;
  }

  it("routes https and mailto links to the host external opener", () => {
    const root = createShadow();
    root.innerHTML = `
      <a id="web" href="https://example.com/doc">web</a>
      <a id="mail" href="mailto:a@example.com">mail</a>
    `;
    const openExternal = vi.fn();
    bindDocxLinks(root, { openExternal, scrollToAnchor: vi.fn() });

    const webClick = click(root.getElementById("web") as HTMLAnchorElement);
    const mailClick = click(root.getElementById("mail") as HTMLAnchorElement);

    expect(webClick.defaultPrevented).toBe(true);
    expect(mailClick.defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenNthCalledWith(1, "https://example.com/doc");
    expect(openExternal).toHaveBeenNthCalledWith(2, "mailto:a@example.com");
  });

  it("scrolls to document anchors and ignores unsafe schemes", () => {
    const root = createShadow();
    root.innerHTML = `
      <a id="anchor" href="#section-1">section</a>
      <a id="js" href="javascript:alert(1)">js</a>
      <a id="file" href="file:///etc/passwd">file</a>
      <a id="relative" href="/relative">relative</a>
    `;
    const openExternal = vi.fn();
    const scrollToAnchor = vi.fn();
    bindDocxLinks(root, { openExternal, scrollToAnchor });

    for (const id of ["anchor", "js", "file", "relative"]) {
      const anchor = root.getElementById(id) as HTMLAnchorElement;
      expect(click(anchor).defaultPrevented).toBe(true);
    }

    expect(scrollToAnchor).toHaveBeenCalledWith("section-1");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("scrolls to percent-containing anchors without throwing", () => {
    const root = createShadow();
    root.innerHTML = '<a id="pct" href="#100%">pct</a>';
    const scrollToAnchor = vi.fn();
    bindDocxLinks(root, { openExternal: vi.fn(), scrollToAnchor });

    const anchor = root.getElementById("pct") as HTMLAnchorElement;
    expect(() => click(anchor)).not.toThrow();
    expect(scrollToAnchor).toHaveBeenCalledWith("100%");
  });

  it("unbinds on cleanup", () => {
    const root = createShadow();
    root.innerHTML = '<a id="web" href="https://example.com">web</a>';
    const openExternal = vi.fn();
    const unbind = bindDocxLinks(root, {
      openExternal,
      scrollToAnchor: vi.fn(),
    });
    unbind();
    click(root.getElementById("web") as HTMLAnchorElement);
    expect(openExternal).not.toHaveBeenCalled();
  });
});
