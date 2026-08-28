import { describe, expect, it } from "vitest";
import {
  charsToCode,
  nativeForwardCharToCode,
} from "@/lib/keybindings/native-forward-code.ts";

describe("nativeForwardCharToCode", () => {
  it("unshifts AppKit Shift+punctuation to KeyboardEvent.code names", () => {
    expect(nativeForwardCharToCode("{")).toBe("BracketLeft");
    expect(nativeForwardCharToCode("}")).toBe("BracketRight");
    expect(nativeForwardCharToCode("+")).toBe("Equal");
    expect(nativeForwardCharToCode("_")).toBe("Minus");
    expect(nativeForwardCharToCode("[")).toBeNull();
    expect(nativeForwardCharToCode("]")).toBeNull();
    expect(nativeForwardCharToCode("=")).toBeNull();
  });
});

describe("charsToCode", () => {
  it("maps shifted and unshifted punctuation used by default shortcuts", () => {
    expect(charsToCode("{")).toBe("BracketLeft");
    expect(charsToCode("}")).toBe("BracketRight");
    expect(charsToCode("+")).toBe("Equal");
    expect(charsToCode("[")).toBe("BracketLeft");
    expect(charsToCode("]")).toBe("BracketRight");
    expect(charsToCode("=")).toBe("Equal");
    expect(charsToCode("\r")).toBe("Enter");
  });
});
