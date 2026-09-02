import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => cleanup());

describe("Alert", () => {
  it("centers the status icon on the first text line", () => {
    const { container } = render(
      <Alert variant="warning">
        <AlertTitle>Only use this on a trusted network</AlertTitle>
        <AlertDescription>
          Remote access uses an unencrypted ws:// link.
        </AlertDescription>
      </Alert>
    );
    const icon = container.querySelector("[data-slot='status-icon']");
    expect(icon).toHaveAttribute("data-size", "md");
    expect(icon?.className).toContain("size-[1lh]");
    expect(icon?.className).toContain("leading-5");
    const root = container.querySelector("[data-slot='alert']");
    expect(root?.className).toContain("leading-5");
    expect(root?.className).toContain("self-start");
    expect(root?.className).not.toContain("row-span-2");
    expect(
      screen.getByText("Only use this on a trusted network")
    ).toBeInTheDocument();
  });

  it("infobar layout flushes to the panel edge without a second card chrome", () => {
    const { container } = render(
      <Alert layout="infobar" variant="warning">
        <AlertTitle>unused import</AlertTitle>
      </Alert>
    );
    const root = container.querySelector("[data-slot='alert']");
    expect(root).toHaveAttribute("data-layout", "infobar");
    expect(root?.className).toContain("rounded-none");
    expect(root?.className).toContain("border-x-0");
    expect(root?.className).toContain("border-t-0");
    expect(root?.className).not.toContain("rounded-2xl");
  });
});
