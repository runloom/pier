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
});
