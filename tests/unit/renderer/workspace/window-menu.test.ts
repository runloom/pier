import type { MenuTemplate } from "@shared/contracts/menu.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listOtherWindows = vi.hoisted(() =>
  vi.fn(async (): Promise<unknown[]> => [])
);
const movePanelToWindow = vi.hoisted(() => vi.fn(async () => undefined));
const copyPanelToWindow = vi.hoisted(() => vi.fn(async () => undefined));
const resolveRelocatePanelId = vi.hoisted(() => vi.fn(() => "panel-1"));

vi.mock("i18next", () => ({
  default: {
    t: (key: string) => key,
  },
}));

vi.mock("@/components/workspace/transfer/pick-window.ts", () => ({
  listOtherWindows,
}));

vi.mock("@/components/workspace/transfer/relocate.ts", () => ({
  copyPanelToWindow,
  movePanelToWindow,
  resolveRelocatePanelId,
}));

function option(
  id: string,
  label: string,
  extras?: { description?: string; menuLabel?: string }
) {
  return {
    id,
    label,
    menuLabel: extras?.menuLabel ?? label,
    recordId: `record-${id}`,
    ...(extras?.description ? { description: extras.description } : {}),
  };
}

function templateWithPlaceholders(): MenuTemplate {
  return [
    {
      type: "action",
      id: "pier.panel.moveToNewWindow",
      label: "Move into New Window",
    },
    {
      type: "action",
      id: "pier.panel.moveToWindow",
      label: "Move to Another Window",
    },
    {
      type: "action",
      id: "pier.panel.copyToWindow",
      label: "Copy to Another Window",
    },
    { type: "separator" },
    { type: "action", id: "pier.panel.close", label: "Close Panel" },
  ];
}

describe("window relocate tab menu", () => {
  beforeEach(() => {
    listOtherWindows.mockReset();
    movePanelToWindow.mockReset();
    copyPanelToWindow.mockReset();
    resolveRelocatePanelId.mockReset();
    resolveRelocatePanelId.mockReturnValue("panel-1");
    listOtherWindows.mockResolvedValue([]);
  });

  it("leaves unrelated templates untouched without listing windows", async () => {
    const { expandWindowRelocateMenu } = await import(
      "@/components/workspace/transfer/window-menu.ts"
    );
    const template: MenuTemplate = [
      { type: "action", id: "panel.close", label: "Close" },
    ];
    await expect(expandWindowRelocateMenu(template)).resolves.toEqual(template);
    expect(listOtherWindows).not.toHaveBeenCalled();
  });

  it("omits move/copy to other window when no other windows exist", async () => {
    const { expandWindowRelocateMenu } = await import(
      "@/components/workspace/transfer/window-menu.ts"
    );
    const expanded = await expandWindowRelocateMenu(templateWithPlaceholders());
    expect(expanded).toEqual([
      {
        type: "action",
        id: "pier.panel.moveToNewWindow",
        label: "Move into New Window",
      },
      { type: "separator" },
      { type: "action", id: "pier.panel.close", label: "Close Panel" },
    ]);
  });

  it("omits the items when listing windows fails", async () => {
    listOtherWindows.mockRejectedValueOnce(new Error("ipc down"));
    const { expandWindowRelocateMenu } = await import(
      "@/components/workspace/transfer/window-menu.ts"
    );
    const expanded = await expandWindowRelocateMenu(templateWithPlaceholders());
    expect(
      expanded.map((item) => (item.type === "action" ? item.id : item.type))
    ).toEqual(["pier.panel.moveToNewWindow", "separator", "pier.panel.close"]);
  });

  it("uses a direct the-other-window action when exactly one other window exists", async () => {
    listOtherWindows.mockResolvedValueOnce([
      option("w-2", "pier", { description: "feat" }),
    ]);
    const { expandWindowRelocateMenu } = await import(
      "@/components/workspace/transfer/window-menu.ts"
    );
    const expanded = await expandWindowRelocateMenu(templateWithPlaceholders());
    expect(expanded).toEqual([
      {
        type: "action",
        id: "pier.panel.moveToNewWindow",
        label: "Move into New Window",
      },
      {
        type: "action",
        id: "pier.panel.moveToWindow:w-2",
        label: "contextMenu.action.moveToTheOtherWindow",
      },
      {
        type: "action",
        id: "pier.panel.copyToWindow:w-2",
        label: "contextMenu.action.copyToTheOtherWindow",
      },
      { type: "separator" },
      { type: "action", id: "pier.panel.close", label: "Close Panel" },
    ]);
  });

  it("expands a submenu of named windows when several others exist", async () => {
    listOtherWindows.mockResolvedValueOnce([
      option("w-2", "pier", { description: "feat-a", menuLabel: "pier" }),
      option("w-3", "docs"),
    ]);
    const { expandWindowRelocateMenu } = await import(
      "@/components/workspace/transfer/window-menu.ts"
    );
    const expanded = await expandWindowRelocateMenu(templateWithPlaceholders());
    const move = expanded[1];
    const copy = expanded[2];
    expect(move).toEqual({
      type: "submenu",
      label: "Move to Another Window",
      submenu: [
        {
          type: "action",
          id: "pier.panel.moveToWindow:w-2",
          label: "pier",
          enabled: true,
        },
        {
          type: "action",
          id: "pier.panel.moveToWindow:w-3",
          label: "docs",
          enabled: true,
        },
      ],
    });
    expect(copy).toMatchObject({
      type: "submenu",
      label: "Copy to Another Window",
    });
  });

  it("parses encoded relocate action ids", async () => {
    const { parseWindowRelocateMenuAction } = await import(
      "@/components/workspace/transfer/window-menu.ts"
    );
    expect(
      parseWindowRelocateMenuAction("pier.panel.moveToWindow:w-2")
    ).toEqual({
      kind: "move",
      windowId: "w-2",
    });
    expect(
      parseWindowRelocateMenuAction("pier.panel.copyToWindow:w-9")
    ).toEqual({
      kind: "copy",
      windowId: "w-9",
    });
    expect(parseWindowRelocateMenuAction("pier.panel.moveToWindow")).toBeNull();
    expect(parseWindowRelocateMenuAction("pier.panel.close")).toBeNull();
  });

  it("dispatches encoded move/copy actions to the target window", async () => {
    const { dispatchWindowRelocateMenuAction } = await import(
      "@/components/workspace/transfer/window-menu.ts"
    );
    await expect(
      dispatchWindowRelocateMenuAction("pier.panel.moveToWindow:w-2", {
        sourcePanelId: "panel-1",
      })
    ).resolves.toBe(true);
    expect(movePanelToWindow).toHaveBeenCalledWith("panel-1", "w-2");
    await expect(
      dispatchWindowRelocateMenuAction("pier.panel.copyToWindow:w-3")
    ).resolves.toBe(true);
    expect(copyPanelToWindow).toHaveBeenCalledWith("panel-1", "w-3");
    await expect(
      dispatchWindowRelocateMenuAction("pier.panel.close")
    ).resolves.toBe(false);
  });
});
