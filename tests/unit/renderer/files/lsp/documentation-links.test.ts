import { EditorState } from "@codemirror/state";
import { EditorView } from "codemirror";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filesLspDocumentationLinksExtension } from "../../../../../src/plugins/builtin/files/renderer/lsp/documentation-links.ts";
import { sanitizeFilesLspHtml } from "../../../../../src/plugins/builtin/files/renderer/lsp/html-sanitizer.ts";

type OpenExternal = (url: string) => void;

type DocumentationSurface =
  | "Pier hover"
  | "completion documentation"
  | "signature documentation";

const CANONICAL_URL = "https://example.com/docs/guide?source=lsp#usage";
const SERVER_URL =
  "https://EXAMPLE.com:443/docs/reference/../guide?source=lsp#usage";

function appendDocumentationSurface(
  view: EditorView,
  surface: DocumentationSurface,
  html: string
): HTMLElement {
  const wrapper = document.createElement("section");
  wrapper.className = "cm-lsp-documentation";
  wrapper.dataset.lspSurface = surface;
  wrapper.innerHTML = sanitizeFilesLspHtml(html);
  view.dom.append(wrapper);
  return wrapper;
}

describe("filesLspDocumentationLinksExtension", () => {
  let host: HTMLDivElement;
  let view: EditorView | null;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    view = null;
  });

  afterEach(() => {
    view?.destroy();
    host.remove();
  });

  function mount(getOpenExternal: () => OpenExternal): EditorView {
    const mounted = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "const documented = true;",
        extensions: [filesLspDocumentationLinksExtension(getOpenExternal)],
      }),
    });
    view = mounted;
    return mounted;
  }

  it.each([
    ["Pier hover", 1],
    ["completion documentation", 0],
    ["signature documentation", 1],
  ] as const)("routes a sanitized canonical link from %s through the current opener", (surface, detail) => {
    const openExternal = vi.fn<OpenExternal>();
    const mounted = mount(() => openExternal);
    const wrapper = appendDocumentationSurface(
      mounted,
      surface,
      `<p><a href="${SERVER_URL}"><strong>Open documentation</strong></a></p>`
    );
    const anchor = wrapper.querySelector("a");
    const clickTarget = anchor?.querySelector("strong");

    expect(anchor?.getAttribute("href")).toBe(CANONICAL_URL);
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(clickTarget).not.toBeNull();

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      detail,
    });
    const dispatched = clickTarget?.dispatchEvent(event);

    expect(dispatched).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(CANONICAL_URL);
  });

  it("reads the latest opener callback without remounting the editor extension", () => {
    const firstOpenExternal = vi.fn<OpenExternal>();
    const latestOpenExternal = vi.fn<OpenExternal>();
    let currentOpenExternal: OpenExternal = firstOpenExternal;
    const mounted = mount(() => currentOpenExternal);
    const wrapper = appendDocumentationSurface(
      mounted,
      "Pier hover",
      `<a href="${SERVER_URL}">Open documentation</a>`
    );
    const anchor = wrapper.querySelector("a");

    anchor?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })
    );
    currentOpenExternal = latestOpenExternal;
    anchor?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 })
    );

    expect(firstOpenExternal).toHaveBeenCalledTimes(1);
    expect(firstOpenExternal).toHaveBeenCalledWith(CANONICAL_URL);
    expect(latestOpenExternal).toHaveBeenCalledTimes(1);
    expect(latestOpenExternal).toHaveBeenCalledWith(CANONICAL_URL);
  });

  it.each([
    ["HTTP", "http://example.com/docs"],
    ["credentials", "https://user:secret@example.com/docs"],
    ["relative", "/docs"],
  ])("blocks an unsafe %s anchor injected inside documentation", (_name, href) => {
    const openExternal = vi.fn<OpenExternal>();
    const mounted = mount(() => openExternal);
    const wrapper = document.createElement("section");
    wrapper.className = "cm-lsp-documentation";
    wrapper.innerHTML = `<a href="${href}">Unsafe documentation</a>`;
    mounted.dom.append(wrapper);
    const anchor = wrapper.querySelector("a");
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      detail: 1,
    });

    const dispatched = anchor?.dispatchEvent(event);

    expect(dispatched).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("does not claim a link outside the documentation boundary", () => {
    const openExternal = vi.fn<OpenExternal>();
    const mounted = mount(() => openExternal);
    const outside = document.createElement("a");
    outside.href = CANONICAL_URL;
    outside.rel = "noopener noreferrer";
    outside.textContent = "Editor link outside documentation";
    outside.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    mounted.dom.append(outside);

    outside.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })
    );

    expect(openExternal).not.toHaveBeenCalled();
  });

  it("does not route a link that the sanitizer unwrapped", () => {
    const openExternal = vi.fn<OpenExternal>();
    const mounted = mount(() => openExternal);
    const wrapper = appendDocumentationSurface(
      mounted,
      "signature documentation",
      '<a href="javascript:alert(1)">Unsafe documentation</a>'
    );

    expect(wrapper.querySelector("a")).toBeNull();
    wrapper.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 })
    );

    expect(openExternal).not.toHaveBeenCalled();
  });

  it("removes its delegated handler when the editor view is destroyed", () => {
    const openExternal = vi.fn<OpenExternal>();
    const mounted = mount(() => openExternal);
    const wrapper = appendDocumentationSurface(
      mounted,
      "completion documentation",
      `<a href="${SERVER_URL}">Open documentation</a>`
    );
    const anchor = wrapper.querySelector("a");
    anchor?.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });

    mounted.destroy();
    view = null;
    anchor?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })
    );

    expect(openExternal).not.toHaveBeenCalled();
  });
});
