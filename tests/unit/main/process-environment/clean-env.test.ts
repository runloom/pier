import {
  omitHostColorPolicyEnv,
  stripHostColorPolicyFromProcessEnv,
} from "@main/services/process-environment/clean-env.ts";
import { afterEach, describe, expect, it } from "vitest";

describe("host color policy env", () => {
  const previous = {
    CLICOLOR: process.env.CLICOLOR,
    CLICOLOR_FORCE: process.env.CLICOLOR_FORCE,
    FORCE_COLOR: process.env.FORCE_COLOR,
    NO_COLOR: process.env.NO_COLOR,
    NODE_DISABLE_COLORS: process.env.NODE_DISABLE_COLORS,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  });

  it("omits NO_COLOR and zeroed force flags, keeps FORCE_COLOR=1", () => {
    const next = omitHostColorPolicyEnv({
      CLICOLOR: "0",
      FORCE_COLOR: "1",
      NO_COLOR: "1",
      NODE_DISABLE_COLORS: "1",
      PATH: "/usr/bin",
    });
    expect(next).toEqual({ FORCE_COLOR: "1", PATH: "/usr/bin" });
  });

  it("strips disable keys from process.env", () => {
    process.env.NO_COLOR = "1";
    process.env.FORCE_COLOR = "0";
    process.env.CLICOLOR = "1";
    const removed = stripHostColorPolicyFromProcessEnv();
    expect(removed).toEqual(
      expect.arrayContaining(["NO_COLOR", "FORCE_COLOR"])
    );
    expect(process.env.NO_COLOR).toBeUndefined();
    expect(process.env.FORCE_COLOR).toBeUndefined();
    expect(process.env.CLICOLOR).toBe("1");
  });
});
