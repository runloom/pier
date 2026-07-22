import { afterEach, describe, expect, it, vi } from "vitest";
import { elementSoftWrapped } from "@/panel-kits/terminal/terminal-composer-helpers.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

interface BoxMetrics {
  height: number;
  lineHeight: number;
  paddingY?: number;
}

function stubBoxMetrics(
  entries: ReadonlyArray<readonly [HTMLElement, BoxMetrics]>
): void {
  const byEl = new Map(entries);
  for (const [el, metrics] of entries) {
    Object.defineProperty(el, "scrollHeight", {
      configurable: true,
      get: () => metrics.height,
    });
  }
  vi.spyOn(window, "getComputedStyle").mockImplementation(((
    target: Element
  ) => {
    const metrics = byEl.get(target as HTMLElement);
    const lineHeight = metrics?.lineHeight ?? 20;
    const paddingY = metrics?.paddingY ?? 0;
    return {
      lineHeight: `${lineHeight}px`,
      paddingBottom: `${paddingY / 2}px`,
      paddingTop: `${paddingY / 2}px`,
    } as CSSStyleDeclaration;
  }) as typeof getComputedStyle);
}

describe("elementSoftWrapped", () => {
  it("does not treat compact h-full shell height as soft wrap", () => {
    const shell = document.createElement("div");
    shell.contentEditable = "true";
    const paragraph = document.createElement("p");
    paragraph.textContent = "";
    shell.append(paragraph);
    document.body.append(shell);

    // Compact chrome: editable forced to ~36px (h-9); line-height shorter
    // than the shell. Measuring the shell would false-positive and oscillate.
    stubBoxMetrics([
      [shell, { height: 36, lineHeight: 20 }],
      [paragraph, { height: 20, lineHeight: 20 }],
    ]);

    expect(elementSoftWrapped(shell)).toBe(false);

    shell.remove();
  });

  it("detects a soft-wrapped paragraph taller than ~1.6 lines", () => {
    const shell = document.createElement("div");
    const paragraph = document.createElement("p");
    paragraph.textContent = "wrap me";
    shell.append(paragraph);
    document.body.append(shell);

    stubBoxMetrics([
      [shell, { height: 36, lineHeight: 20 }],
      [paragraph, { height: 40, lineHeight: 20 }],
    ]);

    expect(elementSoftWrapped(shell)).toBe(true);

    shell.remove();
  });
});
