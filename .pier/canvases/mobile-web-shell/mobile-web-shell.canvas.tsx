import {
  Artboard,
  Layer,
  ScreenFlow,
  Text,
  WorldStage,
  validateScreenFlowPaint,
} from "pier/canvas";
import { type ReactNode, useReducer, useState } from "react";
import { cx } from "./chrome.tsx";
import {
  appendixOrigin,
  APPENDIX_H,
  APPENDIX_W,
  CAPTION_H,
  FRAME_W,
  kitOrigin,
  KIT_H,
  KIT_W,
  mobileWebShellFlowSpec,
  mobileWebShellFrameBoxes,
  NOTE_H,
  NOTE_W,
  NOTE_Y,
  ORIGIN,
  PATH_H,
  PATH_RIGHT,
  pathRow,
} from "./flow.ts";
import { MotionKitScreen, PressKitScreen, StateKitScreen } from "./kits.tsx";
import {
  DEMO,
  demoKeyDelivery,
  type DemoHost,
  type DemoResponseKey,
  type DemoSession,
  HOST_MINI,
  INITIAL_DEMO,
  notificationsOf,
  PAIRED_HOST,
  type PushState,
  reduceDemo,
  SESSION_RUNNING,
  SESSION_WAITING,
  sessionsOf,
  unreadCount,
  waitingCountByHost,
} from "./model.ts";
import { PrototypePhone } from "./prototype.tsx";
import { repoScope } from "./repo.ts";
import { HostsScreen, PairScreen } from "./screens-hosts.tsx";
import { NotificationsScreen } from "./screens-inbox.tsx";
import { ChangesScreen, FilesScreen } from "./screens-review.tsx";
import {
  SessionEndedScreen,
  SessionScreen,
  type SessionSheet,
} from "./screens-session.tsx";
import { HostScreen } from "./screens-workbench.tsx";

/**
 * 移动端 Web 壳视觉稿。信息架构仍以
 * docs/superpowers/specs/2026-08-26-mobile-companion-design.md §11 为准；
 * 本画板只定触控语言、密度、色、七面外观与页面过渡。
 * P0 是可点闭环；ScreenFlow 标出导航路径。附录态不连线。
 */
export const canvas = {
  description:
    "Pier 移动端 Web 壳的手机画板：主机推入这台电脑，铃铛打开收件箱。不是信息架构真源。",
  kind: "composition" as const,
  title: "移动端 Web 壳",
};

const paint = validateScreenFlowPaint({
  frames: mobileWebShellFrameBoxes,
  spec: mobileWebShellFlowSpec,
});
if (paint.status === 1) {
  throw new Error(
    paint.diagnostics[0]?.supportedFixes[0] ??
      paint.diagnostics[0]?.message ??
      "ScreenFlow cannot be drawn"
  );
}

const MINI: DemoHost = INITIAL_DEMO.hosts[0] ?? PAIRED_HOST;
const STATIC_HOSTS: DemoHost[] = [
  ...INITIAL_DEMO.hosts,
  { ...PAIRED_HOST, detail: "远程" },
];
/** H1b：补一台「状态未知」的主机，演示 UNKNOWN_HINT 提示条。 */
const HOSTS_WITH_UNKNOWN: DemoHost[] = [
  ...STATIC_HOSTS,
  {
    detail: "远程",
    device: "laptop",
    id: "host-old",
    name: "旧笔记本",
    reach: "relay",
    status: "unknown",
  },
];
const FEAT_MOBILE = repoScope(DEMO.worktree);

/** 切换面板超过 5 个会话才出现搜索；这串克隆只为在 S1c 演示那条搜索行。 */
function cloneSession(
  base: DemoSession,
  id: string,
  title: string,
  worktree: string
): DemoSession {
  return { ...base, id, pendingInteractionId: undefined, title, worktree };
}
const RUNNING_BASE =
  INITIAL_DEMO.sessions.find((item) => item.id === SESSION_RUNNING) ??
  INITIAL_DEMO.sessions[0];
const SWITCHER_PEERS: DemoSession[] =
  RUNNING_BASE === undefined
    ? []
    : [
        ...sessionsOf(INITIAL_DEMO, HOST_MINI),
        cloneSession(RUNNING_BASE, "s-api", "api-server", "api-server"),
        cloneSession(RUNNING_BASE, "s-docs", "docs-site", "docs-site"),
        cloneSession(RUNNING_BASE, "s-lsp", "lsp-windows", "lsp-windows"),
        cloneSession(RUNNING_BASE, "s-ml", "train-eval", "train-eval"),
        cloneSession(RUNNING_BASE, "s-web", "web-admin", "web-admin"),
      ];

function StaticSession(props: {
  sessionId: string;
  feedInterrupted?: boolean;
  initialEchoKey?: DemoResponseKey;
  initialSheet?: SessionSheet;
  disconnected?: boolean;
  initialKeysOpen?: boolean;
  initialStale?: boolean;
  inputUnavailable?: boolean;
  peers?: readonly DemoSession[];
}): ReactNode {
  const demo = INITIAL_DEMO;
  const [sessionId, setSessionId] = useState(props.sessionId);
  // peers 覆盖时（S1c 演示长列表）也在 peers 里找，克隆会话同样可点。
  const pool = props.peers ?? demo.sessions;
  const found = pool.find((item) => item.id === sessionId);
  const session =
    found === undefined || props.inputUnavailable !== true
      ? found
      : { ...found, pendingInteractionId: undefined };
  if (session === undefined) {
    return null;
  }
  return (
    <SessionScreen
      backLabel="这台电脑"
      disconnected={props.disconnected}
      feedInterrupted={props.feedInterrupted}
      initialSheet={props.initialSheet}
      initialEchoKey={props.initialEchoKey}
      initialKeysOpen={props.initialKeysOpen}
      initialStale={props.initialStale}
      onRespond={(_key, interactionId) =>
        demoKeyDelivery(session, interactionId)
      }
      onRetry={props.disconnected === true ? () => undefined : undefined}
      onSwitchSession={setSessionId}
      session={session}
      sessions={props.peers ?? sessionsOf(demo, HOST_MINI)}
    />
  );
}

function StaticInbox(props: { enablePush?: boolean; push?: PushState }): ReactNode {
  const [demo, dispatch] = useReducer(reduceDemo, {
    ...INITIAL_DEMO,
    push: props.push ?? INITIAL_DEMO.push,
  });
  return (
    <NotificationsScreen
      hostName={DEMO.hostOnline}
      items={notificationsOf(demo, HOST_MINI)}
      onEnablePush={
        props.enablePush === true
          ? () => {
              dispatch({ state: "busy", type: "push.set" });
              setTimeout(() => {
                dispatch({ state: "done", type: "push.set" });
              }, 1200);
            }
          : undefined
      }
      onRead={(id) => dispatch({ type: "notification.read", id })}
      onReadAll={() => dispatch({ type: "notification.readAll" })}
      onRefresh={() => undefined}
      push={demo.push}
      refreshing={false}
      sessions={sessionsOf(demo, HOST_MINI)}
    />
  );
}

type PathId = (typeof mobileWebShellFrameBoxes)[number]["id"];

function pathBox(id: PathId): (typeof mobileWebShellFrameBoxes)[number] {
  const box = mobileWebShellFrameBoxes.find((item) => item.id === id);
  if (box === undefined) {
    throw new Error(`missing path frame ${id}`);
  }
  return box;
}

function Phone(props: {
  children: ReactNode;
  commentId: string;
  description?: string;
  height: number;
  /** 路径和失败帧才写。附录帧不要 id，以免进连线障碍。 */
  id?: string;
  label: string;
  /** 亮色主题帧：内容包一层 .light，令牌随之翻转。 */
  light?: boolean;
  title: string;
  width?: number;
  x: number;
  y: number;
}): ReactNode {
  const w = props.width ?? FRAME_W;
  return (
    <Layer h={CAPTION_H + props.height} w={w} x={props.x} y={props.y}>
      <Artboard
        {...(props.description === undefined
          ? {}
          : { description: props.description })}
        height={props.height}
        {...(props.id === undefined ? {} : { id: props.id })}
        label={props.label}
        title={props.title}
        width={w}
      >
        <div
          className={cx("h-full", props.light === true && "light")}
          data-pier-comment-id={props.commentId}
        >
          {props.children}
        </div>
      </Artboard>
    </Layer>
  );
}

function PathPhone(
  props: Omit<Parameters<typeof Phone>[0], "height" | "x" | "y"> & {
    id: PathId;
  }
): ReactNode {
  const box = pathBox(props.id);
  return (
    <Phone {...props} height={box.h} x={box.x} y={box.y - CAPTION_H} />
  );
}

function AppendixPhone(
  props: Omit<Parameters<typeof Phone>[0], "height" | "id" | "width" | "x" | "y"> & {
    index: number;
    width?: number;
  }
): ReactNode {
  const origin = appendixOrigin(props.index);
  return (
    <Phone
      {...props}
      height={APPENDIX_H}
      width={props.width ?? APPENDIX_W}
      x={origin.x}
      y={origin.y}
    />
  );
}

function Note(): ReactNode {
  return (
    <div
      className="flex h-full flex-col justify-center gap-1.5 rounded-md border border-border bg-muted/40 px-5 py-3"
      data-slot="mobile-shell-note"
    >
      <div className="flex items-baseline gap-2">
        <span className="rounded-md bg-secondary px-2 py-0.5 font-medium text-[11px] text-muted-foreground leading-4">
          怎么读
        </span>
        <Text as="h3">怎么读这块板</Text>
      </div>
      <Text tone="secondary">
        从左向右：选电脑 → 打开会话 → 查看变更 → 打开文件。下一行是配对、通知和文件；再下一行是失败恢复。会话正下方的空隙给折线，不是缺页。工作台「工作树变更」与会话里的「变更」是同一面，图上不另画一条线。从通知进会话时返回写「收件箱」。右侧是可点原型、规则卡和附录态，不连线。
      </Text>
    </div>
  );
}

export default function MobileWebShellCanvas(): ReactNode {
  const kit0 = kitOrigin(0);
  const kit1 = kitOrigin(1);
  const kit2 = kitOrigin(2);
  return (
    <WorldStage background="var(--background)" padding={40}>
      <Layer h={NOTE_H} w={NOTE_W} x={ORIGIN} y={NOTE_Y}>
        <Note />
      </Layer>
      <PathPhone
        commentId="mobile-web-hosts"
        id="hosts"
        label="H1"
        title="选电脑"
      >
        <HostsScreen
          hosts={INITIAL_DEMO.hosts}
          onAdd={() => undefined}
          onRemove={() => undefined}
          waitingByHost={waitingCountByHost(INITIAL_DEMO)}
        />
      </PathPhone>
      <PathPhone
        commentId="mobile-web-host"
        id="workbench"
        label="H2"
        title="这台电脑"
      >
        <HostScreen
          host={MINI}
          sessions={sessionsOf(INITIAL_DEMO, HOST_MINI)}
          unread={unreadCount(notificationsOf(INITIAL_DEMO, HOST_MINI))}
        />
      </PathPhone>
      <PathPhone
        commentId="mobile-web-session"
        id="session"
        label="S1"
        title="打开会话"
      >
        <StaticSession sessionId={SESSION_WAITING} />
      </PathPhone>
      <PathPhone
        commentId="mobile-web-changes"
        id="changes"
        label="S2"
        title="查看变更"
      >
        <ChangesScreen
          backLabel={DEMO.waitingTitle}
          repo={FEAT_MOBILE}
          scope={DEMO.worktree}
        />
      </PathPhone>
      <PathPhone
        commentId="mobile-web-changes-diff"
        id="diff"
        label="S2b"
        title="打开文件"
      >
        <ChangesScreen
          backLabel={DEMO.waitingTitle}
          initialPath="apps/mobile-web/src/app.tsx"
          repo={FEAT_MOBILE}
          scope={DEMO.worktree}
        />
      </PathPhone>
      <PathPhone
        commentId="mobile-web-pair"
        id="pair"
        label="H0"
        title="添加电脑"
      >
        <PairScreen />
      </PathPhone>
      <PathPhone
        commentId="mobile-web-notifications"
        id="inbox"
        label="N1"
        title="查看通知"
      >
        <StaticInbox push="done" />
      </PathPhone>
      <PathPhone
        commentId="mobile-web-files"
        id="files"
        label="S3"
        title="浏览文件"
      >
        <FilesScreen
          backLabel={DEMO.waitingTitle}
          repo={FEAT_MOBILE}
          scope={DEMO.worktree}
        />
      </PathPhone>
      <PathPhone
        commentId="mobile-web-files-preview"
        id="preview"
        label="S3b"
        title="阅读文件"
      >
        <FilesScreen
          backLabel={DEMO.waitingTitle}
          initialDir="apps/mobile-web/src"
          initialFile="apps/mobile-web/src/app.tsx"
          repo={FEAT_MOBILE}
          scope={DEMO.worktree}
        />
      </PathPhone>
      <PathPhone
        commentId="mobile-web-pair-no-camera"
        id="pairCamera"
        label="H0b"
        title="相机不可用"
      >
        <PairScreen initialPhase="failed-camera" />
      </PathPhone>
      <PathPhone
        commentId="mobile-web-session-ended"
        id="sessionEnded"
        label="S1x"
        title="会话已结束"
      >
        <SessionEndedScreen
          backLabel="收件箱"
          onOpenWorkbench={() => undefined}
          title="docs-site"
        />
      </PathPhone>
      <PathPhone
        commentId="mobile-web-session-disconnected"
        id="disconnected"
        label="S1d"
        title="连接已断开"
      >
        <StaticSession disconnected sessionId={SESSION_WAITING} />
      </PathPhone>
      <Phone
        commentId="mobile-web-prototype"
        height={PATH_H}
        label="P0"
        title="可点原型"
        x={PATH_RIGHT}
        y={pathRow(0)}
      >
        <PrototypePhone />
      </Phone>
      <AppendixPhone
        commentId="mobile-web-pair-bad-code"
        index={0}
        label="H0c"
        title="配对 · 无法识别"
      >
        <PairScreen initialPhase="failed-code" />
      </AppendixPhone>
      <AppendixPhone
        commentId="mobile-web-session-running"
        index={1}
        label="S1b"
        title="会话 · 运行中"
      >
        <StaticSession sessionId={SESSION_RUNNING} />
      </AppendixPhone>
      <AppendixPhone
        commentId="mobile-web-session-switcher"
        index={2}
        label="S1c"
        title="会话 · 切换"
      >
        <StaticSession
          initialSheet="sessions"
          peers={SWITCHER_PEERS}
          sessionId={SESSION_WAITING}
        />
      </AppendixPhone>
      <AppendixPhone
        commentId="mobile-web-session-keys"
        index={3}
        label="S1k"
        title="会话 · 终端按键"
      >
        <StaticSession initialKeysOpen sessionId={SESSION_WAITING} />
      </AppendixPhone>
      <AppendixPhone
        commentId="mobile-web-session-unavailable"
        index={4}
        label="S1u"
        title="会话 · 暂不能回应"
      >
        <StaticSession inputUnavailable sessionId={SESSION_WAITING} />
      </AppendixPhone>
      <AppendixPhone
        commentId="mobile-web-host-empty"
        index={5}
        label="H2e"
        title="工作台 · 空态"
      >
        <HostScreen host={PAIRED_HOST} sessions={[]} unread={0} />
      </AppendixPhone>
      <AppendixPhone
        commentId="mobile-web-session-feed-interrupted"
        index={6}
        label="S1e"
        title="会话 · 读取中断"
      >
        <StaticSession feedInterrupted sessionId={SESSION_WAITING} />
      </AppendixPhone>
      <AppendixPhone
        commentId="mobile-web-session-stale"
        index={7}
        label="S1t"
        title="会话 · 回应已失效"
      >
        <StaticSession initialKeysOpen initialStale sessionId={SESSION_WAITING} />
      </AppendixPhone>
      <AppendixPhone
        commentId="mobile-web-session-sent"
        index={8}
        label="S1s"
        title="会话 · 已发送"
      >
        <StaticSession
          initialEchoKey="y"
          initialKeysOpen
          sessionId={SESSION_WAITING}
        />
      </AppendixPhone>
      <AppendixPhone
        commentId="mobile-web-hosts-unknown"
        index={9}
        label="H1b"
        title="主机 · 状态未知"
      >
        <HostsScreen
          hosts={HOSTS_WITH_UNKNOWN}
          initialHintId="host-old"
          onAdd={() => undefined}
          onRemove={() => undefined}
          waitingByHost={waitingCountByHost(INITIAL_DEMO)}
        />
      </AppendixPhone>
      <AppendixPhone
        commentId="mobile-web-hosts-empty"
        index={10}
        label="H1e"
        title="主机 · 空态"
      >
        <HostsScreen hosts={[]} onAdd={() => undefined} />
      </AppendixPhone>
      <AppendixPhone
        commentId="mobile-web-notifications-push"
        index={11}
        label="N1b"
        title="收件箱 · 开启推送"
      >
        <StaticInbox enablePush push="idle" />
      </AppendixPhone>
      <AppendixPhone
        commentId="mobile-web-notifications-push-failed"
        index={12}
        label="N1c"
        title="收件箱 · 推送开启失败"
      >
        <StaticInbox enablePush push="failed" />
      </AppendixPhone>
      <AppendixPhone
        commentId="mobile-web-session-narrow"
        index={13}
        label="S1n"
        title="会话 · 窄屏 320"
        width={320}
      >
        <StaticSession sessionId={SESSION_WAITING} />
      </AppendixPhone>
      <AppendixPhone
        commentId="mobile-web-session-narrow-360"
        index={14}
        label="S1m"
        title="会话 · 窄屏 360"
        width={360}
      >
        <StaticSession sessionId={SESSION_WAITING} />
      </AppendixPhone>
      <AppendixPhone
        commentId="mobile-web-host-light"
        index={15}
        label="H2l"
        light
        title="工作台 · 亮色"
      >
        <HostScreen
          host={MINI}
          sessions={sessionsOf(INITIAL_DEMO, HOST_MINI)}
          unread={unreadCount(notificationsOf(INITIAL_DEMO, HOST_MINI))}
        />
      </AppendixPhone>
      <AppendixPhone
        commentId="mobile-web-session-light"
        index={16}
        label="S1l"
        light
        title="会话 · 亮色"
      >
        <StaticSession initialKeysOpen sessionId={SESSION_WAITING} />
      </AppendixPhone>
      <Layer h={CAPTION_H + KIT_H} w={KIT_W} x={kit0.x} y={kit0.y}>
        <Artboard
          description="按下态、命中尺寸、芯片。规则卡，不是产品页。"
          height={KIT_H}
          label="K1"
          title="触控"
          width={KIT_W}
        >
          <div className="h-full" data-pier-comment-id="mobile-web-press-kit">
            <PressKitScreen />
          </div>
        </Artboard>
      </Layer>
      <Layer h={CAPTION_H + KIT_H} w={KIT_W} x={kit1.x} y={kit1.y}>
        <Artboard
          description="父子用推入，返回反向；同页切换不做过渡。规则卡。"
          height={KIT_H}
          label="K2"
          title="页面过渡"
          width={KIT_W}
        >
          <div className="h-full" data-pier-comment-id="mobile-web-motion-kit">
            <MotionKitScreen />
          </div>
        </Artboard>
      </Layer>
      <Layer h={CAPTION_H + KIT_H} w={KIT_W} x={kit2.x} y={kit2.y}>
        <Artboard
          description="连接态、会话态、变更字母、通知：状态词与令牌映射。规则卡。"
          height={KIT_H}
          label="K3"
          title="状态与色"
          width={KIT_W}
        >
          <div className="h-full" data-pier-comment-id="mobile-web-state-kit">
            <StateKitScreen />
          </div>
        </Artboard>
      </Layer>
      <ScreenFlow spec={mobileWebShellFlowSpec} />
    </WorldStage>
  );
}
