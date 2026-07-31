import { render, screen } from "@testing-library/react";
import i18next from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { CodeFontSizeRow } from "@/pages/settings/components/rows/code-font-size-row.tsx";
import { MonoFontSizeRow } from "@/pages/settings/components/rows/mono-font-size-row.tsx";
import { TerminalSection } from "@/pages/settings/components/terminal-section.tsx";

describe("settings number inputs", () => {
  beforeAll(async () => {
    await initI18n();
    await i18next.changeLanguage("zh-CN");
  });

  it("renders the terminal font size setting as a compact number input", () => {
    render(<MonoFontSizeRow />);

    const input = screen.getByLabelText("终端字号");

    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveClass("w-24");
    expect(input).not.toHaveClass("w-[240px]");
  });

  it("renders the code font size setting as a compact number input", () => {
    render(<CodeFontSizeRow />);

    const input = screen.getByLabelText("代码字号");

    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveClass("w-24");
    expect(input).not.toHaveClass("w-[240px]");
  });

  it("renders the terminal scrollback setting as a compact number input", () => {
    render(<TerminalSection />);

    const input = screen.getByLabelText("滚动历史上限");

    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveClass("w-24");
    expect(input).not.toHaveClass("w-[240px]");
  });
});
