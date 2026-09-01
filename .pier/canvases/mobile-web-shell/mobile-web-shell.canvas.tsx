import { Artboard, Layer, Text, WorldStage } from "pier/canvas";
import { type ReactNode, useState } from "react";
import { CaptionCard } from "./chrome.tsx";
import { MotionKitScreen, PressKitScreen } from "./kits.tsx";
import {
  ChangesScreen,
  DEMO,
  FilesScreen,
  HostScreen,
  HostsScreen,
  NotificationsScreen,
  PairScreen,
  SessionScreen,
} from "./screens.tsx";
import { SlideStack } from "./slide.tsx";

/**
 * 移动端 Web 壳视觉稿。信息架构仍以
 * docs/superpowers/specs/2026-08-26-mobile-companion-design.md §11 为准；
 * 本画板只定触控语言、密度和七面外观。
 */
export const canvas = {
  description:
    "Pier 移动端 Web 壳的手机画板：主机推入这台电脑，铃铛打开收件箱。不是信息架构真源。",
  kind: "composition" as const,
  title: "移动端 Web 壳",
};

const FRAME_W = 393;
/** 手机帧 852 + 画板标题/说明，给下一行留空。 */
const FRAME_H = 1020;
const GAP = 72;
const ORIGIN = 40;
const KIT_W = 340;
const CAPTION_W = 420;

function col(index: number): number {
  return ORIGIN + index * (FRAME_W + GAP);
}

function row(index: number): number {
  return ORIGIN + index * (FRAME_H + GAP);
}

type Frame =
  | { id: "hosts" }
  | { id: "pair" }
  | { id: "workbench" }
  | { id: "inbox" }
  | { id: "session"; waiting: boolean }
  | { id: "changes"; from: "workbench" | "session" }
  | { id: "files"; from: "workbench" | "session" };

function frameKey(item: Frame): string {
  if (item.id === "session") {
    return item.waiting ? "session:w" : "session:r";
  }
  if (item.id === "changes" || item.id === "files") {
    return `${item.id}:${item.from}`;
  }
  return item.id;
}

function PrototypePhone(): ReactNode {
  const [stack, setStack] = useState<Frame[]>([{ id: "hosts" }]);
  const top = stack[stack.length - 1] ?? { id: "hosts" };
  const under = stack.length > 1 ? (stack[stack.length - 2] ?? null) : null;
  const push = (next: Frame) => {
    setStack((current) => [...current, next]);
  };
  const pop = () => {
    setStack((current) =>
      current.length > 1 ? current.slice(0, -1) : current
    );
  };

  const renderFrame = (frame: Frame): ReactNode => {
    switch (frame.id) {
      case "pair":
        return <PairScreen onBack={pop} />;
      case "workbench":
        return (
          <HostScreen
            onBack={pop}
            onOpenChanges={() => {
              push({ from: "workbench", id: "changes" });
            }}
            onOpenInbox={() => {
              push({ id: "inbox" });
            }}
            onOpenRunning={() => {
              push({ id: "session", waiting: false });
            }}
            onOpenSession={() => {
              push({ id: "session", waiting: true });
            }}
          />
        );
      case "inbox":
        return (
          <NotificationsScreen
            onBack={pop}
            onOpen={() => {
              push({ id: "session", waiting: true });
            }}
          />
        );
      case "session":
        return (
          <SessionScreen
            backLabel={under?.id === "inbox" ? "通知" : DEMO.hostOnline}
            onBack={pop}
            onOpenChanges={() => {
              push({ from: "session", id: "changes" });
            }}
            onOpenFiles={() => {
              push({ from: "session", id: "files" });
            }}
            title={frame.waiting ? DEMO.waitingTitle : DEMO.runningTitle}
            waiting={frame.waiting}
          />
        );
      case "changes":
        return (
          <ChangesScreen
            backLabel={frame.from === "workbench" ? DEMO.hostOnline : "会话"}
            onBack={pop}
          />
        );
      case "files":
        return (
          <FilesScreen
            backLabel={frame.from === "workbench" ? DEMO.hostOnline : "会话"}
            onBack={pop}
          />
        );
      default:
        return (
          <HostsScreen
            onAdd={() => {
              push({ id: "pair" });
            }}
            onEnter={() => {
              push({ id: "workbench" });
            }}
          />
        );
    }
  };

  if (under === null) {
    return renderFrame(top);
  }
  return (
    <SlideStack
      base={renderFrame(under)}
      overlay={renderFrame(top)}
      overlayKey={frameKey(top)}
    />
  );
}

function Caption(): ReactNode {
  return (
    <CaptionCard badge="视觉稿" title="先定触控，不换框架">
      <Text tone="secondary">
        没有底栏。主机列表是根面；点一台在线电脑推进该机工作台；铃铛打开这台电脑的收件箱。
      </Text>
      <Text tone="secondary">
        工作台以终端为主；变更是 git 根快捷入口；文件从会话进。没有新建。按下用
        interactive-active，主路径 44px。
      </Text>
      <Text tone="secondary">
        P0 可点：点「办公桌 Mac mini」推进工作台；点铃铛看通知；点
        feat-mobile 推进会话。
      </Text>
    </CaptionCard>
  );
}

export default function MobileWebShellCanvas(): ReactNode {
  const kitY = row(3);
  const kitX = ORIGIN + CAPTION_W + GAP;
  return (
    <WorldStage padding={40}>
      <Layer w={FRAME_W} x={col(0)} y={row(0)}>
        <Artboard
          description="可点原型：主机推入这台电脑；铃铛打开收件箱。"
          label="P0"
          preset="phone"
          title="可点原型"
        >
          <div className="h-full" data-pier-comment-id="mobile-web-prototype">
            <PrototypePhone />
          </div>
        </Artboard>
      </Layer>
      <Layer w={FRAME_W} x={col(1)} y={row(0)}>
        <Artboard
          description="无令牌才出现。主路径是扫码，粘贴是退路。"
          label="H0"
          preset="phone"
          title="配对"
        >
          <div className="h-full" data-pier-comment-id="mobile-web-pair">
            <PairScreen />
          </div>
        </Artboard>
      </Layer>
      <Layer w={FRAME_W} x={col(2)} y={row(0)}>
        <Artboard
          description="日常根面。整行进入当前电脑。"
          label="H1"
          preset="phone"
          title="主机"
        >
          <div className="h-full" data-pier-comment-id="mobile-web-hosts">
            <HostsScreen />
          </div>
        </Artboard>
      </Layer>
      <Layer w={FRAME_W} x={col(0)} y={row(1)}>
        <Artboard
          description="终端族为主。变更是 git 根快捷入口。无文档面板行、无加号。"
          label="H2"
          preset="phone"
          title="工作台"
        >
          <div className="h-full" data-pier-comment-id="mobile-web-host">
            <HostScreen onBack={() => undefined} />
          </div>
        </Artboard>
      </Layer>
      <Layer w={FRAME_W} x={col(1)} y={row(1)}>
        <Artboard
          description="会话是当前屏幕。需要你处理时审批条贴底。"
          label="S1"
          preset="phone"
          title="会话"
        >
          <div className="h-full" data-pier-comment-id="mobile-web-session">
            <SessionScreen />
          </div>
        </Artboard>
      </Layer>
      <Layer w={FRAME_W} x={col(2)} y={row(1)}>
        <Artboard
          description="只读变更。作用域是当前会话工作树。"
          label="S2"
          preset="phone"
          title="变更"
        >
          <div className="h-full" data-pier-comment-id="mobile-web-changes">
            <ChangesScreen />
          </div>
        </Artboard>
      </Layer>
      <Layer w={FRAME_W} x={col(0)} y={row(2)}>
        <Artboard
          description="只读工作树。目录往下走不另开一页。"
          label="S3"
          preset="phone"
          title="文件"
        >
          <div className="h-full" data-pier-comment-id="mobile-web-files">
            <FilesScreen />
          </div>
        </Artboard>
      </Layer>
      <Layer w={FRAME_W} x={col(1)} y={row(2)}>
        <Artboard
          description="当前机收件箱，从工作台铃铛进入。不是根面。"
          label="N1"
          preset="phone"
          title="通知"
        >
          <div className="h-full" data-pier-comment-id="mobile-web-notifications">
            <NotificationsScreen onBack={() => undefined} />
          </div>
        </Artboard>
      </Layer>
      <Layer w={FRAME_W} x={col(2)} y={row(2)}>
        <Artboard
          description="无会话。去电脑上开，不要加号。"
          label="H2e"
          preset="phone"
          title="工作台空态"
        >
          <div className="h-full" data-pier-comment-id="mobile-web-host-empty">
            <HostScreen empty onBack={() => undefined} />
          </div>
        </Artboard>
      </Layer>
      <Layer h={220} w={CAPTION_W} x={ORIGIN} y={kitY}>
        <Caption />
      </Layer>
      <Layer w={KIT_W} x={kitX} y={kitY}>
        <Artboard
          description="静止与按下对照。不是产品页。"
          height={520}
          label="K1"
          title="按下态"
          width={KIT_W}
        >
          <div className="h-full" data-pier-comment-id="mobile-web-press-kit">
            <PressKitScreen />
          </div>
        </Artboard>
      </Layer>
      <Layer w={KIT_W} x={kitX + KIT_W + GAP} y={kitY}>
        <Artboard
          description="父子用推入。没有底栏。不是产品页。"
          height={520}
          label="K2"
          title="页面过渡"
          width={KIT_W}
        >
          <div className="h-full" data-pier-comment-id="mobile-web-motion-kit">
            <MotionKitScreen />
          </div>
        </Artboard>
      </Layer>
    </WorldStage>
  );
}
