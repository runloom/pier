import {
  TerminalOverlayContext,
  type TerminalOverlayOptions,
} from "@pier/ui/use-terminal-overlay.tsx";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComposerAutocompletePortal } from "@/panel-kits/terminal/structured-composer/composer-autocomplete-portal.tsx";

function makeAnchor(): HTMLElement {
  const anchor = document.createElement("div");
  anchor.getBoundingClientRect = () =>
    ({
      bottom: 250,
      height: 50,
      left: 40,
      right: 440,
      toJSON: () => ({}),
      top: 200,
      width: 400,
      x: 40,
      y: 200,
    }) as DOMRect;
  return anchor;
}

describe("ComposerAutocompletePortal", () => {
  it("registers the portal but samples appearance from the painted list card", () => {
    // 补全列表从 composer 向上展开，落在终端 viewport 上；不登记会被
    // native 洞遮罩整块硬裁。portal 外壳只做 fixed 定位，圆角 / 阴影 /
    // 底在列表卡片上——外观必须读卡片，否则回填按直角切角且无阴影。
    const registerElement = vi.fn(
      (_id: string, _el: HTMLElement, _options?: TerminalOverlayOptions) => ({
        dispose: vi.fn(),
        flush: vi.fn(),
      })
    );
    render(
      <TerminalOverlayContext.Provider value={{ registerElement }}>
        <ComposerAutocompletePortal anchor={makeAnchor()}>
          <div>suggestion</div>
        </ComposerAutocompletePortal>
      </TerminalOverlayContext.Provider>
    );

    const portal = screen.getByTestId("terminal-composer-autocomplete-portal");
    expect(registerElement).toHaveBeenCalledWith(
      expect.stringMatching(/^terminal-overlay:/u),
      portal,
      expect.objectContaining({ appearanceElement: expect.any(Function) })
    );
    const options = registerElement.mock.calls[0]?.[2];
    expect(options?.appearanceElement?.()).toBe(screen.getByText("suggestion"));
    expect(screen.getByText("suggestion")).toBeInTheDocument();
  });
});
