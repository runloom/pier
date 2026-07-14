import type { MarkdownParseRequest } from "./markdown-ir.ts";
import { parseMarkdownRequest } from "./markdown-parser.ts";

self.onmessage = (event: MessageEvent<MarkdownParseRequest>) => {
  self.postMessage(parseMarkdownRequest(event.data));
};
