import type { ReactNode } from "react";
import { MainWindowBoard } from "./boards.tsx";

interface Callout {
  readonly n: number;
  readonly x: number;
  readonly y: number;
  readonly element: string;
  readonly layer: string;
  readonly rules: string;
  readonly forbids: string;
}

const CALLOUTS: readonly Callout[] = [
  { element: "侧栏折叠开关；侧栏只在主窗口", forbids: "子窗口出现侧栏", layer: "L1", n: 1, rules: "§8", x: 90, y: 19 },
  { element: "侧栏上半「项目」树：项目 → 工作树 → 会话；下半工作区级「任务」（一条，不嵌进仓库）；点工作树切换可见区域", forbids: "分支名；议题卡；把任务挂在某个项目下；常驻动画", layer: "L0", n: 2, rules: "§5.2 · R8", x: 118, y: 56 },
  { element: "工作树行：色块 + 名字 + ±N（引用）+ 一个聚合状态点（引用）", forbids: "第二个状态指示", layer: "L0", n: 3, rules: "R2 · R5", x: 118, y: 116 },
  { element: "会话行：智能体品牌图标（与 tab 同槽）+ 标题 + 状态点；只在位于其他窗口时带窗口名", forbids: "提供方首字母方块；实现序号「终端 N」；状态长句", layer: "L0", n: 4, rules: "§5.2 · R4", x: 118, y: 144 },
  { element: "主目录标记：主 checkout 的名字 = 项目名；只在侧栏", forbids: "状态栏重复", layer: "L0", n: 5, rules: "§7.2", x: 118, y: 203 },
  { element: "标题栏中央：窗口名 = 锚 tile 的工作树叶子；切换可见 tile 不变", forbids: "当前工作树名随切换变化", layer: "L1", n: 6, rules: "§5.1", x: 720, y: 19 },
  { element: "标题栏右簇：聚合计数（0 留空）、铃铛、更新；永远同一位置", forbids: "随侧栏折叠出现 / 消失", layer: "L1", n: 7, rules: "R3", x: 1385, y: 19 },
  { element: "分组 tab 条：品牌图标槽 + 标题 + 状态图标槽；选中 tab 顶缘 2px（聚焦 = primary，这也是聚焦区域的唯一标记）；运行 = 顶缘滑块；tab 不带工作树标识", forbids: "状态点 + 顶缘双重编码；任何工作树事实；tab 上的 ±N；区域外框", layer: "L3", n: 8, rules: "R4 · tab 铬金标准", x: 300, y: 55 },
  { element: "分组 +：在此分组新建，宾语 = 本 tile 的工作树（唯一的 +）", forbids: "状态栏第二个 +", layer: "L3", n: 9, rules: "R9 · §9.1", x: 386, y: 55 },
  { element: "视图正文与内容工具栏（审查：范围 / 拆分 / 发送给智能体 / 提交）", forbids: "每视图状态栏；身份；全局状态", layer: "L4", n: 10, rules: "R2 · §5", x: 1140, y: 90 },
  { element: "区域状态栏（底部，今天状态栏的位置，每区域一条）：■ 名字 · ● · 分支 · ±N（= 查看更改）· ↑↓（= 同步）；槽位恒定，值空留空且不进 Tab 序；侧栏悬停 → 名字槽洗底", forbids: "会话状态文字；评论数；每终端各一条；「主目录」", layer: "L2", n: 11, rules: "R2 · R3 · §8", x: 330, y: 886 },
  { element: "⋯：工作树动词表（在新窗口打开 / 提交 / 重命名 / 改色 / 删除…）", forbids: "无宾语的全局菜单", layer: "L2", n: 12, rules: "R9 · §10", x: 1420, y: 886 },
  { element: "打开项目…：与区域状态栏同高同线（28px）；空态与非空态都在；「最近」只在空态", forbids: "推荐区", layer: "L0", n: 13, rules: "§8 · §16", x: 118, y: 886 },
];

function Marker(props: { readonly callout: Callout }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute flex size-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-foreground font-medium text-[10px] text-background tabular-nums shadow-sm"
      style={{ left: props.callout.x, top: props.callout.y }}
    >
      {props.callout.n}
    </span>
  );
}

export function AnatomyBoard(): ReactNode {
  return (
    <div className="flex h-full bg-surface-canvas text-foreground antialiased">
      <div className="relative shrink-0 border-border border-r" style={{ height: 900, width: 1440 }}>
        <div className="pointer-events-none h-full">
          <MainWindowBoard interactive={false} />
        </div>
        {CALLOUTS.map((callout) => (
          <Marker callout={callout} key={callout.n} />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-5 text-[12px] leading-5">
        <div className="font-medium text-[13px]">每个元素指回一条规则</div>
        <ol className="flex flex-col gap-2">
          {CALLOUTS.map((callout) => (
            <li className="flex gap-2.5" key={callout.n}>
              <span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-foreground font-medium text-[10px] text-background tabular-nums">
                {callout.n}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>
                  <span className="mr-1.5 rounded border border-border px-1 font-mono text-[11px] text-muted-foreground">{callout.layer}</span>
                  <span className="text-foreground">{callout.element}</span>
                </span>
                <span className="text-muted-foreground">
                  {callout.rules}
                  {callout.forbids ? ` · 不得包含：${callout.forbids}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <div className="rounded-md border border-border bg-background p-3 text-[12px] text-muted-foreground leading-5">
          与今天的差别：多了侧栏；状态栏还在底部，但从「每终端一条」变成「每区域一条」，最左是工作树身份，智能体状态只在 tab；主窗口一次只显示一个工作树，切换恢复各自布局；子窗口是同一结构的区域墙。几何、token、tab 铬沿用现值。
        </div>
      </div>
    </div>
  );
}
