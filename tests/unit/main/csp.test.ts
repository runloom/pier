import { buildCspPolicy } from "@main/csp.ts";
import { describe, expect, it } from "vitest";

describe("buildCspPolicy", () => {
  it.each([
    true,
    false,
  ])("allows file previews only as images when dev=%s", (isDev) => {
    const directives = buildCspPolicy(isDev).split("; ");
    const previewDirectives = directives.filter((directive) =>
      directive.includes("pier-file-preview:")
    );

    expect(previewDirectives).toEqual([
      expect.stringMatching(/^img-src .* pier-file-preview:$/),
    ]);
  });
});
