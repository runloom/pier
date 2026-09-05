/** Shared trailing space for source lines and inline file tools. */
export const FILES_EDITOR_END_INSET_PX = 16;
export const FILES_EDITOR_NARROW_END_INSET_PX = 12;

export function filesEditorEndInset(width: number): number {
  return width < 520
    ? FILES_EDITOR_NARROW_END_INSET_PX
    : FILES_EDITOR_END_INSET_PX;
}
