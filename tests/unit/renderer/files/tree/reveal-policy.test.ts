import {
  resolveRevealIntentForPath,
  resolveRevealPolicy,
} from "@pier/ui/file/tree-reveal-policy.ts";
import { describe, expect, it } from "vitest";

describe("resolveRevealPolicy", () => {
  it("uses center + expandTarget for explicit and search intents", () => {
    for (const intent of ["explicit", "search"] as const) {
      expect(resolveRevealPolicy({ intent })).toEqual({
        expandTarget: true,
        scroll: "center",
        shouldReveal: true,
        suppressActive: true,
      });
    }
  });

  it("uses top for root intent", () => {
    expect(resolveRevealPolicy({ intent: "root" })).toEqual({
      expandTarget: false,
      scroll: "top",
      shouldReveal: true,
      suppressActive: true,
    });
  });

  it("does not run a full reveal for inspect", () => {
    expect(resolveRevealPolicy({ intent: "inspect" })).toEqual({
      expandTarget: false,
      scroll: "none",
      shouldReveal: false,
      suppressActive: false,
    });
  });

  it("maps active-file autoReveal modes", () => {
    expect(
      resolveRevealPolicy({ intent: "active-file", autoReveal: "on" })
    ).toEqual({
      expandTarget: false,
      scroll: "nearest",
      shouldReveal: true,
      suppressActive: false,
    });
    expect(
      resolveRevealPolicy({ intent: "active-file", autoReveal: "select" })
    ).toEqual({
      expandTarget: false,
      scroll: "none",
      shouldReveal: true,
      suppressActive: false,
    });
    expect(
      resolveRevealPolicy({ intent: "active-file", autoReveal: "off" })
    ).toEqual({
      expandTarget: false,
      scroll: "none",
      shouldReveal: false,
      suppressActive: false,
    });
  });

  it("defaults active-file autoReveal to on", () => {
    expect(resolveRevealPolicy({ intent: "active-file" }).scroll).toBe(
      "nearest"
    );
    expect(resolveRevealPolicy({ intent: "active-file" }).shouldReveal).toBe(
      true
    );
  });

  it("skips active-file when path is excluded", () => {
    expect(
      resolveRevealPolicy({
        autoReveal: "on",
        intent: "active-file",
        pathExcluded: true,
      })
    ).toEqual({
      expandTarget: false,
      scroll: "none",
      shouldReveal: false,
      suppressActive: false,
    });
  });

  it("does not apply pathExcluded or autoReveal to explicit intent", () => {
    expect(
      resolveRevealPolicy({
        autoReveal: "off",
        intent: "explicit",
        pathExcluded: true,
      })
    ).toEqual({
      expandTarget: true,
      scroll: "center",
      shouldReveal: true,
      suppressActive: true,
    });
  });

  it("honors expandTarget and scroll overrides", () => {
    expect(
      resolveRevealPolicy({
        intent: "explicit",
        overrides: { expandTarget: false, scroll: "nearest" },
      })
    ).toEqual({
      expandTarget: false,
      scroll: "nearest",
      shouldReveal: true,
      suppressActive: true,
    });
    expect(
      resolveRevealPolicy({
        intent: "active-file",
        autoReveal: "on",
        overrides: { scroll: "center" },
      }).scroll
    ).toBe("center");
  });
});

describe("resolveRevealIntentForPath", () => {
  it("maps empty path to root", () => {
    expect(resolveRevealIntentForPath("", undefined)).toBe("root");
    expect(resolveRevealIntentForPath("", "explicit")).toBe("root");
  });

  it("defaults non-empty path to explicit", () => {
    expect(resolveRevealIntentForPath("src/app.tsx", undefined)).toBe(
      "explicit"
    );
  });

  it("preserves caller intent for non-empty paths", () => {
    expect(resolveRevealIntentForPath("src/app.tsx", "active-file")).toBe(
      "active-file"
    );
    expect(resolveRevealIntentForPath("src/app.tsx", "search")).toBe("search");
  });
});
