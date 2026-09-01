/**
 * session 路由身份：panelId + windowId。
 * panelId 跨窗口不唯一；深链可缺 window，打开时须恰好一命中。
 * 与宿主 Web Push `/session?panel=<panelId>&window=<windowId>` 同构。
 */
import { describe, expect, it } from "vitest";
import {
  parseHash,
  projectionBack,
  routeToHash,
} from "../../../apps/mobile-web/src/lib/routes.ts";

describe("session 路由（面板 + 窗口寻址）", () => {
  it("panelId（含需转义字符）经 hash 往返无损", () => {
    const panelId = "panel 1/α&b";
    const hash = routeToHash({ page: "session", panelId, windowId: "w1" });
    expect(parseHash(hash)).toEqual({
      page: "session",
      panelId,
      windowId: "w1",
    });
  });

  it("宿主推送深链同构：/session?panel=&window= 直接可解析", () => {
    expect(
      parseHash(
        `#/session?panel=${encodeURIComponent("p-1")}&window=${encodeURIComponent("w2")}`
      )
    ).toEqual({
      page: "session",
      panelId: "p-1",
      windowId: "w2",
    });
  });

  it("仅 panel 的旧深链仍可解析（打开时须恰好一命中）", () => {
    expect(parseHash(`#/session?panel=${encodeURIComponent("p-1")}`)).toEqual({
      page: "session",
      panelId: "p-1",
    });
  });

  it("缺 panel 参数回落工作台；未知路径回落主机列表", () => {
    expect(parseHash("#/session")).toEqual({ page: "host" });
    expect(parseHash("#/unknown")).toEqual({ page: "hosts" });
  });

  it("changes/files 往返携带可选作用域参数", () => {
    expect(parseHash("#/changes")).toEqual({ page: "changes" });
    expect(parseHash("#/changes?cwd=/repo/wt")).toEqual({
      cwd: "/repo/wt",
      page: "changes",
    });
    expect(
      parseHash(routeToHash({ page: "changes", cwd: "/repo/a b" }))
    ).toEqual({ cwd: "/repo/a b", page: "changes" });
    expect(parseHash("#/files?root=/repo&path=src/a.ts")).toEqual({
      page: "files",
      path: "src/a.ts",
      root: "/repo",
    });
    expect(
      parseHash(routeToHash({ page: "files", path: "README.md", root: "/wt" }))
    ).toEqual({ page: "files", path: "README.md", root: "/wt" });
  });

  it("S2/S3 带回跳会话，无来源则回工作台", () => {
    const from = { panelId: "p-1", windowId: "w2" };
    expect(
      parseHash(
        routeToHash({
          page: "changes",
          cwd: "/repo",
          from,
        })
      )
    ).toEqual({
      cwd: "/repo",
      from,
      page: "changes",
    });
    expect(
      parseHash(
        routeToHash({
          page: "files",
          from: { panelId: "p-1" },
          root: "/wt",
        })
      )
    ).toEqual({
      from: { panelId: "p-1" },
      page: "files",
      root: "/wt",
    });
    expect(projectionBack({ page: "changes", cwd: "/repo", from })).toEqual({
      page: "session",
      panelId: "p-1",
      windowId: "w2",
    });
    expect(projectionBack({ page: "files", root: "/wt" })).toEqual({
      page: "host",
    });
  });
});
