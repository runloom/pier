import { TerminalOverlayContext } from "@pier/ui/use-terminal-overlay.tsx";
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
  it("registers the portal as a web overlay so the hole mask re-adds it", () => {
    // 补全列表从 composer 向上展开，落在终端 viewport 上；不登记会被
    // native 洞遮罩整块硬裁（composer 卡片自身只登记了卡片区域）。
    const registerElement = vi.fn(() => ({
      dispose: vi.fn(),
      flush: vi.fn(),
    }));
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
      portal
    );
    expect(screen.getByText("suggestion")).toBeInTheDocument();
  });
});
