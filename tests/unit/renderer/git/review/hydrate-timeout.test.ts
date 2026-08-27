import { describe, expect, it } from "vitest";
import {
  createHydrateTimeoutWatchdog,
  GIT_REVIEW_BODY_HYDRATE_TIMEOUT_MS,
  GIT_REVIEW_SELECTED_BODY_HYDRATE_TIMEOUT_MS,
} from "../../../../../src/plugins/builtin/git/renderer/review/document/hydrate-timeout.ts";

describe("createHydrateTimeoutWatchdog", () => {
  it("times out demanded idle entries after the gold-standard window", () => {
    let now = 0;
    const watchdog = createHydrateTimeoutWatchdog({
      now: () => now,
      timeoutMs: GIT_REVIEW_BODY_HYDRATE_TIMEOUT_MS,
    });
    const kinds = new Map<string, "idle" | "loaded">([
      ["a", "idle"],
      ["b", "idle"],
    ]);
    expect(watchdog.noteDemanded(["a", "b"], (key) => kinds.get(key))).toEqual(
      []
    );
    now = GIT_REVIEW_BODY_HYDRATE_TIMEOUT_MS - 1;
    expect(watchdog.noteDemanded(["a", "b"], (key) => kinds.get(key))).toEqual(
      []
    );
    now = GIT_REVIEW_BODY_HYDRATE_TIMEOUT_MS;
    expect(watchdog.noteDemanded(["a", "b"], (key) => kinds.get(key))).toEqual([
      "a",
      "b",
    ]);
  });

  it("clears tracking when loaded or no longer demanded", () => {
    let now = 0;
    const watchdog = createHydrateTimeoutWatchdog({
      now: () => now,
      timeoutMs: 1000,
    });
    const kinds = new Map<string, "idle" | "loaded" | "error">([["a", "idle"]]);
    watchdog.noteDemanded(["a"], (key) => kinds.get(key));
    kinds.set("a", "loaded");
    now = 2000;
    expect(watchdog.noteDemanded(["a"], (key) => kinds.get(key))).toEqual([]);
    kinds.set("a", "idle");
    watchdog.noteDemanded(["a"], (key) => kinds.get(key));
    now = 4000;
    expect(watchdog.noteDemanded([], (key) => kinds.get(key))).toEqual([]);
  });

  it("gives the selected entry a longer budget than neighbors", () => {
    let now = 0;
    const watchdog = createHydrateTimeoutWatchdog({ now: () => now });
    expect(
      watchdog.noteDemanded(
        ["neighbor", "selected"],
        () => "loading",
        "selected"
      )
    ).toEqual([]);
    now = GIT_REVIEW_BODY_HYDRATE_TIMEOUT_MS;
    expect(
      watchdog.noteDemanded(
        ["neighbor", "selected"],
        () => "loading",
        "selected"
      )
    ).toEqual(["neighbor"]);
    now = GIT_REVIEW_SELECTED_BODY_HYDRATE_TIMEOUT_MS;
    expect(
      watchdog.noteDemanded(
        ["neighbor", "selected"],
        () => "loading",
        "selected"
      )
    ).toEqual(["selected"]);
  });
});
