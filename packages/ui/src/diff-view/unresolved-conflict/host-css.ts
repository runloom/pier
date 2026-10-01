import { CODE_VIEW_CUSTOM_CSS } from "../appearance.ts";

/** Natural-height host so the review pane, not each file, owns the scrollbar. */
export const CONFLICT_HOST_UNSAFE_CSS = `
${CODE_VIEW_CUSTOM_CSS}

  :host {
    color-scheme: light dark;
    height: auto;
    overflow: hidden;
  }

  /* File's native top inset must not add a second body gap inside CodeView. */
  pre[data-file] > [data-code], pre[data-file] > [data-gutter] {
    padding-block-start: 0;
  }

  /* The outer CodeView owns the file separator and its one bottom inset. */
  :host::after {
    content: none;
  }
`;
