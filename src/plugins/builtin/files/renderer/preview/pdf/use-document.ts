import { getDocument, type PDFDocumentProxy, PDFWorker } from "pdfjs-dist";
// Inline worker: packaged file:// must not spawn a module worker from disk.
import PdfWorkerFactory from "pdfjs-dist/build/pdf.worker.min.mjs?worker&inline";
import { useEffect, useState } from "react";
import type { DocumentRenderError } from "../document/types.ts";
import { pdfLoadError } from "./errors.ts";
import { destroyPdfResources } from "./resources.ts";

export type PdfDocumentState =
  | { error: null; pdf: null; status: "loading" }
  | { error: null; pdf: PDFDocumentProxy; status: "ready" }
  | { error: DocumentRenderError; pdf: null; status: "error" };

export function usePdfDocument(bytes: Uint8Array): PdfDocumentState {
  const [state, setState] = useState<PdfDocumentState>({
    error: null,
    pdf: null,
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    const port = new PdfWorkerFactory();
    const worker = PDFWorker.create({ port });
    const loadingTask = getDocument({
      cMapPacked: true,
      cMapUrl: "pier-asset://pdfjs/cmaps/",
      data: bytes.slice(),
      disableAutoFetch: true,
      disableStream: true,
      standardFontDataUrl: "pier-asset://pdfjs/standard_fonts/",
      useSystemFonts: false,
      verbosity: 0,
      wasmUrl: "pier-asset://pdfjs/wasm/",
      worker,
    });
    setState({ error: null, pdf: null, status: "loading" });

    loadingTask.promise
      .then((pdf) => {
        if (cancelled) {
          pdf.loadingTask.destroy().catch(() => undefined);
          return;
        }
        setState({ error: null, pdf, status: "ready" });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            error: pdfLoadError(error),
            pdf: null,
            status: "error",
          });
        }
      });

    return () => {
      cancelled = true;
      destroyPdfResources({ loadingTask, port, worker });
    };
  }, [bytes]);

  return state;
}
