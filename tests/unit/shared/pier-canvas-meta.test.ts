import { describe, expect, it } from "vitest";
import {
  parsePierCanvasMeta,
  pierCanvasMetaSchema,
} from "../../../src/shared/contracts/pier-canvas.ts";

describe("pier-canvas meta", () => {
  it("accepts composition / docs / kit", () => {
    expect(
      pierCanvasMetaSchema.parse({
        kind: "kit",
        title: "Component kit",
      }).kind
    ).toBe("kit");
    expect(
      parsePierCanvasMeta({
        description: "Checkout frame",
        kind: "composition",
        title: "Checkout",
      })
    ).toMatchObject({ kind: "composition", title: "Checkout" });
    expect(
      parsePierCanvasMeta({
        kind: "docs",
        title: "Button",
      })?.kind
    ).toBe("docs");
  });

  it("rejects unknown kind", () => {
    expect(parsePierCanvasMeta({ kind: "demo", title: "x" })).toBeNull();
    expect(parsePierCanvasMeta({ title: "missing kind" })).toBeNull();
  });
});
