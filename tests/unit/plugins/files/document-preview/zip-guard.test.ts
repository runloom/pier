import {
  DOCUMENT_ZIP_LIMITS,
  inspectZipCentralDirectory,
} from "@plugins/builtin/files/renderer/preview/document/zip-guard.ts";
import { inspectDocxPackage } from "@plugins/builtin/files/renderer/preview/docx/inspect.ts";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

function zipCentralDirectory(
  entries: { uncompressedBytes: number }[]
): Uint8Array {
  const entrySize = 46 + 1;
  const centralSize = entries.length * entrySize;
  const bytes = new Uint8Array(centralSize + 22);
  const view = new DataView(bytes.buffer);
  let cursor = 0;
  for (const entry of entries) {
    view.setUint32(cursor, 0x02_01_4b_50, true);
    view.setUint32(cursor + 24, entry.uncompressedBytes, true);
    view.setUint16(cursor + 28, 1, true);
    view.setUint16(cursor + 30, 0, true);
    view.setUint16(cursor + 32, 0, true);
    view.setUint8(cursor + 46, 0x78);
    cursor += entrySize;
  }
  view.setUint32(cursor, 0x06_05_4b_50, true);
  view.setUint16(cursor + 8, entries.length, true);
  view.setUint16(cursor + 10, entries.length, true);
  view.setUint32(cursor + 12, centralSize, true);
  view.setUint32(cursor + 16, 0, true);
  return bytes;
}

describe("inspectZipCentralDirectory", () => {
  it("accepts an ordinary OOXML directory", () => {
    expect(
      inspectZipCentralDirectory(
        zipCentralDirectory([{ uncompressedBytes: 1024 }])
      )
    ).toEqual({ ok: true });
  });

  it("rejects more than 10,000 entries", () => {
    const entries = Array.from(
      { length: DOCUMENT_ZIP_LIMITS.maxEntries + 1 },
      () => ({ uncompressedBytes: 1 })
    );
    expect(inspectZipCentralDirectory(zipCentralDirectory(entries))).toEqual({
      ok: false,
      reason: "too-many-entries",
    });
  });

  it("rejects a single entry above 128 MiB", () => {
    expect(
      inspectZipCentralDirectory(
        zipCentralDirectory([
          {
            uncompressedBytes:
              DOCUMENT_ZIP_LIMITS.maxEntryUncompressedBytes + 1,
          },
        ])
      )
    ).toEqual({ ok: false, reason: "entry-too-large" });
  });

  it("rejects a total above 256 MiB", () => {
    const entries = Array.from({ length: 3 }, () => ({
      uncompressedBytes: 100 * 1024 * 1024,
    }));
    expect(inspectZipCentralDirectory(zipCentralDirectory(entries))).toEqual({
      ok: false,
      reason: "total-too-large",
    });
  });

  it("rejects a truncated central directory", () => {
    expect(
      inspectZipCentralDirectory(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))
    ).toEqual({ ok: false, reason: "truncated" });
  });
});

async function makeDocx(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) {
    zip.file(path, contents);
  }
  return zip.generateAsync({ type: "uint8array" });
}

describe("inspectDocxPackage", () => {
  it("accepts a package with content types and document.xml", async () => {
    const bytes = await makeDocx({
      "[Content_Types].xml": "<Types/>",
      "word/document.xml": "<w:document/>",
    });
    await expect(inspectDocxPackage(bytes)).resolves.toEqual({ ok: true });
  });

  it("rejects a ZIP without word/document.xml", async () => {
    const bytes = await makeDocx({
      "[Content_Types].xml": "<Types/>",
    });
    await expect(inspectDocxPackage(bytes)).resolves.toEqual({
      ok: false,
      reason: "not-docx",
    });
  });

  it("reports a truncated archive as corrupt rather than over the ZIP limit", async () => {
    await expect(
      inspectDocxPackage(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))
    ).resolves.toEqual({ ok: false, reason: "not-docx" });
  });

  it("still reports a real archive expansion limit as zip-limit", async () => {
    const entries = Array.from({ length: 10_001 }, () => ({
      uncompressedBytes: 1,
    }));
    await expect(
      inspectDocxPackage(zipCentralDirectory(entries))
    ).resolves.toEqual({ ok: false, reason: "zip-limit" });
  });
});
