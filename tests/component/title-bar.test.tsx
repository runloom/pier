import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TitleBar } from "@/components/common/title-bar.tsx";

describe("TitleBar", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.style.removeProperty("--app-titlebar-height");
  });

  it("publishes the draggable titlebar height for portal overlays", () => {
    expect(
      document.documentElement.style.getPropertyValue("--app-titlebar-height")
    ).toBe("");

    const view = render(<TitleBar />);

    expect(
      document.documentElement.style.getPropertyValue("--app-titlebar-height")
    ).toBe("38px");

    view.unmount();

    expect(
      document.documentElement.style.getPropertyValue("--app-titlebar-height")
    ).toBe("0px");
  });
});
