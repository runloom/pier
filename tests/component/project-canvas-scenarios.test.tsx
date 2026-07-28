import { parsePierCanvasMeta } from "@shared/contracts/pier-canvas.ts";
import { PIER_CANVAS_EXPORT_NAMES } from "@shared/pier-canvas-export-names.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import * as pierCanvasModule from "../support/pier-canvas.ts";

/**
 * Renders every React canvas under `.pier/canvases` for real.
 *
 * Compiling a canvas only proves its imports resolve. Mounting it catches the
 * failures authors actually hit: a primitive used outside its required parent,
 * a hook misuse, a component rendered with props it does not accept.
 */
const CANVAS_MODULES = import.meta.glob<Record<string, unknown>>(
  "../../.pier/canvases/**/*.canvas.tsx",
  { eager: true }
);

afterEach(cleanup);

function displayPath(path: string): string {
  return path.replace("../../.pier/canvases/", "canvases/");
}

describe("project canvases render", () => {
  it("exposes exactly the whitelisted pier/canvas exports", () => {
    expect(Object.keys(pierCanvasModule).sort()).toEqual(
      [...PIER_CANVAS_EXPORT_NAMES].sort()
    );
  });

  it("finds the in-repo React canvases (smoke + blank)", () => {
    // Solid entries also end in .canvas.tsx and are excluded below.
    expect(Object.keys(CANVAS_MODULES).length).toBeGreaterThanOrEqual(2);
  });

  for (const [path, module] of Object.entries(CANVAS_MODULES)) {
    if (path.endsWith(".canvas.solid.tsx")) {
      continue;
    }

    it(`mounts ${displayPath(path)}`, () => {
      const Canvas = module.default as ComponentType | undefined;
      if (typeof Canvas !== "function") {
        throw new Error(`${path} must default-export a component`);
      }
      const { container } = render(<Canvas />);
      expect(container.firstChild).not.toBeNull();
    });

    it(`declares valid metadata in ${displayPath(path)}`, () => {
      expect(parsePierCanvasMeta(module.canvas)).not.toBeNull();
    });
  }

  it("switches the capability canvas between the three viewport modes", () => {
    const entry = Object.entries(CANVAS_MODULES).find(([path]) =>
      path.endsWith("/canvas-capabilities/canvas-capabilities.canvas.tsx")
    );
    expect(entry).toBeDefined();
    const Canvas = entry?.[1].default as ComponentType;
    const { container } = render(<Canvas />);
    expect(container.querySelector("style")?.textContent).toContain(
      "@scope ([data-canvas-capabilities])"
    );

    fireEvent.click(screen.getByRole("tab", { name: /边界/u }));
    fireEvent.click(screen.getByRole("tab", { name: "自由度" }));
    const preview = document.querySelector(".cc-shell-preview");
    expect(preview).toHaveAttribute("data-viewport", "full-bleed");

    fireEvent.click(screen.getByRole("button", { name: "文档" }));
    expect(preview).toHaveAttribute("data-viewport", "document");

    fireEvent.click(screen.getByRole("button", { name: "工作区" }));
    expect(preview).toHaveAttribute("data-viewport", "workspace");
  });

  it("keeps formal capability evidence separate from manual experience checks", () => {
    const entry = Object.entries(CANVAS_MODULES).find(([path]) =>
      path.endsWith("/canvas-capabilities/canvas-capabilities.canvas.tsx")
    );
    expect(entry).toBeDefined();
    const Canvas = entry?.[1].default as ComponentType;
    render(<Canvas />);

    fireEvent.click(screen.getByRole("tab", { name: /验证/u }));
    expect(screen.getByText("3 / 8 已验证")).toBeTruthy();
    expect(screen.getByText("0 / 6")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: /自由内容 UI.*导航、布局、视觉和局部状态由 Canvas 决定/u,
      })
    );
    expect(screen.getByText("1 / 6")).toBeTruthy();
    expect(screen.getByText("3 / 8 已验证")).toBeTruthy();
  });

  it("supports arrow-key navigation across the capability views", () => {
    const entry = Object.entries(CANVAS_MODULES).find(([path]) =>
      path.endsWith("/canvas-capabilities/canvas-capabilities.canvas.tsx")
    );
    expect(entry).toBeDefined();
    const Canvas = entry?.[1].default as ComponentType;
    render(<Canvas />);

    const overview = screen.getByRole("tab", { name: /概览/u });
    overview.focus();
    fireEvent.keyDown(overview, { key: "ArrowRight" });

    const playground = screen.getByRole("tab", { name: /试用/u });
    expect(playground).toHaveAttribute("aria-selected", "true");
    expect(playground).toHaveFocus();
  });
});
