/** Uniform filmstrip cell — every surface is this square. */
export const COMPOSER_ATTACHMENT_TILE_SIZE_PX = 48;

export interface ComposerImageTileSize {
  contentHeight: number;
  contentWidth: number;
}

/**
 * Contain-fit an image into the square cell without upscaling.
 * The tile is always the square; content may letterbox inside.
 */
export function measureComposerImageTileSize(input: {
  height: number;
  width: number;
}): ComposerImageTileSize {
  const naturalWidth = Math.max(0, input.width);
  const naturalHeight = Math.max(0, input.height);
  const tile = COMPOSER_ATTACHMENT_TILE_SIZE_PX;
  if (naturalWidth < 1 || naturalHeight < 1) {
    return {
      contentHeight: tile,
      contentWidth: tile,
    };
  }
  const scale = Math.min(tile / naturalWidth, tile / naturalHeight, 1);
  return {
    contentHeight: Math.max(1, Math.round(naturalHeight * scale)),
    contentWidth: Math.max(1, Math.round(naturalWidth * scale)),
  };
}
