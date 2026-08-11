/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  clearCanvasPickHighlight,
  resolveCanvasElementPick,
  setCanvasPickHighlight,
} from "../../../src/plugins/builtin/files/renderer/preview/canvas-element-pick.ts";

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

describe("setCanvasPickHighlight", () => {
  it("applies and clears outline on host descendants", () => {
    const host = document.createElement("div");
    const child = document.createElement("div");
    host.append(child);
    setCanvasPickHighlight(host, child);
    expect(child.getAttribute("data-pier-canvas-pick-highlight")).toBe("");
    clearCanvasPickHighlight(host);
    expect(child.getAttribute("data-pier-canvas-pick-highlight")).toBeNull();
  });
});
