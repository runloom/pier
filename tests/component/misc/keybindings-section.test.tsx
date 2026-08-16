import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import {
  act,
  fireEvent,
  type RenderOptions,
  render as renderBase,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import type { ReactElement } from "react";
import { toast } from "sonner";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { registerPanelActions } from "@/lib/actions/panel-actions.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { registerViewActions } from "@/lib/actions/view-actions.ts";
import { DEFAULT_KEYMAP } from "@/lib/keybindings/defaults.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import { KeybindingsSection } from "@/pages/settings/components/keybindings-section.tsx";
import { registerTerminalActions } from "@/panel-kits/terminal/register-actions.ts";
import { useKeybindingPreferencesStore } from "@/stores/keybinding-preferences.store.ts";

const RAW_PANEL_METADATA_PATTERN = /Panel ·/;

function render(ui: ReactElement, options?: RenderOptions) {
  return renderBase(<TooltipProvider>{ui}</TooltipProvider>, options);
}

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe("KeybindingsSection", () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(async () => {
    await i18next.changeLanguage("zh-CN");
    vi.clearAllMocks();
    keybindingRegistry.loadUserKeymap([]);
    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
    useKeybindingPreferencesStore.setState({
      error: null,
      recordingCommandId: null,
      userKeymap: [],
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        preferences: {
          onChanged: vi.fn(),
          read: vi.fn(),
          update: vi.fn(),
        },
        terminal: { setAppShortcutKeys: vi.fn() },
      },
    });
  });

  afterEach(async () => {
    actionRegistry.clearForTests();
    await i18next.changeLanguage("en");
  });

  it("records a replacement shortcut from the keyboard", async () => {
    const dispose = actionRegistry.register({
      category: "Panel",
      handler: vi.fn(),
      id: "pier.panel.newTerminal",
      surfaces: ["command-palette"],
      title: () => "新建终端",
    });

    const { container, unmount } = render(<KeybindingsSection />);
    const footer = container.querySelector('[data-slot="card-footer"]');
    expect(footer).toHaveClass("border-t");
    expect(footer).not.toHaveClass("py-3");
    fireEvent.click(screen.getByRole("button", { name: "录制 新建终端" }));
    fireEvent.keyDown(window, {
      code: "KeyX",
      ctrlKey: true,
      key: "X",
      shiftKey: true,
    });

    await waitFor(() => {
      expect(window.pier.preferences.update).toHaveBeenCalledWith({
        userKeymap: [
          { commandId: "-pier.panel.newTerminal", keys: "", scope: "global" },
          {
            commandId: "pier.panel.newTerminal",
            keys: "Mod+Shift+KeyX",
            scope: "global",
          },
        ],
      });
    });
    unmount();
    dispose();
  });

  it("uses localized descriptions instead of raw action metadata", () => {
    const dispose = actionRegistry.register({
      category: "Panel",
      handler: vi.fn(),
      id: "pier.panel.newTerminal",
      surfaces: ["command-palette"],
      title: () => "新建终端",
    });

    const { unmount } = render(<KeybindingsSection />);

    expect(screen.getByText("新建一个终端面板。")).toBeInTheDocument();
    expect(
      screen.queryByText(RAW_PANEL_METADATA_PATTERN)
    ).not.toBeInTheDocument();
    unmount();
    dispose();
  });

  it("uses descriptive localized action labels in the settings list", () => {
    const disposers = [
      registerPanelActions(),
      registerTerminalActions(),
      registerViewActions(),
    ];

    const { unmount } = render(<KeybindingsSection />);

    expect(screen.getByText("关闭面板")).toBeInTheDocument();
    expect(screen.getByText("关闭其他面板")).toBeInTheDocument();
    expect(screen.queryByText("关闭所有面板")).not.toBeInTheDocument();
    expect(screen.getByText("关闭当前面板。")).toBeInTheDocument();
    const terminalRow = screen.getByTestId(
      "keybinding-row-pier.terminal.close"
    );
    expect(within(terminalRow).getByText("关闭终端")).toBeInTheDocument();
    expect(
      within(terminalRow).getByText("关闭当前终端面板。")
    ).toBeInTheDocument();
    expect(screen.getByText("放大界面")).toBeInTheDocument();
    expect(screen.getByText("缩小界面")).toBeInTheDocument();
    expect(screen.getByText("重置界面缩放")).toBeInTheDocument();
    unmount();
    for (const dispose of disposers) {
      dispose();
    }
  });

  it("renders shortcut values as keycaps inside a single input control", () => {
    const dispose = actionRegistry.register({
      category: "Run",
      handler: vi.fn(),
      id: "pier.panel.newTerminal",
      surfaces: ["command-palette"],
      title: () => "新建终端",
    });

    const { unmount } = render(<KeybindingsSection />);

    const row = screen.getByTestId("keybinding-row-pier.panel.newTerminal");
    const input = within(row).getByTestId("shortcut-input");
    expect(input).toBeInTheDocument();
    expect(within(input).getAllByTestId("shortcut-input-key")).toHaveLength(2);
    expect(within(input).getByText("Ctrl")).toBeInTheDocument();
    expect(within(input).getByText("T")).toBeInTheDocument();
    expect(
      input.querySelector('[data-icon="inline-end"]')
    ).not.toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "录制 新建终端" })
    ).toHaveAttribute("data-slot", "shortcut-input-trigger");
    unmount();
    dispose();
  });

  it("uses the recording input state from the reference", () => {
    const dispose = actionRegistry.register({
      category: "Panel",
      handler: vi.fn(),
      id: "pier.panel.closeOthers",
      surfaces: ["command-palette"],
      title: () => "关闭其他面板",
    });

    const { unmount } = render(<KeybindingsSection />);
    fireEvent.click(screen.getByRole("button", { name: "录制 关闭其他面板" }));

    const row = screen.getByTestId("keybinding-row-pier.panel.closeOthers");
    const input = within(row).getByTestId("shortcut-input");
    expect(input).toHaveAttribute("data-recording", "true");
    expect(within(input).getByText("按下按键...")).toBeInTheDocument();
    unmount();
    dispose();
  });

  it("starts recording when the shortcut trigger receives focus and cancels on blur", () => {
    const dispose = actionRegistry.register({
      category: "Panel",
      handler: vi.fn(),
      id: "pier.panel.closeOthers",
      surfaces: ["command-palette"],
      title: () => "关闭其他面板",
    });

    const { unmount } = render(<KeybindingsSection />);
    const trigger = screen.getByRole("button", { name: "录制 关闭其他面板" });

    fireEvent.focus(trigger);

    const row = screen.getByTestId("keybinding-row-pier.panel.closeOthers");
    const input = within(row).getByTestId("shortcut-input");
    expect(input).toHaveAttribute("data-recording", "true");

    fireEvent.blur(input);

    expect(within(row).getByTestId("shortcut-input")).not.toHaveAttribute(
      "data-recording"
    );
    unmount();
    dispose();
  });

  it("录制快捷键时由录制状态优先消费 Escape", () => {
    const dispose = actionRegistry.register({
      category: "Panel",
      handler: vi.fn(),
      id: "pier.panel.closeOthers",
      surfaces: ["command-palette"],
      title: () => "关闭其他面板",
    });

    const { unmount } = render(<KeybindingsSection />);
    fireEvent.click(screen.getByRole("button", { name: "录制 关闭其他面板" }));

    const row = screen.getByTestId("keybinding-row-pier.panel.closeOthers");
    expect(within(row).getByTestId("shortcut-input")).toHaveAttribute(
      "data-recording",
      "true"
    );

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(within(row).getByTestId("shortcut-input")).not.toHaveAttribute(
      "data-recording"
    );
    expect(window.pier.preferences.update).not.toHaveBeenCalled();
    unmount();
    dispose();
  });

  it("resets all customized shortcuts from the footer", async () => {
    const dispose = actionRegistry.register({
      category: "Panel",
      handler: vi.fn(),
      id: "pier.panel.newTerminal",
      surfaces: ["command-palette"],
      title: () => "新建终端",
    });

    const { unmount } = render(<KeybindingsSection />);
    fireEvent.click(screen.getByRole("button", { name: "录制 新建终端" }));
    fireEvent.keyDown(window, {
      code: "KeyX",
      ctrlKey: true,
      key: "X",
      shiftKey: true,
    });
    await waitFor(() => {
      expect(window.pier.preferences.update).toHaveBeenCalledWith({
        userKeymap: expect.arrayContaining([
          {
            commandId: "pier.panel.newTerminal",
            keys: "Mod+Shift+KeyX",
            scope: "global",
          },
        ]),
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "全部重置" }));

    await waitFor(() => {
      expect(window.pier.preferences.update).toHaveBeenLastCalledWith({
        userKeymap: [],
      });
    });
    unmount();
    dispose();
  });

  it("shows modifier validation errors as a toast", () => {
    const dispose = actionRegistry.register({
      category: "Panel",
      handler: vi.fn(),
      id: "pier.panel.newTerminal",
      surfaces: ["command-palette"],
      title: () => "新建终端",
    });

    const { unmount } = render(<KeybindingsSection />);
    fireEvent.click(screen.getByRole("button", { name: "录制 新建终端" }));
    fireEvent.keyDown(window, { code: "KeyX", key: "X" });

    expect(toast.error).toHaveBeenCalledWith("请加上修饰键");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();
    dispose();
  });

  it("shows localized conflict errors as a toast", async () => {
    const disposers = [
      actionRegistry.register({
        category: "Panel",
        handler: vi.fn(),
        id: "pier.panel.newTerminal",
        surfaces: ["command-palette"],
        title: () => "新建终端",
      }),
      actionRegistry.register({
        category: "Panel",
        handler: vi.fn(),
        id: "pier.panel.splitRight",
        surfaces: ["command-palette"],
        title: () => "向右拆分",
      }),
    ];

    const { unmount } = render(<KeybindingsSection />);
    fireEvent.click(screen.getByRole("button", { name: "录制 向右拆分" }));
    fireEvent.keyDown(window, {
      code: "KeyT",
      ctrlKey: true,
      key: "T",
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("已被“新建终端”使用");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.pier.preferences.update).not.toHaveBeenCalled();
    unmount();
    for (const dispose of disposers) {
      dispose();
    }
  });

  it("shows conflicts and does not persist the conflicting shortcut", async () => {
    const disposers = [
      actionRegistry.register({
        category: "Panel",
        handler: vi.fn(),
        id: "pier.panel.newTerminal",
        surfaces: ["command-palette"],
        title: () => "新建终端",
      }),
      actionRegistry.register({
        category: "Panel",
        handler: vi.fn(),
        id: "pier.panel.splitRight",
        surfaces: ["command-palette"],
        title: () => "向右拆分",
      }),
    ];

    const { unmount } = render(<KeybindingsSection />);
    fireEvent.click(screen.getByRole("button", { name: "录制 向右拆分" }));
    fireEvent.keyDown(window, {
      code: "KeyT",
      ctrlKey: true,
      key: "T",
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("已被“新建终端”使用");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.pier.preferences.update).not.toHaveBeenCalled();
    unmount();
    for (const dispose of disposers) {
      dispose();
    }
  });

  it("filters the list by title and shows an empty state when nothing matches", () => {
    const disposers = [
      actionRegistry.register({
        category: "Panel",
        handler: vi.fn(),
        id: "pier.panel.newTerminal",
        surfaces: ["command-palette"],
        title: () => "新建终端",
      }),
      actionRegistry.register({
        category: "File",
        handler: vi.fn(),
        id: "pier.files.copyPathWithRange",
        surfaces: ["files/editor"],
        title: () => "复制路径和所选行",
      }),
    ];

    const { unmount } = render(<KeybindingsSection />);
    const search = screen.getByTestId("keybindings-search");
    expect(search).toHaveAttribute("placeholder", "搜索名称或快捷键");
    fireEvent.change(search, { target: { value: "所选行" } });
    expect(
      screen.getByTestId("keybinding-row-pier.files.copyPathWithRange")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("keybinding-row-pier.panel.newTerminal")
    ).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "没有这个命令" } });
    expect(screen.getByText("没有匹配的快捷键")).toBeInTheDocument();
    expect(
      screen.getByText("换个关键词试试，或清空搜索查看全部。")
    ).toBeInTheDocument();
    unmount();
    for (const dispose of disposers) {
      dispose();
    }
  });

  it("cancels an in-progress recording when the search field is focused", () => {
    const dispose = actionRegistry.register({
      category: "Panel",
      handler: vi.fn(),
      id: "pier.panel.newTerminal",
      surfaces: ["command-palette"],
      title: () => "新建终端",
    });

    const { unmount } = render(<KeybindingsSection />);
    fireEvent.click(screen.getByRole("button", { name: "录制 新建终端" }));
    expect(screen.getByText("按下按键...")).toBeInTheDocument();

    fireEvent.focus(screen.getByTestId("keybindings-search"));

    expect(screen.queryByText("按下按键...")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "录制 新建终端" })
    ).toBeInTheDocument();
    unmount();
    dispose();
  });

  it("records a files-panel command without rewriting it as global", async () => {
    const dispose = actionRegistry.register({
      category: "File",
      handler: vi.fn(),
      id: "pier.files.copyPathWithRange",
      surfaces: ["files/editor"],
      title: () => "复制路径和所选行",
    });

    const { unmount } = render(<KeybindingsSection />);
    fireEvent.click(
      screen.getByRole("button", { name: "录制 复制路径和所选行" })
    );
    fireEvent.keyDown(window, {
      altKey: true,
      code: "KeyX",
      ctrlKey: true,
      key: "X",
    });

    await waitFor(() => {
      expect(window.pier.preferences.update).toHaveBeenCalledWith({
        userKeymap: [
          {
            commandId: "-pier.files.copyPathWithRange",
            keys: "",
            scope: "global",
          },
          {
            commandId: "pier.files.copyPathWithRange",
            keys: "Mod+Alt+KeyX",
            scope: "panel:pier.files.filePanel",
          },
        ],
      });
    });
    unmount();
    dispose();
  });

  it("shows a conflict when remapping a files-panel command onto save", async () => {
    const disposers = [
      actionRegistry.register({
        category: "File",
        handler: vi.fn(),
        id: "pier.files.copyPathWithRange",
        surfaces: ["files/editor"],
        title: () => "复制路径和所选行",
      }),
      actionRegistry.register({
        category: "File",
        handler: vi.fn(),
        id: "pier.files.save",
        surfaces: ["files/editor"],
        title: () => "保存",
      }),
    ];

    const { unmount } = render(<KeybindingsSection />);
    fireEvent.click(
      screen.getByRole("button", { name: "录制 复制路径和所选行" })
    );
    fireEvent.keyDown(window, {
      code: "KeyS",
      ctrlKey: true,
      key: "S",
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("已被“保存”使用");
    });
    expect(window.pier.preferences.update).not.toHaveBeenCalled();
    unmount();
    for (const dispose of disposers) {
      dispose();
    }
  });
});
