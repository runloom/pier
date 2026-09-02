import { describe, expect, it } from "vitest";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "../../../src/shared/contracts/permissions.ts";

describe("mobile-paired 默认能力集（规格 §10）", () => {
  const mobile = DEFAULT_CAPABILITIES_BY_CLIENT_KIND["mobile-paired"];

  it("默认集收敛为只读监视 + 通知写 + 审查面板同步打开（workspace:open）", () => {
    expect([...mobile].sort()).toEqual(
      [
        "app:read",
        "file:read",
        "git:read",
        "notification:read",
        "notification:write",
        "panel:read",
        "preferences:read",
        "terminal:read",
        "window:read",
        // S2 变更入口与桌面同步 show-or-focus 审查面板（git.openReviewPanel）
        "workspace:open",
        "workspace:read",
        "worktree:read",
      ].sort()
    );
  });

  it("默认集不含任何 *:write（notification:write 除外）与控制类能力", () => {
    for (const cap of mobile) {
      if (cap === "notification:write") continue;
      expect(cap.endsWith(":write"), cap).toBe(false);
      expect(cap.endsWith(":control"), cap).toBe(false);
      // window:* 控制类能力（control/create/focus/close）不得保留；window:read 属只读监视
      expect(
        [
          "window:close",
          "window:control",
          "window:create",
          "window:focus",
        ].includes(cap),
        cap
      ).toBe(false);
    }
  });

  it("remote-access 能力仅授 desktop-renderer", () => {
    for (const capability of [
      "remote-access:read",
      "remote-access:control",
    ] as const) {
      const granted = Object.entries(DEFAULT_CAPABILITIES_BY_CLIENT_KIND)
        .filter(([, caps]) => caps.includes(capability))
        .map(([kind]) => kind);
      expect(granted, capability).toEqual(["desktop-renderer"]);
    }
  });
});
