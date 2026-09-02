/**
 * Hide the dummy 1-line FileDiff; UnresolvedFile / File fills the annotation.
 * Nested Pierre hosts keep their own shadow, so these selectors cannot reach
 * conflict body lines.
 */
export const UNRESOLVED_CONFLICT_CODE_VIEW_CSS = `
  :host([data-pier-unresolved-conflict]) [data-line]:not([data-line-annotation]) {
    display: none !important;
  }

  :host([data-pier-unresolved-conflict]) [data-gutter]:not([data-gutter-buffer="annotation"]) {
    display: none !important;
  }

  :host([data-pier-unresolved-conflict]) [data-deletions] {
    display: none !important;
  }

  :host([data-pier-unresolved-conflict]) [data-diff-type="split"] {
    grid-template-columns: minmax(0, 1fr);
  }

  :host([data-pier-unresolved-conflict]) [data-diff-type="split"][data-overflow="wrap"] {
    grid-template-columns: var(--diffs-code-grid);
  }

  :host([data-pier-unresolved-conflict]) [data-diff-type="split"] [data-additions],
  :host([data-pier-unresolved-conflict]) [data-diff-type="split"] [data-deletions] {
    border-inline-width: 0;
  }

  :host([data-pier-unresolved-conflict]) [data-overflow="wrap"] [data-additions] [data-gutter],
  :host([data-pier-unresolved-conflict]) [data-overflow="wrap"] [data-deletions] [data-gutter] {
    grid-column: 1;
  }

  :host([data-pier-unresolved-conflict]) [data-overflow="wrap"] [data-additions] [data-content],
  :host([data-pier-unresolved-conflict]) [data-overflow="wrap"] [data-deletions] [data-content] {
    grid-column: 2;
  }

  :host([data-pier-unresolved-conflict]) [data-line-annotation] {
    padding-inline: 0;
  }

  :host([data-pier-unresolved-conflict]) [data-annotation-content] {
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    left: auto;
    position: relative;
  }
`;
