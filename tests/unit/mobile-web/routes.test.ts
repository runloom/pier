/**
 * session 路由身份（M2 修订）：路由携带面板稳定 id（panelId）——
 * 布局持久化、跨窗口迁移不变；移动端无窗口概念，宿主解析当前窗口。
 * 与宿主 Web Push 深链 `/session?panel=<panelId>` 同构。
 * 不用 agentId 产品名（多开同款智能体撞车）。
 */
import { describe, expect, it } from "vitest";
import {
  parseHash,
  routeToHash,
} from "../../../apps/mobile-web/src/lib/routes.ts";

describe("session 路由（面板寻址）", () => {
  it("panelId（含需转义字符）经 hash 往返无损", () => {
    const panelId = "panel 1/α&b";
    const hash = routeToHash({ page: "session", panelId });
    expect(parseHash(hash)).toEqual({ page: "session", panelId });
  });

  it("宿主推送深链同构：/session?panel=<enc(panelId)> 直接可解析", () => {
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
});
