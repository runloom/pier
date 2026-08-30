import { mapCommandError } from "@main/app-core/command-error-mapping.ts";
import { describe, expect, it } from "vitest";

function errno(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe("mapCommandError errno fidelity", () => {
  it("maps ENOENT to not_found", () => {
    const result = mapCommandError("r1", errno("ENOENT", "no such file"));
    expect(result).toMatchObject({
      error: { code: "not_found" },
      ok: false,
    });
  });

  it("maps EPERM (macOS TCC denial) to permission_denied", () => {
    const result = mapCommandError(
      "r2",
      errno(
        "EPERM",
        "EPERM: operation not permitted, scandir '/Users/u/Desktop'"
      )
    );
    expect(result).toMatchObject({
      error: { code: "permission_denied", osCode: "EPERM" },
      ok: false,
    });
  });

  it("maps EACCES to permission_denied", () => {
    const result = mapCommandError("r3", errno("EACCES", "permission denied"));
    expect(result).toMatchObject({
      error: { code: "permission_denied", osCode: "EACCES" },
      ok: false,
    });
  });

  it("preserves osCode when re-mapping permission_denied", () => {
    const err = new Error("blocked") as Error & {
      code: string;
      osCode: string;
    };
    err.code = "permission_denied";
    err.osCode = "EPERM";
    const result = mapCommandError("r5", err);
    expect(result).toMatchObject({
      error: { code: "permission_denied", osCode: "EPERM" },
      ok: false,
    });
  });

  it("keeps unknown errors as internal_error", () => {
    const result = mapCommandError("r4", new Error("boom"));
    expect(result).toMatchObject({
      error: { code: "internal_error", message: "boom" },
      ok: false,
    });
  });
});
