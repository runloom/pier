import { afterEach, describe, expect, it, vi } from "vitest";
import { activatePanelFromContentPointerDown } from "@/lib/workspace/pointer-activation.ts";

function buildGroup(isActive: boolean) {
  const groupElement = document.createElement("div");
  groupElement.className = "dv-groupview";
  const header = document.createElement("div");
  header.className = "dv-tabs-and-actions-container";
  const content = document.createElement("div");
  content.className = "dv-content-container";
  groupElement.append(header, content);
  document.body.append(groupElement);

  const setActive = vi.fn();
  const group = {
    activePanel: { api: { setActive } },
    api: { isActive },
    element: groupElement,
  };
  return { content, group, header, setActive };
}

describe("activatePanelFromContentPointerDown", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("activates an inactive group when its content is pressed", () => {
    const { content, group, setActive } = buildGroup(false);

    expect(
      activatePanelFromContentPointerDown({ groups: [group] } as never, content)
    ).toBe(true);
    expect(setActive).toHaveBeenCalledOnce();
  });

  it("keeps the current panel when the group is already active", () => {
    const { content, group, setActive } = buildGroup(true);

    expect(
      activatePanelFromContentPointerDown({ groups: [group] } as never, content)
    ).toBe(false);
    expect(setActive).not.toHaveBeenCalled();
  });

  it("does not activate from the tab strip / header", () => {
    const { group, header, setActive } = buildGroup(false);

    expect(
      activatePanelFromContentPointerDown({ groups: [group] } as never, header)
    ).toBe(false);
    expect(setActive).not.toHaveBeenCalled();
  });

  it("ignores targets outside a dockview group", () => {
    const outside = document.createElement("div");
    document.body.append(outside);
    const { group, setActive } = buildGroup(false);

    expect(
      activatePanelFromContentPointerDown({ groups: [group] } as never, outside)
    ).toBe(false);
    expect(setActive).not.toHaveBeenCalled();
  });
});
