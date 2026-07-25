import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import {
  mdCodeMark,
  mdEmphasisMark,
  mdHeadingMark,
  mdLinkMark,
  mdListMark,
  mdQuoteMark,
  mdStrikethroughMark,
  mdTableDelimiter,
} from "./markdown-marks.ts";

/**
 * Shared CodeMirror syntax palette (Pier semantic CSS variables).
 * Used by the files plugin editor and settings Rules/Skills source editor.
 *
 * Markdown policy: keep prose/list *body* as foreground; color markup marks
 * (`#`, `-`, `>`, `*`, backticks) via dedicated tags from markdown-marks.ts.
 */
export const pierSyntaxHighlightStyle = HighlightStyle.define([
  {
    tag: [t.lineComment, t.blockComment, t.docComment, t.comment],
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
  {
    tag: [t.string, t.docString, t.character, t.attributeValue],
    color: "var(--success)",
  },
  {
    tag: [t.regexp, t.escape],
    color: "var(--warning)",
  },
  {
    tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.unit],
    color: "var(--info)",
  },
  {
    tag: [
      t.keyword,
      t.self,
      t.definitionKeyword,
      t.moduleKeyword,
      t.controlKeyword,
      t.operatorKeyword,
      t.modifier,
    ],
    color: "var(--done)",
  },
  {
    tag: [
      t.operator,
      t.arithmeticOperator,
      t.logicOperator,
      t.bitwiseOperator,
      t.compareOperator,
      t.updateOperator,
      t.controlOperator,
      t.typeOperator,
      t.derefOperator,
      t.definitionOperator,
    ],
    color: "var(--foreground)",
  },
  {
    tag: [t.punctuation, t.separator],
    color: "var(--muted-foreground)",
  },
  {
    tag: [t.bracket, t.paren, t.brace, t.squareBracket, t.angleBracket],
    color: "var(--muted-foreground)",
  },
  {
    tag: [t.variableName, t.propertyName],
    color: "var(--foreground)",
  },
  {
    // Fence language id (` ```ts `) / link labels — make visible.
    tag: t.labelName,
    color: "var(--warning)",
  },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.definition(t.variableName)),
      t.function(t.propertyName),
      t.function(t.definition(t.propertyName)),
      t.standard(t.variableName),
    ],
    color: "var(--info)",
  },
  {
    tag: [t.constant(t.variableName), t.constant(t.name)],
    color: "var(--info)",
  },
  {
    tag: [t.typeName, t.className, t.namespace, t.tagName, t.macroName],
    color: "var(--warning)",
  },
  {
    tag: t.attributeName,
    color: "var(--info)",
  },
  {
    tag: [t.meta, t.annotation, t.documentMeta, t.processingInstruction],
    color: "var(--muted-foreground)",
  },

  // —— Markdown structure (body) ——
  {
    tag: t.heading1,
    color: "var(--done)",
    fontWeight: "700",
    fontSize: "1.15em",
  },
  {
    tag: t.heading2,
    color: "var(--done)",
    fontWeight: "700",
    fontSize: "1.08em",
  },
  {
    tag: [t.heading, t.heading3, t.heading4, t.heading5, t.heading6],
    color: "var(--done)",
    fontWeight: "600",
  },
  {
    tag: t.emphasis,
    color: "var(--info)",
    fontStyle: "italic",
  },
  {
    tag: t.strong,
    color: "var(--done)",
    fontWeight: "700",
  },
  {
    tag: [t.link, t.url],
    color: "var(--info)",
    textDecoration: "underline",
  },
  {
    tag: [t.monospace],
    color: "var(--success)",
  },
  {
    tag: t.strikethrough,
    color: "var(--muted-foreground)",
    textDecoration: "line-through",
  },
  // Quote body slightly muted (not the same as plain paragraphs).
  {
    tag: t.quote,
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
  // HR
  {
    tag: t.contentSeparator,
    color: "var(--muted-foreground)",
  },
  // List/paragraph body stays foreground on purpose (do not dye whole lists).
  {
    tag: [t.list, t.content],
    color: "var(--foreground)",
  },

  // —— Markdown markup characters (marks only) ——
  {
    tag: mdHeadingMark,
    color: "var(--done)",
    fontWeight: "700",
  },
  {
    tag: mdListMark,
    color: "var(--info)",
    fontWeight: "700",
  },
  {
    tag: mdQuoteMark,
    color: "var(--muted-foreground)",
    fontWeight: "700",
  },
  {
    tag: mdEmphasisMark,
    color: "var(--muted-foreground)",
  },
  {
    tag: mdCodeMark,
    color: "var(--muted-foreground)",
  },
  {
    tag: mdLinkMark,
    color: "var(--info)",
  },
  {
    tag: mdTableDelimiter,
    color: "var(--muted-foreground)",
  },
  {
    tag: mdStrikethroughMark,
    color: "var(--muted-foreground)",
  },

  {
    tag: t.inserted,
    color: "var(--success)",
  },
  {
    tag: t.deleted,
    color: "var(--destructive)",
  },
  {
    tag: t.changed,
    color: "var(--warning)",
  },
  {
    tag: t.invalid,
    color: "var(--destructive)",
    textDecoration: "underline wavy",
  },
]);
