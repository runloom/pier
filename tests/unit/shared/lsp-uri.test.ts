import { describe, expect, it } from "vitest";
import {
  absolutePathFromFileUri,
  fileUriFromAbsolutePath,
  lspLanguageIdForPath,
} from "../../../src/shared/lsp-uri.ts";

describe("fileUriFromAbsolutePath / absolutePathFromFileUri", () => {
  it("round-trips posix absolute paths", () => {
    const uri = fileUriFromAbsolutePath("/Users/x/My Docs/a.ts");
    expect(uri).toBe("file:///Users/x/My%20Docs/a.ts");
    expect(absolutePathFromFileUri(uri)).toBe("/Users/x/My Docs/a.ts");
  });

  it("rejects non-file URIs", () => {
    expect(absolutePathFromFileUri("https://example.com/a.ts")).toBeNull();
  });
});

describe("lspLanguageIdForPath", () => {
  it("maps typescript and javascript extensions", () => {
    expect(lspLanguageIdForPath("a.ts")).toBe("typescript");
    expect(lspLanguageIdForPath("a.tsx")).toBe("typescriptreact");
    expect(lspLanguageIdForPath("a.js")).toBe("javascript");
    expect(lspLanguageIdForPath("a.jsx")).toBe("javascriptreact");
    expect(lspLanguageIdForPath("a.md")).toBeNull();
  });
});
