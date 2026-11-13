import { pdfLoadError } from "@plugins/builtin/files/renderer/preview/pdf/errors.ts";
import {
  pdfLinkTargets,
  resolvePdfPageIndex,
} from "@plugins/builtin/files/renderer/preview/pdf/links.ts";
import { describe, expect, it } from "vitest";

describe("pdfLoadError", () => {
  it("maps PasswordException to encrypted", () => {
    expect(pdfLoadError({ name: "PasswordException" })).toBe("encrypted");
  });

  it("maps other failures to parse-failed", () => {
    expect(pdfLoadError(new SyntaxError("bad pdf"))).toBe("parse-failed");
    expect(pdfLoadError(null)).toBe("parse-failed");
  });
});

describe("pdfLinkTargets", () => {
  const rect = [10, 20, 30, 40];

  it("keeps https and mailto links", () => {
    expect(
      pdfLinkTargets([
        { rect, subtype: "Link", url: "https://example.com" },
        { rect, subtype: "Link", url: "mailto:a@example.com" },
      ])
    ).toEqual([
      { kind: "external", rect, url: "https://example.com" },
      { kind: "external", rect, url: "mailto:a@example.com" },
    ]);
  });

  it("drops unsafe schemes and relative URLs", () => {
    expect(
      pdfLinkTargets([
        { rect, subtype: "Link", url: "http://example.com" },
        { rect, subtype: "Link", url: "javascript:alert(1)" },
        { rect, subtype: "Link", url: "file:///etc/passwd" },
        { rect, subtype: "Link", url: "/relative" },
      ])
    ).toEqual([]);
  });

  it("keeps internal destinations and skips non-link annotations", () => {
    expect(
      pdfLinkTargets([
        { subtype: "Text", url: "https://example.com" },
        { dest: [{ num: 3 }], rect, subtype: "Link" },
      ])
    ).toEqual([{ dest: [{ num: 3 }], kind: "internal", rect }]);
  });
});

describe("resolvePdfPageIndex", () => {
  it("resolves named destinations", async () => {
    const pdf = {
      getDestination: async (id: string) =>
        id === "chapter" ? [{ num: 3 }] : null,
      getPageIndex: async () => 7,
    };
    await expect(resolvePdfPageIndex(pdf, "chapter")).resolves.toBe(7);
  });

  it("rejects unknown destinations", async () => {
    const pdf = {
      getDestination: async () => null,
      getPageIndex: async () => 0,
    };
    await expect(resolvePdfPageIndex(pdf, "missing")).resolves.toBeNull();
  });

  it("survives a malformed destination tree instead of failing the page", async () => {
    const pdf = {
      getDestination: async () => {
        throw new Error("bad name tree");
      },
      getPageIndex: async () => 0,
    };
    await expect(resolvePdfPageIndex(pdf, "broken")).resolves.toBeNull();
  });

  it("returns null when the destination page reference is invalid", async () => {
    const pdf = {
      getDestination: async () => [{ num: 3 }],
      getPageIndex: async () => {
        throw new Error("missing page");
      },
    };
    await expect(resolvePdfPageIndex(pdf, "broken-page")).resolves.toBeNull();
  });
});
