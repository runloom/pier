import { PierFileIcon } from "@pier/ui/file/icon.tsx";
import {
  PATH_LANGUAGE_MATRIX,
  SPECIAL_LSP_CATALOG_ENTRIES,
} from "@shared/language-matrix/index.ts";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

function iconTokenForFileName(fileName: string): string | null {
  const { container, unmount } = render(<PierFileIcon fileName={fileName} />);
  const token =
    container
      .querySelector("[data-pier-file-icon]")
      ?.getAttribute("data-icon-token") ?? null;
  unmount();
  return token;
}

describe("file icon coverage for L0 languages", () => {
  afterEach(() => {
    document.querySelector('[data-pier-file-icon-sprite="true"]')?.remove();
  });

  it("maps every PATH matrix extension away from the default glyph", () => {
    for (const row of PATH_LANGUAGE_MATRIX) {
      for (const extension of row.extensions) {
        const fileName = `sample${extension}`;
        expect(
          iconTokenForFileName(fileName),
          `${row.id} ${fileName}`
        ).not.toBe("default");
      }
    }
  });

  it("maps Dockerfile basename away from the default glyph", () => {
    expect(iconTokenForFileName("Dockerfile")).not.toBe("default");
  });

  it("maps bundled TypeScript / Vue catalog extensions away from default", () => {
    for (const entry of SPECIAL_LSP_CATALOG_ENTRIES) {
      for (const extension of entry.extensions) {
        const fileName = `sample${extension}`;
        expect(iconTokenForFileName(fileName), fileName).not.toBe("default");
      }
    }
  });
});
