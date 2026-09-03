import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createGitGutterExtension } from "@plugins/builtin/files/renderer/editor/git-gutter.ts";
import { createGitGutterThemeResyncPlugin } from "@plugins/builtin/files/renderer/editor/git-gutter-theme-resync.ts";
import { createMinimapExtension } from "@plugins/builtin/files/renderer/editor/minimap.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 锁定 `patches/@replit__codemirror-minimap@0.5.2.patch` 的 window 监听纪律。
 *
 * 上游 OverlayView 在 create() 就向 window 挂 `mouseup` / `mousemove`，且
 * remove() 传的是未绑定的原型方法 → 监听永不摘除；每个销毁的 EditorView 连同
 * 整块面板 DOM 被 window 钉住（线上堆快照：42 个已 destroy 的 EditorView 全部
 * 由这两条监听保活）。补丁后：空闲编辑器不占任何 window 监听；仅拖拽期间挂，
 * 松手 / 销毁即以同一引用摘除。
 */

type Listener = EventListenerOrEventListenerObject;

function mouseListeners(calls: readonly [string, Listener][]) {
  return calls.filter(([type]) => type === "mouseup" || type === "mousemove");
}

describe("minimap overlay window listeners", () => {
  const added: [string, Listener][] = [];
  const removed: [string, Listener][] = [];
  let view: EditorView | null = null;

  beforeEach(() => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => "",
    } as unknown as CSSStyleDeclaration);
    const originalAdd = window.addEventListener.bind(window);
    const originalRemove = window.removeEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation(
      (type, listener, options) => {
        if (listener) {
          added.push([type, listener]);
        }
        originalAdd(type, listener, options);
      }
    );
    vi.spyOn(window, "removeEventListener").mockImplementation(
      (type, listener, options) => {
        if (listener) {
          removed.push([type, listener]);
        }
        originalRemove(type, listener, options);
      }
    );
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "a\nb\nc\n",
        extensions: [
          createGitGutterExtension(),
          createGitGutterThemeResyncPlugin(),
          createMinimapExtension(),
        ],
      }),
    });
  });

  afterEach(() => {
    view?.destroy();
    view = null;
    added.length = 0;
    removed.length = 0;
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  function overlay(): HTMLElement {
    const node = view?.dom.querySelector(".cm-minimap-overlay");
    if (!(node instanceof HTMLElement)) {
      throw new Error("minimap overlay not mounted");
    }
    return node;
  }

  it("keeps an idle editor free of window mouse listeners", () => {
    expect(mouseListeners(added)).toHaveLength(0);
  });

  it("attaches window listeners only while dragging and detaches on mouseup", () => {
    overlay().dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0, clientY: 10 })
    );
    const attached = mouseListeners(added);
    expect(attached.map(([type]) => type).sort()).toEqual([
      "mousemove",
      "mouseup",
    ]);

    window.dispatchEvent(new MouseEvent("mouseup"));
    for (const [type, listener] of attached) {
      expect(
        removed.some(([t, l]) => t === type && l === listener),
        `${type} listener must be removed with the same reference`
      ).toBe(true);
    }
  });

  it("detaches an in-flight drag when the view is destroyed", () => {
    overlay().dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0, clientY: 10 })
    );
    const attached = mouseListeners(added);
    expect(attached).toHaveLength(2);

    view?.destroy();
    view = null;

    for (const [type, listener] of attached) {
      expect(removed.some(([t, l]) => t === type && l === listener)).toBe(true);
    }
  });
});
