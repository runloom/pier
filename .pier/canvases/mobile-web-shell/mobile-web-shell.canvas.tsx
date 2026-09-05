import { Artboard, Layer, Text, WorldStage } from "pier/canvas";
import { type ReactNode, useReducer, useState } from "react";
import { CaptionCard } from "./chrome.tsx";
import { MotionKitScreen, PressKitScreen, StateKitScreen } from "./kits.tsx";
import {
  DEMO,
  demoKeyDelivery,
  type DemoHost,
  HOST_MINI,
  INITIAL_DEMO,
  notificationsOf,
  PAIRED_HOST,
  reduceDemo,
  SESSION_RUNNING,
  SESSION_WAITING,
  sessionsOf,
  unreadCount,
} from "./model.ts";
import { PrototypePhone } from "./prototype.tsx";
import { repoScope, worktreeIsDirty } from "./repo.ts";
import { HostsScreen, PairScreen } from "./screens-hosts.tsx";
import { NotificationsScreen } from "./screens-inbox.tsx";
import { ChangesScreen, FilesScreen } from "./screens-review.tsx";
import { SessionScreen, type SessionSheet } from "./screens-session.tsx";
import { HostScreen } from "./screens-workbench.tsx";

/**
 * 移动端 Web 壳视觉稿。信息架构仍以
 * docs/superpowers/specs/2026-08-26-mobile-companion-design.md §11 为准；
 * 本画板只定触控语言、密度、色、七面外观与页面过渡。
 * P0 是可点闭环原型，其余帧是每一面的关键状态。
 */
export const canvas = {
  description:
    "Pier 移动端 Web 壳的手机画板：主机推入这台电脑，铃铛打开收件箱。不是信息架构真源。",
  kind: "composition" as const,
  title: "移动端 Web 壳",
};

const FRAME_W = 393;
const FRAME_H = 852;
/** Artboard 标题 + 说明在帧上方占的高度。 */
const CAPTION_H = 56;
const GAP = 72;
const ORIGIN = 40;
const KIT_W = 340;
const KIT_H = 680;
const NOTE_W = 420;

function col(index: number): number {
  return ORIGIN + index * (FRAME_W + GAP);
}

function row(index: number): number {
  return ORIGIN + index * (FRAME_H + CAPTION_H + GAP);
}

const MINI: DemoHost = INITIAL_DEMO.hosts[0] ?? PAIRED_HOST;
const STATIC_HOSTS: DemoHost[] = [
  ...INITIAL_DEMO.hosts,
  { ...PAIRED_HOST, detail: "远程" },
];
const FEAT_MOBILE = repoScope(DEMO.worktree);

function StaticSession(props: {
  sessionId: string;
  initialSheet?: SessionSheet;
  disconnected?: boolean;
  initialKeysOpen?: boolean;
  inputUnavailable?: boolean;
  inputStale?: boolean;
}): ReactNode {
  const demo = INITIAL_DEMO;
  const [sessionId, setSessionId] = useState(props.sessionId);
  const found = demo.sessions.find((item) => item.id === sessionId);
  const session =
    found === undefined || props.inputUnavailable !== true
      ? found
      : { ...found, pendingInteractionId: undefined };
  if (session === undefined) {
    return null;
  }
  return (
    <SessionScreen
      backLabel={DEMO.hostOnline}
      dirty={session.hasGit && worktreeIsDirty(session.worktree)}
      disconnected={props.disconnected}
      initialSheet={props.initialSheet}
      initialKeysOpen={props.initialKeysOpen}
      onRespond={(_key, interactionId) =>
        props.inputStale === true
          ? "stale"
          : demoKeyDelivery(session, interactionId)
      }
      onSwitchSession={setSessionId}
      session={session}
      sessions={sessionsOf(demo, HOST_MINI)}
    />
  );
}

function StaticInbox(): ReactNode {
  const [demo, dispatch] = useReducer(reduceDemo, INITIAL_DEMO);
  return (
    <NotificationsScreen
      hostName={DEMO.hostOnline}
      items={notificationsOf(demo, HOST_MINI)}
      onRead={(id) => dispatch({ type: "notification.read", id })}
      onReadAll={() => dispatch({ type: "notification.readAll" })}
      push="done"
      sessions={sessionsOf(demo, HOST_MINI)}
    />
  );
}

function Phone(props: {
  children: ReactNode;
  commentId: string;
  description: string;
  label: string;
  title: string;
  x: number;
  y: number;
}): ReactNode {
  return (
    <Layer w={FRAME_W} x={props.x} y={props.y}>
      <Artboard
        description={props.description}
        label={props.label}
        preset="phone"
        title={props.title}
      >
        <div className="h-full" data-pier-comment-id={props.commentId}>
          {props.children}
        </div>
      </Artboard>
    </Layer>
  );
}

function Note(): ReactNode {
  return (
    <CaptionCard badge="视觉稿" title="怎么读这块板">
      <Text tone="secondary">
        P0 可点闭环：点「办公桌 Mac
        mini」先连接再在线；点终端预览进会话，「按键」展开受限输入。
        发送只确认投递，不自动修改终端或宣告完成；通知点开落回会话并标已读。
        会话标题或底部「会话」打开切换面板；「Aa 字号」调整阅读大小。
        「添加主机」走扫码，完成后新电脑入列；离线机点按后可移除。
      </Text>
      <Text tone="secondary">
        一条栈，没有全局底部导航：主机 → 这台电脑 → 会话 → 变更 /
        文件；铃铛开的是这台电脑的收件箱。
        工作台用两列当前屏幕缩略图定位会话，身份在预览下方；变更按工作树单独列出。文件从会话头部进；无新建、不同步桌面审查。
      </Text>
      <Text tone="secondary">
        信息架构真源是移动端方案
        §11；本板只定触控（44px、自绘按下）、文字层级、语义令牌、七面外观与
        220ms 推入 / 返回。K1–K3 是规则卡，不是产品页。
      </Text>
    </CaptionCard>
  );
}

export default function MobileWebShellCanvas(): ReactNode {
  const kitY = row(4);
  const kitX = ORIGIN + NOTE_W + GAP;
  return (
    <WorldStage background="var(--background)" padding={40}>
      <Phone
        commentId="mobile-web-prototype"
        description="可点流程：配对入列、终端预览、受限按键、通知已读、文件与变更。"
        label="P0"
        title="可点原型"
        x={col(0)}
        y={row(1)}
      >
        <PrototypePhone />
      </Phone>
      <Phone
        commentId="mobile-web-pair"
        description="无令牌才出现。相机即页；角括号在玻璃上；一只 44 停止键和一行说明。"
        label="H0"
        title="配对"
        x={col(2)}
        y={row(1)}
      >
        <PairScreen />
      </Phone>
      <Phone
        commentId="mobile-web-hosts"
        description="日常根面。设备行整行进入；状态点在图标上；离线点按给提示并可移除。添加入口只留顶栏扫码。"
        label="H1"
        title="主机"
        x={col(1)}
        y={row(1)}
      >
        <HostsScreen hosts={STATIC_HOSTS} onAdd={() => undefined} />
      </Phone>
      <Phone
        commentId="mobile-web-host"
        description="两列终端预览：状态置于窗口栏，名称与工具标识在下方；工作树变更另列。"
        label="H2"
        title="工作台"
        x={col(0)}
        y={row(0)}
      >
        <HostScreen
          host={MINI}
          sessions={sessionsOf(INITIAL_DEMO, HOST_MINI)}
          unread={unreadCount(notificationsOf(INITIAL_DEMO, HOST_MINI))}
        />
      </Phone>

      <Phone
        commentId="mobile-web-session"
        description="连续纯文本读屏。有效未决交互才提供「按键」，不把固定数字当作识别出的选项。"
        label="S1"
        title="会话 · 需要你处理"
        x={col(1)}
        y={row(0)}
      >
        <StaticSession sessionId={SESSION_WAITING} />
      </Phone>
      <Phone
        commentId="mobile-web-session-running"
        description="运行中保持连续阅读；底部 Aa 字号可见，会话入口随手可达。长输出滚动，不伪造历史。"
        label="S1b"
        title="会话 · 运行中"
        x={col(2)}
        y={row(3)}
      >
        <StaticSession sessionId={SESSION_RUNNING} />
      </Phone>
      <Phone
        commentId="mobile-web-changes"
        description="只读变更。作用域是该会话工作树的 git 根；状态字母 + 增删。电脑上不弹审查面板。"
        label="S2"
        title="变更 · 文件列表"
        x={col(0)}
        y={row(2)}
      >
        <ChangesScreen
          backLabel={DEMO.waitingTitle}
          repo={FEAT_MOBILE}
          scope={DEMO.worktree}
        />
      </Phone>
      <Phone
        commentId="mobile-web-changes-diff"
        description="点开单文件：同页切换，「‹ 文件列表」回去。统一 diff，增删只用状态色。"
        label="S2b"
        title="变更 · 单文件"
        x={col(1)}
        y={row(2)}
      >
        <ChangesScreen
          backLabel={DEMO.waitingTitle}
          initialPath="apps/mobile-web/src/app.tsx"
          repo={FEAT_MOBILE}
          scope={DEMO.worktree}
        />
      </Phone>

      <Phone
        commentId="mobile-web-files"
        description="只读工作树。目录和文件图标区分类型；保留路径身份。进入目录在同页更新。"
        label="S3"
        title="文件 · 目录"
        x={col(2)}
        y={row(2)}
      >
        <FilesScreen
          backLabel={DEMO.waitingTitle}
          repo={FEAT_MOBILE}
          scope={DEMO.worktree}
        />
      </Phone>
      <Phone
        commentId="mobile-web-files-preview"
        description="源码折行、行号和语法色帮助阅读；导航与正文不重叠。「‹」回目录。"
        label="S3b"
        title="文件 · 预览"
        x={col(3)}
        y={row(2)}
      >
        <FilesScreen
          backLabel={DEMO.waitingTitle}
          initialDir="apps/mobile-web/src"
          initialFile="apps/mobile-web/src/app.tsx"
          repo={FEAT_MOBILE}
          scope={DEMO.worktree}
        />
      </Phone>
      <Phone
        commentId="mobile-web-notifications"
        description="事件标题、详情、时间和未读状态。点击通知回到会话，保留消息发生时的内容。"
        label="N1"
        title="收件箱"
        x={col(3)}
        y={row(1)}
      >
        <StaticInbox />
      </Phone>
      <Phone
        commentId="mobile-web-host-empty"
        description="无会话空态：去电脑上开一个。不提供新建终端 / 智能体 / 工作树。"
        label="H2e"
        title="工作台 · 空态"
        x={col(0)}
        y={row(3)}
      >
        <HostScreen host={PAIRED_HOST} sessions={[]} unread={0} />
      </Phone>

      <Phone
        commentId="mobile-web-session-switcher"
        description="底部面板保留终端背景；当前会话明确标记，点选切换，关闭回到原处。"
        label="S1c"
        title="会话 · 切换"
        x={col(3)}
        y={row(0)}
      >
        <StaticSession initialSheet="sessions" sessionId={SESSION_WAITING} />
      </Phone>
      <Phone
        commentId="mobile-web-session-disconnected"
        description="保留最后内容并明示连接已断开；停止显示回应按键，阅读设置仍可用。"
        label="S1d"
        title="会话 · 断线"
        x={col(1)}
        y={row(3)}
      >
        <StaticSession disconnected sessionId={SESSION_WAITING} />
      </Phone>

      <Phone
        commentId="mobile-web-session-keys"
        description="按需展开的 13 键输入；数字键另行展开。投递成功只显示已发送。"
        label="S1k"
        title="会话 · 终端按键"
        x={col(2)}
        y={row(0)}
      >
        <StaticSession initialKeysOpen sessionId={SESSION_WAITING} />
      </Phone>
      <Phone
        commentId="mobile-web-session-unavailable"
        description="虽在等待，但没有有效未决交互。保留原文，提示去电脑处理，不显示按键。"
        label="S1u"
        title="会话 · 暂不能回应"
        x={col(3)}
        y={row(3)}
      >
        <StaticSession inputUnavailable sessionId={SESSION_WAITING} />
      </Phone>

      <Layer w={NOTE_W} x={ORIGIN} y={kitY}>
        <Note />
      </Layer>
      <Layer w={KIT_W} x={kitX} y={kitY}>
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
      <Layer w={KIT_W} x={kitX + KIT_W + GAP} y={kitY}>
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
      <Layer w={KIT_W} x={kitX + (KIT_W + GAP) * 2} y={kitY}>
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
    </WorldStage>
  );
}
