import { Badge, Stack, Text } from "pier/canvas";
import type { ReactNode } from "react";
import {
  DeviceGlyph,
  Group,
  HitButton,
  KeyCap,
  ListRow,
  SectionLabel,
  sessionStatusBadge,
} from "./chrome.tsx";
import { Icon } from "./icons.tsx";

function KitShell(props: {
  children: ReactNode;
  lead: string;
  title: string;
}): ReactNode {
  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden bg-background p-4 text-foreground">
      <Stack gap={4}>
        <Text as="h3">{props.title}</Text>
        <Text tone="secondary">{props.lead}</Text>
      </Stack>
      {props.children}
    </div>
  );
}

function Rule(props: { children: ReactNode }): ReactNode {
  return (
    <p className="text-[12px] text-muted-foreground leading-[18px]">
      {props.children}
    </p>
  );
}

/** K1 触控：按下态、命中尺寸、键帽、设备卡。 */
export function PressKitScreen(): ReactNode {
  return (
    <KitShell
      lead="系统点击高亮已关掉，主路径必须自绘按下底。命中 44px。有效未决交互才开放按键；按需展开并占位。"
      title="触控"
    >
      <SectionLabel>列表行 · 整行命中 56px</SectionLabel>
      <Group>
        <ListRow
          chevron
          leading={<Icon className="size-5" name="mini" />}
          subtitle="静止"
          title="列表行"
        />
        <ListRow
          chevron
          leading={<Icon className="size-5" name="mini" />}
          pressed
          subtitle="按下 · bg-interactive-active"
          title="列表行"
        />
        <ListRow
          chevron
          leading={<Icon className="size-5" name="sparkle" />}
          subtitle="需要你处理 · 警告底置顶"
          title="等待项"
          tone="waiting"
          trailing={sessionStatusBadge({
            agent: "Claude Code",
            hasGit: true,
            hostId: "kit",
            id: "kit-wait",
            kind: "agent",
            screen: [],
            status: "waiting",
            title: "等待项",
            worktree: "feat-mobile",
          })}
        />
      </Group>
      <SectionLabel>按钮 · 44px</SectionLabel>
      <div className="flex gap-2">
        <HitButton className="flex-1">主按钮</HitButton>
        <HitButton className="flex-1" variant="outline">
          次要
        </HitButton>
        <HitButton className="flex-1" variant="tinted">
          填充
        </HitButton>
      </div>
      <SectionLabel>终端键帽 · 44px</SectionLabel>
      <div className="flex gap-1.5">
        <KeyCap>Esc</KeyCap>
        <KeyCap>Tab</KeyCap>
        <KeyCap tone="accent" wide>
          Enter
        </KeyCap>
        <KeyCap tone="waiting">y</KeyCap>
        <KeyCap tone="waiting">n</KeyCap>
      </div>
      <SectionLabel>设备图标 · 状态点在右下</SectionLabel>
      <div className="flex items-center gap-3">
        <DeviceGlyph device="mini" status="online" />
        <DeviceGlyph device="studio" status="offline" />
        <DeviceGlyph device="laptop" pulse status="connecting" />
      </div>
      <Rule>
        主按钮按下 opacity-80；行与次要按钮按下 bg-interactive-active。
        不要把桌面 28px 控件搬进手机。不要用筛选芯片当工作台主过滤。
      </Rule>
    </KitShell>
  );
}

function MotionStep(props: { from: string; to: string }): ReactNode {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-11 flex-1 items-center rounded-xl border border-border bg-muted px-3 text-[12px] text-muted-foreground">
        {props.from}
      </div>
      <Icon className="size-4 text-muted-foreground" name="chevron-right" />
      <div className="flex h-11 flex-1 items-center rounded-xl border border-border bg-card px-3 text-[12px]">
        {props.to}
      </div>
    </div>
  );
}

/** K2 过渡：父子推入 / 返回反向；没有底栏。 */
export function MotionKitScreen(): ReactNode {
  return (
    <KitShell
      lead="横滑只表示更深一层。有「返回」就必须有反向滑出。"
      title="页面过渡"
    >
      <SectionLabel>推入 · 220ms · cubic-bezier(0.32, 0.72, 0, 1)</SectionLabel>
      <div className="flex flex-col gap-2">
        <MotionStep from="主机" to="这台电脑" />
        <MotionStep from="这台电脑" to="会话 / 通知 / 变更" />
        <MotionStep from="会话" to="变更 / 文件" />
      </div>
      <Rule>
        新页从右进；底页左移 25% 并加暗（overlay-scrim）。只动 translate。
      </Rule>
      <SectionLabel>返回 · 同曲线反向</SectionLabel>
      <Rule>
        顶栏「返回」和系统后退走同一条动画。底页从 −25% 回到
        0，出场页滑到右侧后卸载。
      </Rule>
      <SectionLabel>同页切换 · 不推入</SectionLabel>
      <Rule>
        文件页目录往下走、变更页点开单文件、底部面板切同机会话、按键面板显隐：只换内容，不做页面过渡。
      </Rule>
      <SectionLabel>prefers-reduced-motion</SectionLabel>
      <Rule>取消位移，改为 120ms 淡入淡出。</Rule>
    </KitShell>
  );
}

function StateRow(props: {
  label: string;
  note: string;
  sample: ReactNode;
}): ReactNode {
  return (
    <div className="flex min-h-9 items-center gap-3 py-1">
      <span className="w-[76px] shrink-0 text-[12px] text-muted-foreground">
        {props.label}
      </span>
      <span className="flex min-w-[96px] items-center gap-2">
        {props.sample}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
        {props.note}
      </span>
    </div>
  );
}

/** K3 状态词与令牌：全壳同一套，不要各页自造。 */
export function StateKitScreen(): ReactNode {
  return (
    <KitShell
      lead="状态词与桌面一致，颜色只走语义令牌。severity 只驱动徽标，不加前置图标。"
      title="状态与色"
    >
      <SectionLabel>连接态 · 点在设备图标上</SectionLabel>
      <div className="divide-y divide-border/60">
        <StateRow
          label="在线"
          note="整卡可进；status-success"
          sample={<DeviceGlyph device="mini" status="online" />}
        />
        <StateRow
          label="连接中"
          note="进入后的 ≤1s；点脉冲"
          sample={<DeviceGlyph device="mini" pulse status="connecting" />}
        />
        <StateRow
          label="离线"
          note="点卡给去电脑上开的提示"
          sample={<DeviceGlyph device="studio" status="offline" />}
        />
      </div>
      <SectionLabel>会话态 · 只对智能体</SectionLabel>
      <div className="divide-y divide-border/60">
        <StateRow
          label="需要你处理"
          note="预览下方标状态；按键按需展开"
          sample={<Badge variant="warning">需要你处理</Badge>}
        />
        <StateRow
          label="运行中"
          note="连续读屏；底部阅读工具"
          sample={<Badge variant="info">运行中</Badge>}
        />
        <StateRow
          label="等待输入"
          note="回合完成后"
          sample={<Badge variant="neutral">等待输入</Badge>}
        />
        <StateRow
          label="普通终端"
          note="无徽标、键行不可发"
          sample={
            <Icon className="size-5 text-muted-foreground" name="terminal" />
          }
        />
      </div>
      <SectionLabel>变更 · 状态字母</SectionLabel>
      <div className="flex gap-5 px-1 font-mono font-semibold text-[13px]">
        <span className="text-status-warning-fg">M 修改</span>
        <span className="text-status-success-fg">A 新增</span>
        <span className="text-status-danger-fg">D 删除</span>
        <span className="text-muted-foreground">? 未跟踪</span>
      </div>
      <SectionLabel>通知</SectionLabel>
      <div className="flex items-center gap-3 px-1 text-[12px] text-muted-foreground">
        <span className="size-2 rounded-full bg-action-danger" />
        事件标题与详情 · 保留发生时间 · 未读红点 · 无前置状态图标
      </div>
    </KitShell>
  );
}
