import * as XLSX from "xlsx";
import { inspectZipCentralDirectory } from "../document/zip-guard.ts";
import { XLSX_LIMITS } from "./limits.ts";
import { buildXlsxSheets } from "./model.ts";
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
    if (!inspectZipCentralDirectory(new Uint8Array(bytes)).ok) {
      fail(id, "zip-limit");
      return;
    }
    const workbook = XLSX.read(new Uint8Array(bytes), {
      bookVBA: false,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      sheetRows: XLSX_LIMITS.maxRows + 1,
      type: "array",
      WTF: false,
    });
    const sheets = buildXlsxSheets(workbook);
    if (sheets.length === 0) {
      fail(id, "parse-failed");
      return;
    }
    respond({ id, kind: "ok", sheets });
  } catch {
    fail(id, "parse-failed");
  }
};
