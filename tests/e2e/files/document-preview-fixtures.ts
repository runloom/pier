import { writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import * as XLSX from "xlsx";

function pad(offset: number): string {
  return offset.toString().padStart(10, "0");
}

/**
 * Writes a tiny, structurally valid PDF with one page and one line of text.
 * Offsets are computed in bytes so PDF.js can parse the xref table.
 */
export function writeMinimalPdf(
  directory: string,
  fileName = "report.pdf"
): string {
  const path = join(directory, fileName);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 24 Tf 36 120 Td (Pier PDF preview) Tj ET";
  objects.push(
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`
  );

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${pad(offset)} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  writeFileSync(path, Buffer.from(body, "latin1"));
  return path;
}

/**
 * Writes a DOCX package with body text, an embedded image, an unreferenced
 * external image relationship (which must never be prefetched) and an
 * external hyperlink.
 *
 * The external image rel is deliberately NOT referenced from the body:
 * external image relationships are invalid OOXML, and docx-preview resolves
 * them to `src="null"` instead of the target URL. Referenced-URL sanitization
 * is covered by the component tests.
 */
export async function writeMinimalDocx(
  directory: string,
  fileName = "notes.docx"
): Promise<string> {
  const path = join(directory, fileName);
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/tracker.png" TargetMode="External"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pixel.png"/>
</Relationships>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
<w:p><w:r><w:t>Pier DOCX preview</w:t></w:r></w:p>
<w:p><w:hyperlink r:id="rId1"><w:r><w:t>Example link</w:t></w:r></w:hyperlink></w:p>
${docxImageParagraph("rId3", 1, "pixel.png")}
<w:sectPr/>
</w:body>
</w:document>`
  );
  zip.file(
    "word/media/pixel.png",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    )
  );
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  writeFileSync(path, bytes);
  return path;
}

/** A 1×1 inline picture; docx-preview resolves the relationship to a data URL. */
function docxImageParagraph(
  relationshipId: string,
  id: number,
  name: string
): string {
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="9525" cy="9525"/><wp:docPr id="${id}" name="Picture ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

/**
 * Writes a two-sheet XLSX workbook with column widths.
 */
export function writeMinimalXlsx(
  directory: string,
  fileName = "data.xlsx"
): string {
  const path = join(directory, fileName);
  const book = XLSX.utils.book_new();
  const data = XLSX.utils.aoa_to_sheet([
    ["Name", "Score"],
    ["Alice", 42],
  ]);
  data["!cols"] = [{ wch: 16 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(book, data, "Data");
  const summary = XLSX.utils.aoa_to_sheet([["Total"], [42]]);
  XLSX.utils.book_append_sheet(book, summary, "Summary");
  writeFileSync(path, XLSX.write(book, { bookType: "xlsx", type: "buffer" }));
  return path;
}

export function writeUnsupportedFixtures(directory: string): void {
  writeFileSync(
    join(directory, "deck.pptx"),
    Buffer.from("PK\u0003\u0004deck")
  );
  writeFileSync(
    join(directory, "locked.docx"),
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00])
  );
  writeFileSync(
    join(directory, "legacy.doc"),
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0])
  );
}
