import { buildCspPolicy } from "@main/csp.ts";
import { describe, expect, it } from "vitest";

function mediaSrcDirective(policy: string): string | undefined {
  return policy
    .split("; ")
    .find((directive) => directive.startsWith("media-src "));
}

describe("buildCspPolicy media-src", () => {
  it.each([
    true,
    false,
  ])("allows HTMLAudio from self and pier-asset when dev=%s", (isDev) => {
    const policy = buildCspPolicy(isDev);
    expect(policy).toContain("media-src");
    expect(policy).toContain("pier-asset:");

    const mediaSrc = mediaSrcDirective(policy);
    expect(mediaSrc).toBe("media-src 'self' pier-asset:");
  });

  it("keeps pier-asset on font-src in both modes", () => {
    for (const isDev of [true, false]) {
      const fontSrc = buildCspPolicy(isDev)
        .split("; ")
        .find((directive) => directive.startsWith("font-src "));
      expect(fontSrc).toContain("pier-asset:");
    }
  });
});
