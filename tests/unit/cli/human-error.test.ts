import { describe, expect, it } from "vitest";
import { formatCliHumanError } from "../../../bin/pier-cli-human.js";

const machineMessage =
  "path not found: /tmp/pier-does-not-exist-xyz. Pier does not create files. Create it first, then retry.";

describe("formatCliHumanError", () => {
  it("prints the English next-step without an error-code prefix", () => {
    expect(formatCliHumanError("not_found", machineMessage)).toBe(
      machineMessage
    );
  });

  it("keeps other errors as code: message", () => {
    expect(formatCliHumanError("not_found", "panel not found: missing")).toBe(
      "not_found: panel not found: missing"
    );
  });
});
