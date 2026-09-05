import { compareFileContents } from "./compare.ts";
import type { CompareRequest } from "./types.ts";

self.onmessage = (event: MessageEvent<CompareRequest>) => {
  try {
    self.postMessage({
      version: event.data.version,
      result: compareFileContents(event.data),
    });
  } catch (error) {
    self.postMessage({
      version: event.data.version,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
