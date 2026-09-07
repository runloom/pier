import { Artboard, Layer, Text, WorldStage } from "pier/canvas";
import { type ReactNode, useReducer, useState } from "react";
import { CaptionCard, cx } from "./chrome.tsx";
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

function Phone(props: {
  children: ReactNode;
  commentId: string;
  description: string;
  label: string;
  /** 亮色主题帧：内容包一层 .light，令牌随之翻转。 */
  light?: boolean;
  /** 窄屏帧：320×568 / 360×640（spec §10 自查窄宽度）。 */
  narrow?: 320 | 360;
  title: string;
  x: number;
  y: number;
}): ReactNode {
  const w = props.narrow ?? FRAME_W;
  const narrowH = props.narrow === 320 ? 568 : 640;
  const board =
    props.narrow !== undefined ? (
      <Artboard
        description={props.description}
        height={narrowH}
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
    ) : (
      <Artboard
        description={props.description}
        label={props.label}
        preset="phone"
        title={props.title}
      >
        <div
          className={cx("h-full", props.light === true && "light")}
          data-pier-comment-id={props.commentId}
        >
          {props.children}
        </div>
      </Artboard>
    );
  return (
    <Layer w={w} x={props.x} y={props.y}>
      {board}
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
        会话标题或底部「会话」打开切换面板（超过 5 个会话出现搜索）；「Aa
        字号」调整阅读大小并记住。会话与收件箱从工作台进入时，返回写「这台电脑」，主机名留在工作台标题。
        「添加主机」走扫码，粘贴配对内容是退路，完成后新电脑入列；离线机点按后可移除。
      </Text>
      <Text tone="secondary">
        一条栈，没有全局底部导航：主机 → 这台电脑 → 会话 → 变更 /
        文件；铃铛开的是这台电脑的收件箱。主机行右侧「需要你处理」是独立入口：不开推送也能分诊，只有 1 个等待时点它打开该会话，返回仍落到工作台。
        工作台用两列当前屏幕缩略图定位会话，身份在预览下方；等待卡片带 11px 状态词，会话名保持中性色。变更按工作树单独列出，排在会话上方。文件与变更从会话头部文字动作进入；无新建、不同步桌面审查。
      </Text>
      <Text tone="secondary">
        失败与边界各有帧：相机不可用 / 无法识别（H0b、H0c），读取中断（S1e），回应已失效（S1t），已发送回执（S1s），会话已结束（S1x），推送未开启与开启失败（N1b、N1c），主机状态未知（H1b）与空态（H1e），320px / 360px 窄屏（S1n、S1m）与亮色工作台 / 会话（H2l、S1l）自查帧在规则卡下方。信息架构真源是移动端方案
        §11；本板只定触控（44px、自绘按下）、文字层级、语义令牌、七面外观与
        220ms 推入 / 返回。K1–K3 是规则卡，不是产品页。
      </Text>
    </CaptionCard>
  );
}

export default function MobileWebShellCanvas(): ReactNode {
  const kitY = row(5);
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
        description="无令牌才出现。相机即页；角括号在玻璃上；44 停止键（识别中可取消）和粘贴退路。失败帧见 H0b/H0c。"
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
        <HostsScreen
          hosts={STATIC_HOSTS}
          onAdd={() => undefined}
          onRemove={() => undefined}
          waitingByHost={waitingCountByHost(INITIAL_DEMO)}
        />
      </Phone>
      <Phone
        commentId="mobile-web-host"
        description="工作树变更提到会话网格上方，看 diff 不用滚到底；预览窗栏只留状态色点，等待卡片在身份行下用短状态词。"
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
        description="点开单文件：同页切换，「‹ 文件列表」回去；顶栏可直接上一 / 下一文件。统一 diff，增删只用状态色。"
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
        <StaticInbox push="done" />
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
        description="底部面板保留终端背景；当前会话明确标记，点选切换，关闭回到原处。超过 5 个会话出现搜索行。"
        label="S1c"
        title="会话 · 切换"
        x={col(3)}
        y={row(0)}
      >
        <StaticSession
          initialSheet="sessions"
          peers={SWITCHER_PEERS}
          sessionId={SESSION_WAITING}
        />
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
        description="按需展开的 13 键输入；数字键另行展开。投递成功只显示已发送，随后短暂等待终端响应再放开按键。"
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

      <Phone
        commentId="mobile-web-pair-no-camera"
        description="相机被拒绝或不可用：说明原因，重试是主按钮，粘贴配对内容是退路。"
        label="H0b"
        title="配对 · 相机不可用"
        x={col(0)}
        y={row(4)}
      >
        <PairScreen initialPhase="failed-camera" />
      </Phone>
      <Phone
        commentId="mobile-web-pair-bad-code"
        description="二维码过期或识别不完整：回电脑重新生成，或改走粘贴。"
        label="H0c"
        title="配对 · 无法识别"
        x={col(1)}
        y={row(4)}
      >
        <PairScreen initialPhase="failed-code" />
      </Phone>
      <Phone
        commentId="mobile-web-session-feed-interrupted"
        description="连接未断但读取滞后：读屏顶缘细条提示画面可能不是最新，恢复后自动更新。"
        label="S1e"
        title="会话 · 读取中断"
        x={col(2)}
        y={row(4)}
      >
        <StaticSession feedInterrupted sessionId={SESSION_WAITING} />
      </Phone>
      <Phone
        commentId="mobile-web-session-ended"
        description="通知指向的会话已在电脑上结束：不推空帧，给明确终态与去向。"
        label="S1x"
        title="会话 · 已结束"
        x={col(3)}
        y={row(4)}
      >
        <SessionEndedScreen
          backLabel="收件箱"
          onOpenWorkbench={() => undefined}
          title="docs-site"
        />
      </Phone>
      <Phone
        commentId="mobile-web-notifications-push"
        description="推送未开启时收件箱顶部给一次开启入口；顶栏有手动刷新。"
        label="N1b"
        title="收件箱 · 开启推送"
        x={col(4)}
        y={row(4)}
      >
        <StaticInbox enablePush push="idle" />
      </Phone>

      <Phone
        commentId="mobile-web-session-narrow"
        description="320px 最窄宽度自查：回应区与工具行仍完整，长标题截断。"
        label="S1n"
        narrow={320}
        title="会话 · 窄屏 320"
        x={col(0)}
        y={row(6)}
      >
        <StaticSession sessionId={SESSION_WAITING} />
      </Phone>
      <Phone
        commentId="mobile-web-host-light"
        description="亮色主题自查：语义令牌整体翻转，状态色不变。"
        label="H2l"
        light
        title="工作台 · 亮色"
        x={col(1)}
        y={row(6)}
      >
        <HostScreen
          host={MINI}
          sessions={sessionsOf(INITIAL_DEMO, HOST_MINI)}
          unread={unreadCount(notificationsOf(INITIAL_DEMO, HOST_MINI))}
        />
      </Phone>
      <Phone
        commentId="mobile-web-session-narrow-360"
        description="360px 窄屏自查：回应区、工具行与导航在 Android 宽度下仍成立。"
        label="S1m"
        narrow={360}
        title="会话 · 窄屏 360"
        x={col(2)}
        y={row(6)}
      >
        <StaticSession sessionId={SESSION_WAITING} />
      </Phone>
      <Phone
        commentId="mobile-web-hosts-unknown"
        description="状态未知的主机：点按后提示插在该行下方，不假装离线，也不滚到列表底部才看见。"
        label="H1b"
        title="主机 · 状态未知"
        x={col(3)}
        y={row(6)}
      >
        <HostsScreen
          hosts={HOSTS_WITH_UNKNOWN}
          initialHintId="host-old"
          onAdd={() => undefined}
          onRemove={() => undefined}
          waitingByHost={waitingCountByHost(INITIAL_DEMO)}
        />
      </Phone>
      <Phone
        commentId="mobile-web-session-stale"
        description="回应已失效：按键面板先停住并锁键，说明这次不能再发；用户收起后回应区不再开放按键。"
        label="S1t"
        title="会话 · 回应已失效"
        x={col(4)}
        y={row(6)}
      >
        <StaticSession initialKeysOpen initialStale sessionId={SESSION_WAITING} />
      </Phone>
      <Phone
        commentId="mobile-web-hosts-empty"
        description="删掉最后一台电脑后的落点：回到「还没有配对的电脑」，扫码重新配对。"
        label="H1e"
        title="主机 · 空态"
        x={col(0)}
        y={row(7)}
      >
        <HostsScreen hosts={[]} onAdd={() => undefined} />
      </Phone>
      <Phone
        commentId="mobile-web-session-sent"
        description="发送回执定格：「已发送 y，等待终端响应…」锁键防重复；回执保留到下一次发送。"
        label="S1s"
        title="会话 · 已发送"
        x={col(1)}
        y={row(7)}
      >
        <StaticSession
          initialEchoKey="y"
          initialKeysOpen
          sessionId={SESSION_WAITING}
        />
      </Phone>
      <Phone
        commentId="mobile-web-notifications-push-failed"
        description="推送开启被拒：内联说明原因与下一步（系统设置 / 添加到主屏幕），可重试可暂不。"
        label="N1c"
        title="收件箱 · 推送开启失败"
        x={col(2)}
        y={row(7)}
      >
        <StaticInbox enablePush push="failed" />
      </Phone>
      <Phone
        commentId="mobile-web-session-light"
        description="亮色主题下的会话读屏与按键面板：终端面走背景，键帽在亮色下用卡片底，不靠半透明叠层。"
        label="S1l"
        light
        title="会话 · 亮色"
        x={col(3)}
        y={row(7)}
      >
        <StaticSession initialKeysOpen sessionId={SESSION_WAITING} />
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
