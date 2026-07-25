import { styleTags, Tag } from "@lezer/highlight";

/**
 * Dedicated tags for Markdown *markup characters* so we can color `-` / `#` /
 * `>` / `*` / `` ` `` without dyeing list/heading body text.
 * Default lezer mapping dumps all of these into `processingInstruction`.
 */
export const mdHeadingMark = Tag.define();
export const mdListMark = Tag.define();
export const mdQuoteMark = Tag.define();
export const mdEmphasisMark = Tag.define();
export const mdCodeMark = Tag.define();
export const mdLinkMark = Tag.define();
export const mdTableDelimiter = Tag.define();
export const mdStrikethroughMark = Tag.define();

/** Passed to `markdown({ extensions })` — shared by settings + files. */
export const pierMarkdownMarkExtension = {
  props: [
    styleTags({
      HeaderMark: mdHeadingMark,
      ListMark: mdListMark,
      QuoteMark: mdQuoteMark,
      EmphasisMark: mdEmphasisMark,
      CodeMark: mdCodeMark,
      LinkMark: mdLinkMark,
      TableDelimiter: mdTableDelimiter,
      StrikethroughMark: mdStrikethroughMark,
    }),
  ],
};
