import { syncPathTitleChrome } from "@pier/ui/diff-view/path-title-chrome.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("syncPathTitleChrome", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function mountTitle(path = "src/main/app-core/commands/git.ts") {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const title = document.createElement("div");
    title.setAttribute("data-title", "");
    const bdi = document.createElement("bdi");
    bdi.textContent = path;
    title.append(bdi);
    shadow.append(title);
    document.body.append(host);
    return { bdi, host, title };
  }

  it("applies mono font and pointer cursor on the path title", () => {
    const { host, title, bdi } = mountTitle();
    syncPathTitleChrome(host);

    expect(title.style.cursor).toBe("pointer");
    expect(title.style.fontFamily).toContain("pier-mono-font-family");
    expect(title.style.fontWeight).toBe("400");
    expect(bdi.style.fontFamily).toBe("inherit");
  });

  it("underlines the path on pointerenter and clears on pointerleave", () => {
    const { host, title, bdi } = mountTitle("a/b.ts");
    syncPathTitleChrome(host);

    title.dispatchEvent(new Event("pointerenter"));
    expect(title.style.textDecoration).toBe("underline");
    expect(title.style.textDecorationSkipInk).toBe("none");
    expect(bdi.style.textDecoration).toBe("underline");

    title.dispatchEvent(new Event("pointerleave"));
    expect(title.style.textDecoration).toBe("");
    expect(bdi.style.textDecoration).toBe("");
  });

  it("does not double-bind when data-* is wiped but node is reused", () => {
    const { host, title } = mountTitle();
    const addSpy = vi.spyOn(title, "addEventListener");
    syncPathTitleChrome(host);
    const firstBindCalls = addSpy.mock.calls.filter(
      ([type]) => type === "pointerenter"
    ).length;
    expect(firstBindCalls).toBe(1);

    // Pierre may clear data-* while reusing the title node; CLEANUP_KEY still binds.
    for (const key of Object.keys(title.dataset)) {
      delete title.dataset[key];
    }
    syncPathTitleChrome(host);
    const afterRebind = addSpy.mock.calls.filter(
      ([type]) => type === "pointerenter"
    ).length;
    expect(afterRebind).toBe(1);

    title.dispatchEvent(new Event("pointerenter"));
    expect(title.style.textDecoration).toBe("underline");
    addSpy.mockRestore();
  });

  it("rebinds when the title node is replaced", () => {
    const { host, title } = mountTitle();
    syncPathTitleChrome(host);
    title.remove();

    const next = document.createElement("div");
    next.setAttribute("data-title", "");
    next.append(document.createElement("bdi"));
    host.shadowRoot?.append(next);

    syncPathTitleChrome(host);
    next.dispatchEvent(new Event("pointerenter"));
    expect(next.style.textDecoration).toBe("underline");
  });

  it("clears listeners and styles on clear", () => {
    const { host, title } = mountTitle();
    syncPathTitleChrome(host);
    title.dispatchEvent(new Event("pointerenter"));
    expect(title.style.textDecoration).toBe("underline");

    syncPathTitleChrome(host, true);
    expect(title.style.cursor).toBe("");
    expect(title.style.textDecoration).toBe("");
  });
});
