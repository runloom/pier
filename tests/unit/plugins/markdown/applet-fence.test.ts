import { describe, expect, it } from "vitest";
import {
  appletFenceProps,
  markdownAppletsEnabled,
  parseAppletFence,
} from "../../../../src/plugins/builtin/files/renderer/markdown/applet/fence.tsx";

describe("markdown applet fence", () => {
  it("requires an explicit enable comment", () => {
    expect(markdownAppletsEnabled("hello")).toBe(false);
    expect(
      markdownAppletsEnabled("<!-- pier-applets: enable -->\n# Title")
    ).toBe(true);
  });

  it("parses pluginId, appletId, and props", () => {
    expect(
      parseAppletFence(
        JSON.stringify({
          appletId: "tracker-board",
          pluginId: "pier.tasks",
          props: { repo: "acme/app" },
        })
      )
    ).toEqual({
      appletId: "tracker-board",
      pluginId: "pier.tasks",
      props: { repo: "acme/app" },
    });
    expect(parseAppletFence("not-json")).toBeNull();
  });

  it("mounts markdown applets as island cards", () => {
    expect(
      appletFenceProps({
        chrome: "panel",
        repo: "acme/app",
      })
    ).toEqual({
      chrome: "island",
      repo: "acme/app",
    });
  });
});
