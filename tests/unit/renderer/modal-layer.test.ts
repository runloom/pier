import { afterEach, describe, expect, it } from "vitest";
import {
  isTopmostModalContent,
  OPEN_MODAL_CONTENT_SELECTOR,
} from "../../../packages/ui/src/modal-layer.ts";

describe("modal layer stack", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("exports both dialog and alert-dialog content slots", () => {
    expect(OPEN_MODAL_CONTENT_SELECTOR).toContain("dialog-content");
    expect(OPEN_MODAL_CONTENT_SELECTOR).toContain("alert-dialog-content");
  });

  it("treats a single open modal as topmost", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("data-slot", "dialog-content");
    document.body.append(dialog);
    expect(isTopmostModalContent(dialog)).toBe(true);
  });

  it("only the last mounted modal is topmost", () => {
    const settings = document.createElement("div");
    settings.setAttribute("data-slot", "dialog-content");
    const nested = document.createElement("div");
    nested.setAttribute("data-slot", "dialog-content");
    document.body.append(settings, nested);

    expect(isTopmostModalContent(settings)).toBe(false);
    expect(isTopmostModalContent(nested)).toBe(true);
    expect(
      isTopmostModalContent(
        nested.appendChild(document.createElement("button"))
      )
    ).toBe(true);
  });

  it("treats alert-dialog as a stack peer", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("data-slot", "dialog-content");
    const alert = document.createElement("div");
    alert.setAttribute("data-slot", "alert-dialog-content");
    document.body.append(dialog, alert);

    expect(isTopmostModalContent(dialog)).toBe(false);
    expect(isTopmostModalContent(alert)).toBe(true);
  });
});
