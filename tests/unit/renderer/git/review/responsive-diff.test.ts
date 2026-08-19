import { resolveResponsiveDiffStyle } from "@plugins/builtin/git/renderer/review/responsive-diff.ts";
import { describe, expect, it } from "vitest";

describe("resolveResponsiveDiffStyle", () => {
  it.each([
    {
      width: null,
      previous: false,
      expectedStyle: "split",
      expectedForced: false,
    },
    {
      width: 899,
      previous: false,
      expectedStyle: "unified",
      expectedForced: true,
    },
    {
      width: 900,
      previous: false,
      expectedStyle: "split",
      expectedForced: false,
    },
    {
      width: 900,
      previous: true,
      expectedStyle: "unified",
      expectedForced: true,
    },
    {
      width: 959,
      previous: true,
      expectedStyle: "unified",
      expectedForced: true,
    },
    {
      width: 960,
      previous: true,
      expectedStyle: "split",
      expectedForced: false,
    },
  ])("resolves split preference at $width", ({
    width,
    previous,
    expectedStyle,
    expectedForced,
  }) => {
    expect(
      resolveResponsiveDiffStyle({
        preferredDiffStyle: "split",
        contentWidthPx: width,
        responsiveUnified: previous,
      })
    ).toEqual({
      effectiveDiffStyle: expectedStyle,
      responsiveUnified: expectedForced,
    });
  });

  it("never marks an explicit unified preference as a responsive fallback", () => {
    expect(
      resolveResponsiveDiffStyle({
        preferredDiffStyle: "unified",
        contentWidthPx: 320,
        responsiveUnified: true,
      })
    ).toEqual({
      effectiveDiffStyle: "unified",
      responsiveUnified: false,
    });
  });
});
