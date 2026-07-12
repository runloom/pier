import {
  fileNameFromTabIconId,
  fileTabIconId,
  PierFileIcon,
} from "@pier/ui/file-icon.tsx";
import { pierFileTreeStyle } from "@pier/ui/file-tree-style.ts";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

describe("Pier file icon", () => {
  afterEach(() => {
    document.querySelector('[data-pier-file-icon-sprite="true"]')?.remove();
  });
  it("encodes only the basename in a namespaced tab icon id", () => {
    const iconId = fileTabIconId("src/components/file.tsx");

    expect(iconId).toBe("pier.file:file.tsx");
    expect(fileNameFromTabIconId(iconId)).toBe("file.tsx");
    expect(fileNameFromTabIconId("pier.file:%E0%A4%A")).toBeNull();
    expect(fileNameFromTabIconId("terminal")).toBeNull();
  });

  it("uses the complete file-tree resolver and shared color token", () => {
    const { container } = render(<PierFileIcon fileName="src/file.ts" />);
    const icon = container.querySelector("[data-pier-file-icon]");

    expect(icon).toHaveAttribute("data-icon-token", "typescript");
    expect(icon).toHaveStyle({ color: "var(--pier-file-icon-blue)" });
    expect(icon?.querySelector("use")).toHaveAttribute(
      "href",
      "#file-tree-builtin-typescript"
    );
    expect(pierFileTreeStyle(undefined)).toMatchObject({
      "--trees-file-icon-color-typescript": "var(--pier-file-icon-blue)",
    });
  });

  it("mounts one shared complete sprite sheet for multiple icons", () => {
    render(
      <>
        <PierFileIcon fileName="file.ts" />
        <PierFileIcon fileName="README.md" />
      </>
    );

    expect(
      document.querySelectorAll(
        '[data-pier-file-icon-sprite="true"] #file-tree-builtin-typescript'
      )
    ).toHaveLength(1);
  });
});
