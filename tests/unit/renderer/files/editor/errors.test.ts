import {
  isFolderAccessBlockedError,
  isPermissionDeniedError,
} from "@plugins/builtin/files/renderer/editor/errors.ts";
import { describe, expect, it } from "vitest";

describe("folder-access error detection", () => {
  it("treats only permission_denied + EPERM as the TCC guide", () => {
    const eperm = Object.assign(new Error("blocked"), {
      code: "permission_denied",
      osCode: "EPERM",
    });
    const eacces = Object.assign(new Error("denied"), {
      code: "permission_denied",
      osCode: "EACCES",
    });
    const plain = Object.assign(new Error("denied"), {
      code: "permission_denied",
    });
    expect(isPermissionDeniedError(eperm)).toBe(true);
    expect(isFolderAccessBlockedError(eperm)).toBe(true);
    expect(isFolderAccessBlockedError(eacces)).toBe(false);
    expect(isFolderAccessBlockedError(plain)).toBe(false);
    expect(isFolderAccessBlockedError(new Error("blocked"))).toBe(false);
  });
});
