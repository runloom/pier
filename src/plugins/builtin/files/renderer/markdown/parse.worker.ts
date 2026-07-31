import type { MarkdownParseRequest } from "./ir.ts";
import { parseMarkdownRequest } from "./parser.ts";

self.onmessage = (event: MessageEvent<MarkdownParseRequest>) => {
  self.postMessage(parseMarkdownRequest(event.data));
};
