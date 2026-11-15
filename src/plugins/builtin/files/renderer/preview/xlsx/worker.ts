import { inspectZipCentralDirectory } from "../document/zip-guard.ts";
import { parseXlsxWorkbook } from "./parse.ts";
import type { XlsxWorkerRequest, XlsxWorkerResponse } from "./protocol.ts";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<XlsxWorkerRequest>) => void) | null;
  postMessage(message: XlsxWorkerResponse): void;
};

function respond(response: XlsxWorkerResponse): void {
  workerScope.postMessage(response);
}

function fail(id: number, code: "parse-failed" | "zip-limit"): void {
  respond({ code, id, kind: "error" });
}

workerScope.onmessage = (event) => {
  const { bytes, id } = event.data;
  try {
    const guard = inspectZipCentralDirectory(new Uint8Array(bytes));
    if (!guard.ok) {
      // A truncated archive is corrupt input, not a "too complex" document.
      fail(id, guard.reason === "truncated" ? "parse-failed" : "zip-limit");
      return;
    }
    const sheets = parseXlsxWorkbook(new Uint8Array(bytes));
    if (sheets.length === 0) {
      fail(id, "parse-failed");
      return;
    }
    respond({ id, kind: "ok", sheets });
  } catch {
    fail(id, "parse-failed");
  }
};
