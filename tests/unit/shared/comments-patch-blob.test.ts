import {
  parseBlobOidForSide,
  parsePatchBlobOids,
} from "@shared/comments/patch-blob.ts";
import { describe, expect, it } from "vitest";

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);

describe("parsePatchBlobOids", () => {
  it("parses full-index lines", () => {
    const patch = `diff --git a/x b/x\nindex ${OLD}..${NEW} 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n`;
    expect(parsePatchBlobOids(patch)).toEqual({ newOid: NEW, oldOid: OLD });
  });

  it("returns null for abbreviated index", () => {
    const patch = "index abc..def 100644\n@@ -1 +1 @@\n";
    expect(parsePatchBlobOids(patch)).toBeNull();
  });

  it("returns null for empty patch", () => {
    expect(parsePatchBlobOids("")).toBeNull();
  });
});

describe("parseBlobOidForSide", () => {
  it("selects old vs new", () => {
    const patch = `index ${OLD}..${NEW}\n`;
    expect(parseBlobOidForSide(patch, "old")).toBe(OLD);
    expect(parseBlobOidForSide(patch, "new")).toBe(NEW);
  });
});
