/**
 * Task-list checkbox write-back helpers for the Markdown preview.
 *
 * The preview is the only content-editing channel for Markdown documents, and
 * task checkboxes are its single interactive edit affordance. `patchTaskMarker`
 * performs a byte-minimal marker flip inside the IR-supplied source range so
 * the rest of the document is never reflowed; it returns the original string
 * when no GFM task marker exists in the slice (defensive against IR/drift
 * mismatches).
 */

export interface TaskRange {
  end: number;
  start: number;
}

export interface TaskToggleInput {
  checked: boolean;
  rangeEnd: number;
  rangeStart: number;
}

/**
 * Flip the first `[ ]` / `[x]` / `[X]` marker inside `range` of `contents` to
 * `[x]` (when `checked`) or `[ ]` (when unchecked). Normalizes uppercase `X`
 * to lowercase `x` on check and to a space on uncheck. Never reflows bytes
 * outside the marker; returns `contents` unchanged when no marker is found.
 */
export function patchTaskMarker(
  contents: string,
  range: TaskRange,
  checked: boolean
): string {
  const slice = contents.slice(range.start, range.end);
  const marker = /\[( |x|X)\]/.exec(slice);
  if (!marker) return contents;
  const next = `[${checked ? "x" : " "}]`;
  const patchedSlice =
    slice.slice(0, marker.index) +
    next +
    slice.slice(marker.index + marker[0].length);
  return (
    contents.slice(0, range.start) + patchedSlice + contents.slice(range.end)
  );
}
