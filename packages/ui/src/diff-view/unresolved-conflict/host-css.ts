import { SCROLLBAR_SYSTEM_CSS } from "../../scrollbar-system.ts";

/** Natural-height host so the review pane, not each file, owns the scrollbar. */
export const CONFLICT_HOST_UNSAFE_CSS = `
${SCROLLBAR_SYSTEM_CSS}

  :host {
    color-scheme: light dark;
    height: auto;
    overflow: hidden;
  }

  pre, [data-code], [data-line], [data-content] {
    -webkit-user-select: text;
    user-select: text;
  }
`;
