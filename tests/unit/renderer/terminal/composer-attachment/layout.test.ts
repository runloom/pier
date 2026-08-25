import { describe, expect, it } from "vitest";
import {
  COMPOSER_ATTACHMENT_TILE_SIZE_PX,
  measureComposerImageTileSize,
} from "@/panel-kits/terminal/composer-attachment/layout.ts";

describe("measureComposerImageTileSize", () => {
  it("contain-fits a landscape screenshot into the square cell", () => {
    const size = measureComposerImageTileSize({ height: 1080, width: 1920 });
    expect(size.contentWidth).toBe(COMPOSER_ATTACHMENT_TILE_SIZE_PX);
    expect(size.contentHeight).toBeLessThan(COMPOSER_ATTACHMENT_TILE_SIZE_PX);
  });

  it("does not upscale a tiny glyph; tile stays the square cell", () => {
    const size = measureComposerImageTileSize({ height: 16, width: 16 });
    expect(size.contentWidth).toBe(16);
    expect(size.contentHeight).toBe(16);
  });

  it("keeps a portrait screenshot fully visible in the square cell", () => {
    const size = measureComposerImageTileSize({ height: 1920, width: 1080 });
    expect(size.contentHeight).toBe(COMPOSER_ATTACHMENT_TILE_SIZE_PX);
    expect(size.contentWidth).toBeLessThan(size.contentHeight);
  });
});
