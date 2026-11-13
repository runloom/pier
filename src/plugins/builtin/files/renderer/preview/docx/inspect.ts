import JSZip from "jszip";
import { inspectZipCentralDirectory } from "../document/zip-guard.ts";

export type DocxInspection =
  | { ok: true }
  | { ok: false; reason: "not-docx" | "zip-limit" };

export async function inspectDocxPackage(
  bytes: Uint8Array
): Promise<DocxInspection> {
  if (!inspectZipCentralDirectory(bytes).ok) {
    return { ok: false, reason: "zip-limit" };
  }
  try {
    const zip = await JSZip.loadAsync(bytes);
    const hasContentTypes = zip.file("[Content_Types].xml") !== null;
    const hasDocument = zip.file("word/document.xml") !== null;
    return hasContentTypes && hasDocument
      ? { ok: true }
      : { ok: false, reason: "not-docx" };
  } catch {
    return { ok: false, reason: "not-docx" };
  }
}
