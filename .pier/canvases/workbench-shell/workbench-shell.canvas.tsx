import { Artboard, Layer, WorldStage } from "pier/canvas";
import type { ReactNode } from "react";
import { AnatomyBoard } from "./anatomy.tsx";
import { DropRulesBoard, FirstRunBoard, MainWindowBoard, SubWindowBoard } from "./boards.tsx";

/**
 * 工作台骨架设计稿。规范：docs/superpowers/specs/2026-09-07-workbench-worktree-tiles-design.md。
 */
export const canvas = {
  description:
    "Pier 工作台骨架：主窗口（侧栏 + 一个工作树 tile，切换恢复各自布局）、子窗口（tile 墙）、拖拽落点规则、首启与加载、解剖图。规范见 2026-09-07-workbench-worktree-tiles-design.md。",
  kind: "composition" as const,
  title: "工作台骨架 · 工作树 tile",
};

const W = 1440;
const H = 900;
const CAPTION_H = 56;
const GAP = 80;
const ORIGIN = 40;
const ROW_2 = ORIGIN + H + CAPTION_H + GAP;
const ROW_3 = ROW_2 + H + CAPTION_H + GAP;

function CommentFrame(props: { readonly children: ReactNode; readonly id: string }): ReactNode {
  return (
    <div className="h-full" data-pier-comment-id={props.id}>
      {props.children}
    </div>
  );
}

export default function WorkbenchShellCanvas(): ReactNode {
  return (
    <WorldStage padding={40}>
      <Layer x={ORIGIN} y={ORIGIN}>
        <Artboard
          description="唯一带侧栏的窗口。上半是项目树，下半是「任务」（工作区级，只有一条）。点工作树只切主窗；点会话「连接数指标」预告跳窗；点「任务」在当前区域打开已有任务跟踪面板。"
          height={H}
          label="B1"
          title="主窗口"
          width={W}
        >
          <CommentFrame id="main">
            <MainWindowBoard />
          </CommentFrame>
        </Artboard>
      </Layer>
      <Layer x={ORIGIN + W + GAP} y={ORIGIN}>
        <Artboard
          description="没有侧栏；标题栏「+ 工作树」是它的索引入口；窗口名 = 锚叶子 · +N。四个区域各是完整的工作树（pane 树 + 底部状态栏），同一结构只是数量不同；pier 的状态栏顶缘在读取 git 事实。可点：点区域切换聚焦（唯一标记 = S3 选中线）。"
          height={H}
          label="B2"
          title="子窗口（tile 墙）"
          width={W}
        >
          <CommentFrame id="sub">
            <SubWindowBoard />
          </CommentFrame>
        </Artboard>
      </Layer>
      <Layer x={ORIGIN} y={ROW_2}>
        <Artboard
          description="把 pier-login 的一个 tab 拖到三种窗口：已有（含隐藏）则恢复；没有则停住弹簧替换 / 边缘新建。第四格：区域与侧栏行可落到任何窗口。底部是 §9.2 全表。"
          height={760}
          label="B3"
          title="拖拽落点（§9.2）"
          width={W + 420}
        >
          <CommentFrame id="drop-rules">
            <DropRulesBoard />
          </CommentFrame>
        </Artboard>
      </Layer>
      <Layer x={ORIGIN + W + 420 + GAP} y={ROW_2}>
        <Artboard
          description="B1 的静态快照加 13 个编号：每个元素属于哪一层、来自哪条规则、不得包含什么。"
          height={H}
          label="B4"
          title="解剖图"
          width={W + 480}
        >
          <CommentFrame id="anatomy">
            <AnatomyBoard />
          </CommentFrame>
        </Artboard>
      </Layer>
      <Layer x={ORIGIN} y={ROW_3}>
        <Artboard
          description="左：首启 / 无项目（侧栏空态 + 最近；窗口名 `~`；退化单元一个终端）。右：加载与后台操作——侧栏页头滑块、待建行、区域状态栏顶缘滑块、tab 顶缘滑块，全部同一条不定长滑块。"
          height={760}
          label="B5"
          title="首启与加载（§8 · R6）"
          width={W}
        >
          <CommentFrame id="first-run">
            <FirstRunBoard />
          </CommentFrame>
        </Artboard>
      </Layer>
    </WorldStage>
  );
}
