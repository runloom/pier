import { useFilesInFileSearchEscape } from "@plugins/builtin/files/renderer/search/use-in-file-search-escape.ts";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

function Harness({
  onClose,
  withDialog = false,
  withMenu = false,
}: {
  onClose: () => void;
  withDialog?: boolean;
  withMenu?: boolean;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(true);
  useFilesInFileSearchEscape(
    open,
    () => {
      setOpen(false);
      onClose();
    },
    surfaceRef
  );
  return (
    <div data-testid="surface" ref={surfaceRef} tabIndex={-1}>
      {open ? <span data-testid="search-open">open</span> : null}
      <button type="button">editor</button>
      {withDialog ? (
        <div role="dialog">
          <button type="button">dialog action</button>
        </div>
      ) : null}
      {withMenu ? (
        <div role="menu">
          <button role="menuitem" type="button">
            menu item
          </button>
        </div>
      ) : null}
    </div>
  );
}

describe("useFilesInFileSearchEscape", () => {
  it("closes when Escape is pressed with focus inside the surface but outside the find field", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    const surface = screen.getByTestId("surface");
    const editor = screen.getByRole("button", { name: "editor" });
    editor.focus();
    expect(screen.getByTestId("search-open")).toBeVisible();

    fireEvent.keyDown(editor, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("search-open")).toBeNull();
    expect(surface).toBeInTheDocument();
  });

  it("does not close when Escape originates outside the surface", () => {
    const onClose = vi.fn();
    render(
      <>
        <Harness onClose={onClose} />
        <button type="button">outside</button>
      </>
    );

    const outside = screen.getByRole("button", { name: "outside" });
    outside.focus();
    fireEvent.keyDown(outside, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("search-open")).toBeVisible();
  });

  it("does not close when focus is inside a dialog on the surface", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} withDialog />);

    const dialogAction = screen.getByRole("button", { name: "dialog action" });
    dialogAction.focus();
    fireEvent.keyDown(dialogAction, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("search-open")).toBeVisible();
  });

  it("does not close when focus is inside a menu on the surface", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} withMenu />);

    const menuItem = screen.getByRole("menuitem", { name: "menu item" });
    menuItem.focus();
    fireEvent.keyDown(menuItem, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("search-open")).toBeVisible();
  });
});
