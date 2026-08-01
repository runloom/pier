export interface MarkdownCodeHighlightToken {
  color?: string;
  content: string;
  fontStyle?: number;
}

export interface MarkdownCodeHighlightRequest {
  code: string;
  language: string;
  requestId: string;
  theme: string;
  type: "highlight";
}

export type MarkdownCodeHighlightResponse =
  | {
      background: string;
      foreground: string;
      lines: MarkdownCodeHighlightToken[][];
      requestId: string;
      type: "highlighted";
    }
  | {
      requestId: string;
      type: "error";
    };
