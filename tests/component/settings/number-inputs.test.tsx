import { render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { CodeFontSizeRow } from "@/pages/settings/components/rows/code-font-size-row.tsx";
import { MonoFontSizeRow } from "@/pages/settings/components/rows/mono-font-size-row.tsx";
import { ShellEnvironmentBlock } from "@/pages/settings/components/terminal/shell-environment-block.tsx";
import { TerminalSection } from "@/pages/settings/components/terminal-section.tsx";
import { useShellEnvironmentStore } from "@/stores/shell-environment.store.ts";

function expectUnitNumberInput(
  label: string,
  unit: string,
  groupWidthClass = "w-28"
): HTMLElement {
  const input = screen.getByLabelText(label);
  expect(input).toHaveAttribute("type", "number");
  expect(input).toHaveAttribute("inputmode", "numeric");
  // Width lives on InputGroup shell (suffix layout), not the bare input.
  const group = input.closest('[data-slot="input-group"]');
  expect(group).toBeTruthy();
  expect(group).toHaveClass(groupWidthClass);
  expect(group).not.toHaveClass("w-[240px]");
  expect(within(group as HTMLElement).getByText(unit)).toBeTruthy();
  // Unit is exposed to assistive tech via aria-describedby.
  const unitId = input.getAttribute("aria-describedby")?.split(/\s+/).at(-1);
  expect(unitId).toBeTruthy();
  expect(document.getElementById(unitId as string)?.textContent).toBe(unit);
  return input;
}

describe("settings number inputs", () => {
  beforeAll(async () => {
    await initI18n();
    await i18next.changeLanguage("zh-CN");
  });

  beforeEach(() => {
    useShellEnvironmentStore.setState({
      disabled: false,
      timeoutMs: 10_000,
      hostStatus: null,
      loading: false,
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        shellEnvironment: {
          status: vi.fn(async () => ({
            platform: "darwin",
            shellEnvStatus: "resolved",
          })),
        },
        preferences: {
          update: vi.fn(async () => ({})),
        },
      },
    });
  });

  it("renders the terminal font size setting with px suffix", () => {
    render(<MonoFontSizeRow />);
    expectUnitNumberInput("终端字号", "px");
  });

  it("renders the code font size setting with px suffix", () => {
    render(<CodeFontSizeRow />);
    expectUnitNumberInput("代码字号", "px");
  });

  it("renders the terminal scrollback setting with MB suffix", () => {
    render(<TerminalSection />);
    expectUnitNumberInput("滚动历史上限", "MB");
  });

  it("renders the shell environment timeout with seconds suffix", () => {
    render(<ShellEnvironmentBlock />);
    expectUnitNumberInput("加载超时", "秒");
  });
});
