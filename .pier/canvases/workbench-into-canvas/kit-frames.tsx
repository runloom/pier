import { Artboard, ArtboardStage } from "pier/canvas";
import type { ReactNode } from "react";
import { SettingsChrome } from "./chrome.tsx";
import { MaterialsDetailDialog, MaterialsList } from "./kit-pages.tsx";
import type { SchemeData } from "./model.ts";

type Frame = SchemeData["data"]["productFrames"][number];

function frameOf(frames: Frame[], id: string): Frame {
  const frame = frames.find((item) => item.id === id);
  return frame ?? { id, name: id, spec: "" };
}

function Board({
  children,
  frame,
  height = 800,
  width = 1280,
}: {
  children: ReactNode;
  frame: Frame;
  height?: number;
  width?: number;
}) {
  return (
    <Artboard
      description={frame.spec}
      height={height}
      label={frame.id}
      title={frame.name}
      width={width}
    >
      {children}
    </Artboard>
  );
}

export function KitFrames({ frames }: { frames: Frame[] }) {
  const k1 = frameOf(frames, "K1");
  const k2 = frameOf(frames, "K2");
  const k3 = frameOf(frames, "K3");
  return (
    <ArtboardStage expandLabel="全屏查看" title="Canvas 物料设计稿">
      <Board frame={k1}>
        <SettingsChrome>
          <MaterialsList idPrefix="k1" />
        </SettingsChrome>
      </Board>
      <Board frame={k2}>
        <SettingsChrome>
          <MaterialsList filter="控件" idPrefix="k2" />
        </SettingsChrome>
      </Board>
      <Board frame={k3}>
        <div className="relative h-full">
          <div aria-hidden className="h-full" inert>
            <SettingsChrome>
              <MaterialsList idPrefix="k3" selected="Button" />
            </SettingsChrome>
          </div>
          <MaterialsDetailDialog />
        </div>
      </Board>
    </ArtboardStage>
  );
}
