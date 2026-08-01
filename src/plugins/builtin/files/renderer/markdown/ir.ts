export const MARKDOWN_IR_VERSION = 1 as const;

export interface MarkdownSourceRange {
  endLine: number;
  endOffset: number;
  startLine: number;
  startOffset: number;
}

interface MarkdownNodeBase {
  range: MarkdownSourceRange;
}

export type MarkdownInline =
  | (MarkdownNodeBase & { kind: "text"; value: string })
  | (MarkdownNodeBase & { kind: "inlineCode"; value: string })
  | (MarkdownNodeBase & { kind: "inlineMath"; value: string })
  | (MarkdownNodeBase & { kind: "break" })
  | (MarkdownNodeBase & { children: MarkdownInline[]; kind: "emphasis" })
  | (MarkdownNodeBase & { children: MarkdownInline[]; kind: "strong" })
  | (MarkdownNodeBase & { children: MarkdownInline[]; kind: "delete" })
  | (MarkdownNodeBase & {
      children: MarkdownInline[];
      kind: "link";
      title: string | null;
      url: string;
    })
  | (MarkdownNodeBase & {
      alt: string;
      kind: "image";
      title: string | null;
      url: string;
    })
  | (MarkdownNodeBase & {
      identifier: string;
      kind: "footnoteReference";
      label: string;
    })
  | (MarkdownNodeBase & { kind: "html"; value: string })
  | (MarkdownNodeBase & {
      attributes: Record<string, string>;
      children: MarkdownInline[];
      kind: "textDirective";
      name: string;
    });

export interface MarkdownListItem extends MarkdownNodeBase {
  blocks: MarkdownBlock[];
  checked: boolean | null;
}

export interface MarkdownTableCell extends MarkdownNodeBase {
  children: MarkdownInline[];
}

export interface MarkdownTableRow extends MarkdownNodeBase {
  cells: MarkdownTableCell[];
}

export type MarkdownBlock =
  | (MarkdownNodeBase & {
      children: MarkdownInline[];
      depth: 1 | 2 | 3 | 4 | 5 | 6;
      id: string;
      kind: "heading";
    })
  | (MarkdownNodeBase & { children: MarkdownInline[]; kind: "paragraph" })
  | (MarkdownNodeBase & {
      kind: "code";
      lang: string | null;
      meta: string | null;
      value: string;
    })
  | (MarkdownNodeBase & {
      kind: "math";
      meta: string | null;
      value: string;
    })
  | (MarkdownNodeBase & { blocks: MarkdownBlock[]; kind: "blockquote" })
  | (MarkdownNodeBase & {
      items: MarkdownListItem[];
      kind: "list";
      ordered: boolean;
      spread: boolean;
      start: number | null;
    })
  | (MarkdownNodeBase & {
      align: Array<"center" | "left" | "right" | null>;
      kind: "table";
      rows: MarkdownTableRow[];
    })
  | (MarkdownNodeBase & { kind: "thematicBreak" })
  | (MarkdownNodeBase & { kind: "html"; value: string })
  | (MarkdownNodeBase & {
      attributes: Record<string, string>;
      blocks: MarkdownBlock[];
      kind: "containerDirective";
      name: string;
    })
  | (MarkdownNodeBase & {
      attributes: Record<string, string>;
      children: MarkdownInline[];
      kind: "leafDirective";
      name: string;
    })
  | (MarkdownNodeBase & {
      blocks: MarkdownBlock[];
      identifier: string;
      kind: "footnoteDefinition";
      label: string;
    })
  | (MarkdownNodeBase & {
      kind: "unsupported";
      nodeType: string;
      value: string;
    });

export interface MarkdownHeadingSummary {
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  id: string;
  range: MarkdownSourceRange;
  text: string;
}

export interface MarkdownIrDocument {
  blocks: MarkdownBlock[];
  headings: MarkdownHeadingSummary[];
  plainText: string;
  sourceLength: number;
  version: 1;
}

export interface MarkdownParseRequest {
  requestId: string;
  revision: string;
  sessionId: string;
  source: string;
  type: "parse";
}

export type MarkdownParseResponse =
  | {
      document: MarkdownIrDocument;
      requestId: string;
      revision: string;
      sessionId: string;
      type: "parsed";
    }
  | {
      code: "parse-failed" | "too-large";
      requestId: string;
      revision: string;
      sessionId: string;
      type: "error";
    };
