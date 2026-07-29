import { afterEach, describe, expect, it } from "vitest";
import {
  filesLspEventHasNoModifiers,
  isFilesLspDefinitionModifier,
  isFilesLspMultiCursorModifier,
} from "../../../src/plugins/builtin/files/renderer/files-lsp-pointer-modifiers.ts";

const ORIGINAL = Object.getOwnPropertyDescriptor(navigator, "platform");

function setPlatform(platform: string): void {
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: platform,
  });
}

afterEach(() => {
  if (ORIGINAL) {
    Object.defineProperty(navigator, "platform", ORIGINAL);
  }
});

describe("files LSP pointer modifiers", () => {
  it("uses Meta alone as definition modifier on macOS", () => {
    setPlatform("MacIntel");
    expect(
      isFilesLspDefinitionModifier({
        altKey: false,
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
      } as MouseEvent)
    ).toBe(true);
    expect(
      isFilesLspDefinitionModifier({
        altKey: false,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      } as MouseEvent)
    ).toBe(false);
  });

  it("uses Ctrl alone as definition modifier on Linux", () => {
    setPlatform("Linux x86_64");
    expect(
      isFilesLspDefinitionModifier({
        altKey: false,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      } as MouseEvent)
    ).toBe(true);
    expect(
      isFilesLspDefinitionModifier({
        altKey: false,
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
      } as MouseEvent)
    ).toBe(false);
  });

  it("uses Alt alone as multi-cursor modifier and never overlaps definition", () => {
    setPlatform("MacIntel");
    const altOnly = {
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    } as MouseEvent;
    expect(isFilesLspMultiCursorModifier(altOnly)).toBe(true);
    expect(isFilesLspDefinitionModifier(altOnly)).toBe(false);

    const metaOnly = {
      altKey: false,
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
    } as MouseEvent;
    expect(isFilesLspMultiCursorModifier(metaOnly)).toBe(false);
    expect(isFilesLspDefinitionModifier(metaOnly)).toBe(true);
  });

  it("rejects chords for both modifiers", () => {
    setPlatform("MacIntel");
    expect(
      isFilesLspDefinitionModifier({
        altKey: true,
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
      } as MouseEvent)
    ).toBe(false);
    expect(
      isFilesLspMultiCursorModifier({
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
      } as MouseEvent)
    ).toBe(false);
    expect(
      filesLspEventHasNoModifiers({
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      } as MouseEvent)
    ).toBe(true);
  });
});
