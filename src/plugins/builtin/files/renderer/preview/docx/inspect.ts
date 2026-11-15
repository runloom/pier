import JSZip from "jszip";
import { inspectZipCentralDirectory } from "../document/zip-guard.ts";

export type DocxInspection =
  | { ok: true }
  | { ok: false; reason: "not-docx" | "zip-limit" };

export async function inspectDocxPackage(
  bytes: Uint8Array
): Promise<DocxInspection> {
  const guard = inspectZipCentralDirectory(bytes);
  if (!guard.ok) {
    // A truncated / corrupt archive is not a document that expands past the
    // safe limit; only the real size guards map to the zip-limit copy.
    return {
      ok: false,
      reason: guard.reason === "truncated" ? "not-docx" : "zip-limit",
    };
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
