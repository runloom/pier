/**
 * Shared layout for composer autocomplete (terminal-embedded Rich Input).
 *
 * Width model (Pier is a terminal tool, not a chat column):
 * 1. Chrome card spans the terminal strip (`inset-x-2`, full available width).
 * 2. Suggest portal width = 100% of that chrome (same edges as the input bar).
 *    Do not invent a separate popup max-width or center a chat-style 3xl column.
 * Height: list shell max-h ≈ Codex AtMentionList (~320px).
 */

/** Codex Nn shell: max-h-[320px] for non-home menus. */
export const COMPOSER_SUGGEST_MAX_HEIGHT_PX = 320;

/** Gap between list bottom edge and composer top edge. */
export const COMPOSER_SUGGEST_GAP_PX = 4;
