import { parsePierCanvasMeta } from "@shared/contracts/pier-canvas.ts";
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";

const TEMPLATE_MODULES = import.meta.glob<Record<string, unknown>>(
  "../../resources/system-skills/pier-canvas/templates/*.canvas.tsx",
  { eager: true }
);

afterEach(cleanup);

describe("bundled Pier Canvas templates", () => {
  it("direct-mounts one template for every Canvas kind against the host export facade", () => {
    const kinds = new Set<string>();

    for (const [path, module] of Object.entries(TEMPLATE_MODULES)) {
      const Canvas = module.default as ComponentType | undefined;
      if (typeof Canvas !== "function") {
        throw new Error(`${path} must default-export a component`);
      }
      const metadata = parsePierCanvasMeta(module.canvas);
      expect(
        metadata,
        `${path} must export valid Canvas metadata`
      ).not.toBeNull();
      if (metadata) {
        kinds.add(metadata.kind);
      }

      const { container, unmount } = render(<Canvas />);
      expect(container.firstChild, `${path} must mount content`).not.toBeNull();
      unmount();
    }

    expect([...kinds].sort()).toEqual(["composition", "docs", "kit"]);
  });
});
