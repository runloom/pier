import {
  commitRangeRole,
  commitRangeVisual,
  committedRangeFromSelection,
  isCommitCheckboxChecked,
  oidsForClickOrder,
  orderCommitRangeByNewestFirst,
  previewCommitRange,
  resolveCommitClick,
  visibleCommitCountInRange,
} from "@plugins/builtin/git/renderer/review/scope/commit-range.ts";
import { describe, expect, it } from "vitest";

const newest = "b".repeat(40);
const middle = "m".repeat(40);
const oldest = "a".repeat(40);
const newestFirstOids = [newest, middle, oldest];

describe("commit range helpers", () => {
  it("按新→旧列表把两端排成 newest/oldest", () => {
    expect(
      orderCommitRangeByNewestFirst(oldest, newest, newestFirstOids)
    ).toEqual({ newestOid: newest, oldestOid: oldest });
    expect(
      orderCommitRangeByNewestFirst(newest, oldest, newestFirstOids)
    ).toEqual({ newestOid: newest, oldestOid: oldest });
  });

  it("列表里缺一端时不猜新旧，点击退回单选", () => {
    expect(orderCommitRangeByNewestFirst(oldest, newest, [newest])).toBeNull();
    expect(
      resolveCommitClick({
        clickedOid: newest,
        newestFirstOids: [newest],
        originOid: oldest,
      })
    ).toEqual({
      originOid: newest,
      target: { kind: "commit", oid: newest },
    });
  });

  it("无原点或点回原点时立刻单选", () => {
    expect(
      resolveCommitClick({
        clickedOid: newest,
        newestFirstOids,
        originOid: null,
      })
    ).toEqual({
      originOid: newest,
      target: { kind: "commit", oid: newest },
    });
    expect(
      resolveCommitClick({
        clickedOid: newest,
        newestFirstOids,
        originOid: newest,
      })
    ).toEqual({
      originOid: newest,
      target: { kind: "commit", oid: newest },
    });
  });

  it("从原点点另一篇得到范围，原点改到最后一击", () => {
    expect(
      resolveCommitClick({
        clickedOid: oldest,
        newestFirstOids,
        originOid: newest,
      })
    ).toEqual({
      originOid: oldest,
      target: { fromOid: oldest, kind: "commit", oid: newest },
    });
  });

  it("已有范围后以上一击为原点再点第三篇", () => {
    expect(
      resolveCommitClick({
        clickedOid: oldest,
        newestFirstOids,
        originOid: middle,
      })
    ).toEqual({
      originOid: oldest,
      target: { fromOid: oldest, kind: "commit", oid: middle },
    });
  });

  it("hover 预览从原点连到指针，不改已选勾选", () => {
    const preview = previewCommitRange({
      hoverOid: oldest,
      newestFirstOids,
      originOid: newest,
    });
    expect(preview).toEqual({ newestOid: newest, oldestOid: oldest });
    expect(commitRangeRole(newest, preview, newestFirstOids)).toBe("start");
    expect(commitRangeRole(middle, preview, newestFirstOids)).toBe("middle");
    expect(commitRangeRole(oldest, preview, newestFirstOids)).toBe("end");
    const visual = commitRangeVisual(
      middle,
      newest,
      null,
      preview,
      newestFirstOids
    );
    expect(visual.checked).toBe(false);
    expect(visual.marker).toBe("dot");
    expect(visual.previewRole).toBe("middle");
    expect(isCommitCheckboxChecked(newest, newest, null)).toBe(true);
    expect(isCommitCheckboxChecked(oldest, newest, null)).toBe(false);
    expect(visibleCommitCountInRange(oldest, newest, newestFirstOids)).toBe(3);
  });

  it("已选范围实线与悬停预览分开，中间为小圆", () => {
    const committed = committedRangeFromSelection({
      fromOid: oldest,
      kind: "commit",
      oid: newest,
    });
    const preview = previewCommitRange({
      hoverOid: oldest,
      newestFirstOids,
      originOid: newest,
    });
    const origin = commitRangeVisual(
      newest,
      newest,
      committed,
      preview,
      newestFirstOids
    );
    expect(origin.checked).toBe(true);
    expect(origin.marker).toBe("checkbox");
    expect(origin.committedRole).toBe("start");
    const mid = commitRangeVisual(
      middle,
      newest,
      committed,
      preview,
      newestFirstOids
    );
    expect(mid.checked).toBe(false);
    expect(mid.marker).toBe("dot");
    expect(mid.committedRole).toBe("middle");
    expect(mid.previewRole).toBe("middle");
  });

  it("中间圆点在 hover 时升为勾选框，选择态优先", () => {
    const committed = committedRangeFromSelection({
      fromOid: oldest,
      kind: "commit",
      oid: newest,
    });
    const hovered = commitRangeVisual(
      middle,
      newest,
      committed,
      null,
      newestFirstOids,
      { highlighted: false, hovered: true }
    );
    expect(hovered.checked).toBe(false);
    expect(hovered.marker).toBe("checkbox");
    const selected = commitRangeVisual(
      newest,
      newest,
      committed,
      null,
      newestFirstOids,
      { highlighted: false, hovered: true }
    );
    expect(selected.checked).toBe(true);
    expect(selected.marker).toBe("checkbox");
  });

  it("过滤后仍用未过滤顺序给点击定两端", () => {
    expect(
      oidsForClickOrder(newest, oldest, newestFirstOids, [oldest])
    ).toEqual(newestFirstOids);
    expect(oidsForClickOrder(newest, oldest, [], [oldest])).toEqual([oldest]);
  });
});
