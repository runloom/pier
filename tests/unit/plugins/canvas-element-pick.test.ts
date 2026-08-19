/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { findPinForCanvasPick } from "../../../src/plugins/builtin/files/renderer/preview/canvas-comment-locate.ts";
import type { CanvasCommentPinView } from "../../../src/plugins/builtin/files/renderer/preview/canvas-comment-pins.tsx";
// CanvasCommentThreadView includes optional label
import {
  buildCanvasPickChain,
  clampPickDepth,
  clientPointInShell,
  defaultPickDepth,
  findCanvasElementByLabel,
  geometryHitTestCanvasElement,
  hitTestCanvasElement,
  measureCanvasPickBox,
  pickFromCanvasElement,
  pinPointFromBox,
  refineCanvasLayoutHit,
  resolveCanvasElementPick,
  resolveCanvasPickAtPoint,
  snapshotCanvasElementPick,
} from "../../../src/plugins/builtin/files/renderer/preview/canvas-element-pick.ts";

function mockBox(
  el: HTMLElement,
  box: { left: number; top: number; width: number; height: number }
): void {
  el.getBoundingClientRect = () =>
    ({
      left: box.left,
      top: box.top,
      right: box.left + box.width,
      bottom: box.top + box.height,
      width: box.width,
      height: box.height,
      x: box.left,
      y: box.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function mouseEvent(target: EventTarget): MouseEvent {
  return {
    target,
  } as MouseEvent;
}

describe("resolveCanvasElementPick", () => {
  it("returns null for empty host path", () => {
    const host = document.createElement("div");
    expect(resolveCanvasElementPick(host, mouseEvent(host))).toBeNull();
  });

  it("picks deepest element and builds label from text", () => {
    const host = document.createElement("div");
    host.innerHTML = `<button type="button">Save draft</button>`;
    const button = host.querySelector("button");
    expect(button).toBeTruthy();
    const pick = resolveCanvasElementPick(host, mouseEvent(button!));
    expect(pick).toEqual({
      excerpt: "Save draft",
      label: "Save draft",
    });
  });

  it("prefers declared data-pier-comment-id ancestor", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <section data-pier-comment-id="hero">
        <h1>Welcome</h1>
        <span>sub</span>
      </section>
    `;
    const span = host.querySelector("span");
    const pick = resolveCanvasElementPick(host, mouseEvent(span!));
    expect(pick?.anchorId).toBe("hero");
    expect(pick?.label).toBe("Welcome sub");
  });

  it("prefers aria-label over raw text", () => {
    const host = document.createElement("div");
    host.innerHTML = `<button aria-label="Close dialog" type="button">×</button>`;
    const button = host.querySelector("button");
    const pick = resolveCanvasElementPick(host, mouseEvent(button!));
    expect(pick?.label).toBe("Close dialog");
    expect(pick?.excerpt).toContain("Close dialog");
  });

  it("ignores overlay chrome targets", () => {
    const host = document.createElement("div");
    const chrome = document.createElement("div");
    chrome.setAttribute("data-slot", "canvas-comment-pick-chrome");
    chrome.textContent = "hint";
    host.append(chrome);
    expect(resolveCanvasElementPick(host, mouseEvent(chrome))).toBeNull();
  });
});

describe("buildCanvasPickChain + depth", () => {
  it("builds leaf-to-ancestor chain and clamps depth", () => {
    const host = document.createElement("div");
    host.innerHTML = `<section><div><button type="button">Go</button></div></section>`;
    const button = host.querySelector("button") as HTMLElement;
    const chain = buildCanvasPickChain(host, button);
    expect(chain).not.toBeNull();
    expect(chain!.chain[0]).toBe(button);
    expect(chain!.chain.length).toBeGreaterThanOrEqual(2);
    expect(clampPickDepth(chain!.chain, -1)).toBe(0);
    expect(clampPickDepth(chain!.chain, 99)).toBe(chain!.chain.length - 1);
    // button is interactive → default depth 0
    expect(defaultPickDepth(host, chain!.chain)).toBe(0);
  });

  it("prefers outer mermaid-diagram surface over inner svg host", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <div data-slot="mermaid-diagram" role="img" aria-label="架构图">
        <div data-slot="mermaid-diagram-svg"><svg><g></g></svg></div>
        <button type="button">expand</button>
      </div>
    `;
    const svgHost = host.querySelector(
      "[data-slot='mermaid-diagram-svg']"
    ) as HTMLElement;
    const surface = host.querySelector(
      "[data-slot='mermaid-diagram']"
    ) as HTMLElement;
    const chain = buildCanvasPickChain(host, svgHost);
    expect(chain).not.toBeNull();
    const depth = defaultPickDepth(host, chain!.chain);
    expect(chain!.chain[depth]).toBe(surface);
  });

  it("promotes Alert title and description to the alert banner", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <div data-slot="alert" role="alert">
        <span data-slot="status-icon"></span>
        <div data-slot="alert-body">
          <div data-slot="alert-title">物料在 SDK 里，不在人眼前</div>
          <div data-slot="alert-description">生成合同只允许 import pier/canvas、react、相对路径。</div>
        </div>
      </div>
    `;
    const alert = host.querySelector("[data-slot='alert']") as HTMLElement;
    const title = host.querySelector(
      "[data-slot='alert-title']"
    ) as HTMLElement;
    const description = host.querySelector(
      "[data-slot='alert-description']"
    ) as HTMLElement;
    const icon = host.querySelector("[data-slot='status-icon']") as HTMLElement;
    const picked = (leaf: HTMLElement): HTMLElement | undefined => {
      const chain = buildCanvasPickChain(host, leaf);
      return chain?.chain[defaultPickDepth(host, chain.chain)];
    };
    expect(picked(title)).toBe(alert);
    expect(picked(description)).toBe(alert);
    expect(picked(icon)).toBe(alert);
    expect(pickFromCanvasElement(host, title)?.label).toContain(
      "物料在 SDK 里，不在人眼前"
    );
  });

  it("keeps a paragraph inside an alert selectable", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <div data-slot="alert" role="alert">
        <p>本段仍可单独标注</p>
      </div>
    `;
    const para = host.querySelector("p") as HTMLElement;
    const chain = buildCanvasPickChain(host, para);
    expect(chain).not.toBeNull();
    expect(defaultPickDepth(host, chain!.chain)).toBe(0);
    expect(chain!.chain[0]).toBe(para);
    expect(pickFromCanvasElement(host, para)?.label).toBe("本段仍可单独标注");
  });

  it("keeps leaf text under item/card (no forced shell promotion)", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <div data-slot="item">
        <div data-slot="item-content">
          <div data-slot="item-title"><span>W2 一次性 agents invoke</span></div>
          <p data-slot="item-description">outcome text</p>
        </div>
      </div>
    `;
    const span = host.querySelector("span") as HTMLElement;
    const chain = buildCanvasPickChain(host, span);
    expect(chain).not.toBeNull();
    // DevTools-like: default is what is under the cursor, not the whole card.
    expect(defaultPickDepth(host, chain!.chain)).toBe(0);
    expect(chain!.chain[0]).toBe(span);
  });

  it("gap click on a tabpanel/stack picks the nearest child, not the page", () => {
    const host = document.createElement("div");
    const panel = document.createElement("div");
    panel.setAttribute("data-slot", "tabs-content");
    panel.setAttribute("role", "tabpanel");
    const stack = document.createElement("div");
    stack.setAttribute("data-slot", "stack");
    stack.style.display = "flex";
    const heading = document.createElement("h2");
    heading.textContent = "为什么要砍";
    const para = document.createElement("p");
    para.textContent = "八屏把目录做成产品页。";
    stack.append(heading, para);
    panel.append(stack);
    host.append(panel);
    document.body.append(host);

    mockBox(host, { left: 0, top: 0, width: 400, height: 400 });
    mockBox(panel, { left: 0, top: 0, width: 400, height: 400 });
    mockBox(stack, { left: 0, top: 0, width: 400, height: 360 });
    mockBox(heading, { left: 8, top: 20, width: 200, height: 24 });
    mockBox(para, { left: 8, top: 80, width: 300, height: 40 });

    const originalFromPoint = document.elementFromPoint;
    const originalFromPoints = document.elementsFromPoint;
    document.elementsFromPoint = (() => [
      stack,
      panel,
      host,
    ]) as typeof document.elementsFromPoint;
    document.elementFromPoint = (() =>
      stack) as typeof document.elementFromPoint;

    const hit = hitTestCanvasElement(host, 20, 55);
    expect(hit).toBe(heading);
    const pick = resolveCanvasPickAtPoint(host, 20, 55);
    expect(pick?.pick.label).toBe("为什么要砍");
    expect(refineCanvasLayoutHit(host, panel, 20, 55)).toBe(heading);

    if (originalFromPoint) {
      document.elementFromPoint = originalFromPoint;
    } else {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
    if (originalFromPoints) {
      document.elementsFromPoint = originalFromPoints;
    } else {
      Reflect.deleteProperty(document, "elementsFromPoint");
    }
    host.remove();
  });

  it("does not snap a card surface to inner copy when clicking card padding", () => {
    const host = document.createElement("div");
    const card = document.createElement("div");
    card.setAttribute("data-slot", "card");
    const title = document.createElement("h3");
    title.textContent = "去掉";
    card.append(title);
    host.append(card);
    document.body.append(host);

    mockBox(host, { left: 0, top: 0, width: 400, height: 400 });
    mockBox(card, { left: 0, top: 0, width: 300, height: 120 });
    mockBox(title, { left: 8, top: 8, width: 80, height: 20 });

    const originalFromPoint = document.elementFromPoint;
    const originalFromPoints = document.elementsFromPoint;
    document.elementsFromPoint = (() => [
      card,
      host,
    ]) as typeof document.elementsFromPoint;
    document.elementFromPoint = (() =>
      card) as typeof document.elementFromPoint;

    const hit = hitTestCanvasElement(host, 24, 80);
    expect(hit).toBe(card);

    if (originalFromPoint) {
      document.elementFromPoint = originalFromPoint;
    } else {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
    if (originalFromPoints) {
      document.elementsFromPoint = originalFromPoints;
    } else {
      Reflect.deleteProperty(document, "elementsFromPoint");
    }
    host.remove();
  });

  it("does not promote heading copy to a tabpanel ancestor", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <div data-slot="tabs-content" role="tabpanel" tabindex="0">
        <p>本页：为何砍屏、人只做什么、三块界面。</p>
        <h2>为什么要砍</h2>
        <p>八屏把目录做成产品页。</p>
      </div>
    `;
    const heading = host.querySelector("h2") as HTMLElement;
    const chain = buildCanvasPickChain(host, heading);
    expect(chain).not.toBeNull();
    expect(defaultPickDepth(host, chain!.chain)).toBe(0);
    const pick = pickFromCanvasElement(host, heading);
    expect(pick?.label).toBe("为什么要砍");
  });

  it("never vetoes: unknown wrapper still picks leaf at depth 0", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div class="mystery"><i class="icon"></i></div>`;
    const icon = host.querySelector("i") as HTMLElement;
    const chain = buildCanvasPickChain(host, icon);
    expect(chain).not.toBeNull();
    expect(defaultPickDepth(host, chain!.chain)).toBe(0);
    expect(chain!.chain[0]).toBe(icon);
  });

  it("snapshot at ancestor depth keeps label from that node", () => {
    const host = document.createElement("div");
    host.innerHTML = `<section aria-label="Card"><span>inner</span></section>`;
    const span = host.querySelector("span") as HTMLElement;
    const chain = buildCanvasPickChain(host, span)!;
    const section = chain.chain.find((el) => el.tagName === "SECTION")!;
    const depth = chain.chain.indexOf(section);
    const pick = snapshotCanvasElementPick(
      host,
      chain.chain[depth]!,
      chain.chain
    );
    expect(pick.label).toBe("Card");
  });
});

describe("pickFromCanvasElement", () => {
  it("prefers interactive over plain text span", () => {
    const host = document.createElement("div");
    host.innerHTML = `<button type="button"><span>OK</span></button>`;
    const span = host.querySelector("span");
    const pick = pickFromCanvasElement(host, span);
    expect(pick?.label).toBe("OK");
  });
});

describe("resolveCanvasPickAtPoint", () => {
  it("sees through a pick layer via pointer-events toggle", () => {
    const host = document.createElement("div");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Target";
    host.append(button);
    document.body.append(host);

    const layer = document.createElement("div");
    document.body.append(layer);

    const originalFromPoint = document.elementFromPoint;
    const originalFromPoints = document.elementsFromPoint;
    let calls = 0;
    document.elementsFromPoint = ((_x: number, _y: number) => {
      calls += 1;
      if (layer.style.pointerEvents === "none") {
        return [button];
      }
      return [layer, button];
    }) as typeof document.elementsFromPoint;
    document.elementFromPoint = ((_x: number, _y: number) => {
      calls += 1;
      if (layer.style.pointerEvents === "none") {
        return button;
      }
      return layer;
    }) as typeof document.elementFromPoint;

    const hit = resolveCanvasPickAtPoint(host, 40, 20, layer);
    expect(hit?.pick.label).toBe("Target");
    expect(calls).toBeGreaterThan(0);
    expect(layer.style.pointerEvents).not.toBe("none");

    if (originalFromPoint) {
      document.elementFromPoint = originalFromPoint;
    } else {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
    if (originalFromPoints) {
      document.elementsFromPoint = originalFromPoints;
    } else {
      Reflect.deleteProperty(document, "elementsFromPoint");
    }
    layer.remove();
    host.remove();
  });

  it("skips ignorable overlay nodes via elementsFromPoint stack", () => {
    const host = document.createElement("div");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Under";
    host.append(button);
    document.body.append(host);

    const badge = document.createElement("div");
    badge.setAttribute("data-pier-canvas-pick-box", "");
    document.body.append(badge);

    const original = document.elementsFromPoint;
    document.elementsFromPoint = (() => [
      badge,
      button,
    ]) as typeof document.elementsFromPoint;

    const hit = hitTestCanvasElement(host, 1, 1);
    expect(hit).toBe(button);

    if (original) {
      document.elementsFromPoint = original;
    } else {
      Reflect.deleteProperty(document, "elementsFromPoint");
    }
    badge.remove();
    host.remove();
  });
});

describe("hitTestCanvasElement", () => {
  it("returns null when point APIs are unavailable or miss host", () => {
    const host = document.createElement("div");
    document.body.append(host);
    Reflect.deleteProperty(document, "elementsFromPoint");
    Reflect.deleteProperty(document, "elementFromPoint");
    expect(hitTestCanvasElement(host, 0, 0)).toBeNull();
    document.elementsFromPoint = () => [];
    document.elementFromPoint = () => null;
    expect(hitTestCanvasElement(host, -1000, -1000)).toBeNull();
    Reflect.deleteProperty(document, "elementsFromPoint");
    Reflect.deleteProperty(document, "elementFromPoint");
    host.remove();
  });

  it("falls back to geometry when elementsFromPoint returns empty", () => {
    const host = document.createElement("div");
    const card = document.createElement("div");
    card.setAttribute("data-slot", "item");
    card.textContent = "W3 card";
    host.append(card);
    document.body.append(host);
    mockBox(host, { left: 0, top: 0, width: 400, height: 400 });
    mockBox(card, { left: 10, top: 20, width: 200, height: 80 });

    document.elementsFromPoint =
      (() => []) as typeof document.elementsFromPoint;
    document.elementFromPoint = (() =>
      null) as typeof document.elementFromPoint;

    const hit = hitTestCanvasElement(host, 50, 40);
    expect(hit).toBe(card);

    Reflect.deleteProperty(document, "elementsFromPoint");
    Reflect.deleteProperty(document, "elementFromPoint");
    host.remove();
  });
});

describe("geometryHitTestCanvasElement", () => {
  it("picks the smallest box containing the point", () => {
    const host = document.createElement("div");
    const outer = document.createElement("div");
    const inner = document.createElement("span");
    inner.textContent = "title";
    outer.append(inner);
    host.append(outer);
    document.body.append(host);
    mockBox(host, { left: 0, top: 0, width: 500, height: 500 });
    mockBox(outer, { left: 0, top: 0, width: 300, height: 100 });
    mockBox(inner, { left: 8, top: 8, width: 40, height: 16 });

    const hit = geometryHitTestCanvasElement(host, 20, 12);
    expect(hit).toBe(inner);
    host.remove();
  });
});

describe("measureCanvasPickBox", () => {
  it("returns geometry relative to shell without mutating the element", () => {
    const shell = document.createElement("div");
    const child = document.createElement("div");
    child.textContent = "Box";
    shell.append(child);
    document.body.append(shell);
    const before = child.getAttribute("style");
    const box = measureCanvasPickBox(child, shell);
    expect(box.label).toBe("Box");
    expect(typeof box.left).toBe("number");
    expect(child.getAttribute("style")).toBe(before);
    shell.remove();
  });
});

describe("clientPointInShell", () => {
  it("maps the pointer into overlay coordinates including scroll", () => {
    const shell = document.createElement("div");
    document.body.append(shell);
    mockBox(shell, { height: 200, left: 40, top: 20, width: 300 });
    Object.defineProperty(shell, "scrollLeft", { value: 16 });
    Object.defineProperty(shell, "scrollTop", { value: 8 });
    expect(clientPointInShell(shell, 100, 60)).toEqual({ x: 76, y: 48 });
    shell.remove();
  });
});

describe("findCanvasElementByLabel", () => {
  it("re-locates the compact element matching pick label", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <section><h1>Other</h1></section>
      <button type="button">日路径：四步最短调用</button>
    `;
    document.body.append(host);
    const found = findCanvasElementByLabel(host, "日路径：四步最短调用");
    expect(found?.tagName).toBe("BUTTON");
    expect(pinPointFromBox({ left: 10, top: 20, width: 100 })).toEqual({
      left: 110,
      top: 20,
    });
    host.remove();
  });

  it("re-locates a long alert after the stored label is truncated", () => {
    const host = document.createElement("div");
    const alert = document.createElement("div");
    alert.setAttribute("data-slot", "alert");
    alert.setAttribute("role", "alert");
    const title = document.createElement("div");
    title.setAttribute("data-slot", "alert-title");
    title.textContent = "物料在 SDK 里，不在人眼前";
    const description = document.createElement("div");
    description.setAttribute("data-slot", "alert-description");
    description.textContent =
      "生成合同只允许 import pier/canvas、react、相对路径。pier/canvas 已有约 150 个 UI 导出和 useCanvasFile，但设置里只有预览根目录卡。上一版把看见面做成顶栏新区、三家族分页面廊和并排 Kit，发现模型仍与技能库脱节。";
    alert.append(title, description);
    host.append(alert);
    document.body.append(host);

    const pick = snapshotCanvasElementPick(host, alert);
    expect(pick.label.endsWith("…")).toBe(true);
    expect(findCanvasElementByLabel(host, pick.label)).toBe(alert);
    expect(findCanvasElementByLabel(host, pick.label, pick.excerpt)).toBe(
      alert
    );

    const descPick = snapshotCanvasElementPick(host, description);
    expect(descPick.label.endsWith("…")).toBe(true);
    const rematch = findCanvasElementByLabel(host, descPick.label);
    expect(rematch).toBe(description);
    host.remove();
  });

  it("does not rematch a truncated other-tab label onto an unrelated alert", () => {
    const host = document.createElement("div");
    const alert = document.createElement("div");
    alert.setAttribute("data-slot", "alert");
    alert.setAttribute("role", "alert");
    alert.textContent = "研究收敛 共同结论：一次性用原生 agent。";
    host.append(alert);
    document.body.append(host);
    expect(
      findCanvasElementByLabel(
        host,
        "物料在 SDK 里，不在人眼前 生成合同只允许 import pier/canvas、react、相对路径。pier/canvas 已有约 150 个 UI 导出和 useC…"
      )
    ).toBeNull();
    host.remove();
  });
});

describe("findPinForCanvasPick", () => {
  it("matches an existing pin by label so pick opens prior thread", () => {
    const host = document.createElement("div");
    host.innerHTML = `<button type="button">落地</button>`;
    document.body.append(host);
    const button = host.querySelector("button") as HTMLElement;
    const pins: CanvasCommentPinView[] = [
      {
        index: 1,
        key: "picked-t1",
        left: 10,
        threads: [
          {
            comment: {
              authorLabel: "You",
              body: "333",
              createdAt: 1,
              id: "c1",
            },
            label: "落地",
            threadId: "t1",
          },
        ],
        title: "落地",
        top: 10,
      },
    ];
    const hit = findPinForCanvasPick(
      host,
      { excerpt: "落地", label: "落地" },
      button,
      pins
    );
    expect(hit?.key).toBe("picked-t1");
    host.remove();
  });

  it("does not open a sibling tab pin when picking another tab", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <nav>
        <button type="button">设计</button>
        <button type="button">落地</button>
      </nav>
    `;
    document.body.append(host);
    const design = host.querySelectorAll("button")[0] as HTMLElement;
    const pins: CanvasCommentPinView[] = [
      {
        index: 1,
        key: "picked-land",
        left: 10,
        threads: [
          {
            comment: {
              authorLabel: "You",
              body: "22",
              createdAt: 1,
              id: "c1",
            },
            label: "落地",
            threadId: "t1",
          },
        ],
        title: "落地",
        top: 10,
      },
    ];
    const hit = findPinForCanvasPick(
      host,
      { excerpt: "设计", label: "设计" },
      design,
      pins
    );
    expect(hit).toBeNull();
    host.remove();
  });

  it("does not match when pick sits under a shared nav but labels differ", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <nav data-tabs>
        <button type="button">设计</button>
        <button type="button">落地</button>
      </nav>
    `;
    document.body.append(host);
    const design = host.querySelectorAll("button")[0] as HTMLElement;
    const nav = host.querySelector("nav") as HTMLElement;
    const pins: CanvasCommentPinView[] = [
      {
        index: 1,
        key: "picked-land",
        left: 10,
        threads: [
          {
            comment: {
              authorLabel: "You",
              body: "22",
              createdAt: 1,
              id: "c1",
            },
            label: "落地",
            threadId: "t1",
          },
        ],
        title: "落地",
        top: 10,
      },
    ];
    // Even if re-locate wrongly pointed at nav, label gate must reject 设计 vs 落地.
    expect(nav.contains(design)).toBe(true);
    const hit = findPinForCanvasPick(
      host,
      { excerpt: "设计", label: "设计" },
      design,
      pins
    );
    expect(hit).toBeNull();
    host.remove();
  });
});
