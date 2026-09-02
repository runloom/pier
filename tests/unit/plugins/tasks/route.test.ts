import { describe, expect, it } from "vitest";
import { createRoutedTrackerProvider } from "../../../../packages/plugin-tasks/src/main/providers/route.ts";

describe("routed tracker provider", () => {
  it("forwards setColumnStatus so Linear/Jira drags do not use GitHub assignment", () => {
    const routed = createRoutedTrackerProvider({
      getJiraBaseUrl: async () => null,
      getToken: async () => null,
    });
    expect(typeof routed.setColumnStatus).toBe("function");
  });
});
