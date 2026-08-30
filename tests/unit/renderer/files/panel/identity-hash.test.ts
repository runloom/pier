import { describe, expect, it } from "vitest";
import { stableFileIdentityHash as hostHash } from "@/lib/files/identity-hash.ts";
import { stableFileIdentityHash as pluginHash } from "../../../../../src/plugins/builtin/files/renderer/document/stable-hash.ts";

describe("stableFileIdentityHash host/plugin lockstep", () => {
  it("matches the files plugin hash for the same inputs", () => {
    const samples = [
      "",
      "/Users/a/proj",
      "src/a.ts",
      "root\u0000path",
      "unicode-路径",
    ];
    for (const sample of samples) {
      expect(hostHash(sample)).toBe(pluginHash(sample));
    }
  });
});
