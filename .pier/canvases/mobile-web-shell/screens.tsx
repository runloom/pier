import { Badge, Stack } from "pier/canvas";
import { type ReactNode, useState } from "react";
import {
  BellButton,
  ConnBadge,
  cx,
  HeaderLink,
  HitButton,
  PhoneShell,
  PressRow,
  SectionLabel,
} from "./chrome.tsx";

/** 画板用的示范数据：标题对齐桌面 tab short（叶子目录 / 钉名），不是产品 id。 */
export const DEMO = {
  changesLabel: "变更 · feat-mobile",
  hostOffline: "工作室 Mac Studio",
  hostOnline: "办公桌 Mac mini",
  runningTitle: "xyz",
  terminalTitle: "ghostty",
  waitingTitle: "feat-mobile",
} as const;

const HOST_FILTERS = [
  { id: "all", label: "全部" },
  { id: "waiting", label: "需要你处理" },
  { id: "processing", label: "运行中" },
] as const;

export function PairScreen(props: {
  onBack?: (() => void) | undefined;
}): ReactNode {
  const [scanning, setScanning] = useState(true);
  return (
    <PhoneShell
      backLabel={props.onBack === undefined ? undefined : "主机"}
      onBack={props.onBack}
      title={props.onBack === undefined ? "配对" : "添加主机"}
    >
      <div className="flex h-full flex-col gap-4 overflow-y-auto px-4 pb-4">
        <Stack gap={6}>
          <p className="text-sm leading-relaxed">
            在电脑上打开远程访问，出示二维码。扫一次即可，之后打开不用再扫。
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            没有相机时，从相册选取，或粘贴二维码里的完整文本。
          </p>
        </Stack>
        <div className="flex min-h-40 flex-1 items-center justify-center rounded-2xl border border-border border-dashed bg-muted/40">
          <span className="text-muted-foreground text-xs">
            {scanning ? "对准二维码" : "取景框"}
          </span>
        </div>
        <HitButton
          onClick={() => {
            setScanning((value) => !value);
          }}
        >
          {scanning ? "停止扫码" : "开始扫码"}
        </HitButton>
        <HitButton variant="ghost">从相册选取</HitButton>
        <HitButton variant="ghost">粘贴配对内容</HitButton>
      </div>
    </PhoneShell>
  );
}

export function HostsScreen(props: {
  onAdd?: (() => void) | undefined;
  onEnter?: (() => void) | undefined;
}): ReactNode {
  return (
    <PhoneShell title="主机">
      <div className="flex h-full flex-col gap-3 overflow-y-auto px-4 pb-3">
        <Stack gap={8}>
          <PressRow onClick={props.onEnter}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-sm">{DEMO.hostOnline}</p>
            </div>
            <ConnBadge state="online" />
            <span className="text-muted-foreground">›</span>
          </PressRow>
          <PressRow>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-sm">{DEMO.hostOffline}</p>
              <p className="text-[11px] text-muted-foreground">电脑离线</p>
            </div>
            <ConnBadge state="offline" />
          </PressRow>
        </Stack>
        <HitButton onClick={props.onAdd} variant="ghost">
          添加主机
        </HitButton>
      </div>
    </PhoneShell>
  );
}

export function HostScreen(props: {
  empty?: boolean | undefined;
  onBack?: (() => void) | undefined;
  onOpenChanges?: (() => void) | undefined;
  onOpenInbox?: (() => void) | undefined;
  onOpenRunning?: (() => void) | undefined;
  onOpenSession?: (() => void) | undefined;
}): ReactNode {
  const [filter, setFilter] = useState<(typeof HOST_FILTERS)[number]["id"]>(
    "all"
  );
  return (
    <PhoneShell
      backLabel="主机"
      context="在线"
      onBack={props.onBack}
      title={DEMO.hostOnline}
      trailing={
        <BellButton onClick={props.onOpenInbox} unread={props.empty !== true} />
      }
    >
      <div className="flex h-full flex-col gap-4 overflow-y-auto px-4 pb-3">
        {props.empty === true ? (
          <div className="flex flex-1 flex-col justify-center gap-2 px-2 py-12">
            <p className="text-center text-sm">这台电脑现在没有会话</p>
            <p className="text-center text-[11px] text-muted-foreground leading-relaxed">
              请在电脑上开一个终端或智能体。
            </p>
          </div>
        ) : null}
        {props.empty === true ? null : (
        <>
        <Stack gap={8}>
          <SectionLabel
            trailing={
              <div className="flex gap-1">
                {HOST_FILTERS.map((item) => (
                  <button
                    className={cx(
                      "min-h-8 rounded-full px-2.5 text-[11px] active:bg-interactive-active",
                      filter === item.id
                        ? "bg-secondary font-medium"
                        : "text-muted-foreground"
                    )}
                    key={item.id}
                    onClick={() => {
                      setFilter(item.id);
                    }}
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            }
          >
            终端
          </SectionLabel>
          {filter === "processing" ? null : (
            <PressRow onClick={props.onOpenSession} tone="waiting">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">
                  {DEMO.waitingTitle}
                </p>
                <p className="text-[11px] text-muted-foreground">智能体</p>
              </div>
              <Badge variant="warning">需要你处理</Badge>
            </PressRow>
          )}
          {filter === "waiting" ? null : (
            <>
              <PressRow onClick={props.onOpenRunning}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">
                    {DEMO.runningTitle}
                  </p>
                  <p className="text-[11px] text-muted-foreground">智能体</p>
                </div>
                <Badge variant="info">运行中</Badge>
              </PressRow>
              <PressRow>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">
                    {DEMO.terminalTitle}
                  </p>
                  <p className="text-[11px] text-muted-foreground">终端</p>
                </div>
              </PressRow>
            </>
          )}
        </Stack>
        <Stack gap={8}>
          <SectionLabel>变更</SectionLabel>
          <PressRow onClick={props.onOpenChanges}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-sm">{DEMO.changesLabel}</p>
              <p className="text-[11px] text-muted-foreground">只读</p>
            </div>
            <span className="text-muted-foreground">›</span>
          </PressRow>
        </Stack>
        </>
        )}
      </div>
    </PhoneShell>
  );
}

export function SessionScreen(props: {
  backLabel?: string | undefined;
  onBack?: (() => void) | undefined;
  onOpenChanges?: (() => void) | undefined;
  onOpenFiles?: (() => void) | undefined;
  title?: string | undefined;
  waiting?: boolean | undefined;
}): ReactNode {
  const waiting = props.waiting ?? true;
  return (
    <PhoneShell
      backLabel={props.backLabel ?? DEMO.hostOnline}
      footer={waiting ? <ApprovalDock /> : undefined}
      onBack={props.onBack}
      title={props.title ?? DEMO.waitingTitle}
      trailing={
        <div className="flex items-center">
          <ConnBadge state="online" />
          <HeaderLink onClick={props.onOpenChanges}>变更</HeaderLink>
          <HeaderLink onClick={props.onOpenFiles}>文件</HeaderLink>
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <p className="px-4 py-1 text-[11px] text-muted-foreground">当前屏幕</p>
        <pre className="min-h-0 flex-1 overflow-hidden bg-surface-inset px-4 py-3 font-mono text-[11px] leading-5 text-foreground/90">
          {waiting
            ? `需要权限才能继续：

  git diff --staged`
            : `$ pnpm test:unit
 PASS  128`}
        </pre>
      </div>
    </PhoneShell>
  );
}

function ApprovalDock(): ReactNode {
  const [digits, setDigits] = useState(false);
  return (
    <section className="border-border border-t bg-card px-4 py-3">
      <p className="mb-2 text-xs">
        需要你处理
        <span className="ml-2 text-[11px] text-muted-foreground">
          按键会发到这台电脑的终端
        </span>
      </p>
      <div className="flex gap-2">
        <HitButton className="flex-[2]">Enter</HitButton>
        <HitButton className="flex-1" variant="outline">
          Esc
        </HitButton>
      </div>
      <div className="mt-2 flex gap-2">
        <HitButton className="flex-1" variant="outline">
          y
        </HitButton>
        <HitButton className="flex-1" variant="outline">
          n
        </HitButton>
        <HitButton
          className="flex-1"
          onClick={() => {
            setDigits((value) => !value);
          }}
          variant="ghost"
        >
          {digits ? "收起" : "1–9"}
        </HitButton>
      </div>
      {digits ? (
        <div className="mt-2 grid grid-cols-5 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((key) => (
            <HitButton key={key} variant="outline">
              {key}
            </HitButton>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function ChangesScreen(props: {
  backLabel?: string | undefined;
  onBack?: (() => void) | undefined;
}): ReactNode {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <PhoneShell
      backLabel={props.backLabel ?? "会话"}
      onBack={props.onBack}
      title="变更"
      trailing={<ConnBadge state="online" />}
    >
      <div className="flex h-full flex-col gap-2 overflow-y-auto px-4 pb-3">
        <p className="text-[11px] text-muted-foreground">feat-mobile · 只读</p>
        {selected === null ? (
          <>
            <PressRow
              onClick={() => {
                setSelected("app.tsx");
              }}
            >
              <Badge variant="warning">M</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs">
                  apps/mobile-web/src/app.tsx
                </p>
                <p className="text-[11px] text-muted-foreground">+18 −4</p>
              </div>
              <span className="text-muted-foreground">›</span>
            </PressRow>
            <PressRow
              onClick={() => {
                setSelected("chrome.tsx");
              }}
            >
              <Badge variant="success">A</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs">
                  apps/mobile-web/src/chrome.tsx
                </p>
                <p className="text-[11px] text-muted-foreground">+86</p>
              </div>
              <span className="text-muted-foreground">›</span>
            </PressRow>
          </>
        ) : (
          <pre className="min-h-0 flex-1 overflow-hidden rounded-xl bg-surface-inset px-3 py-3 font-mono text-[11px] leading-5">
            {`@@ app.tsx
- CurrentPage
+ ConnectionBanner
+ CurrentPage`}
          </pre>
        )}
      </div>
    </PhoneShell>
  );
}

export function FilesScreen(props: {
  backLabel?: string | undefined;
  onBack?: (() => void) | undefined;
}): ReactNode {
  const [preview, setPreview] = useState(false);
  return (
    <PhoneShell
      backLabel={props.backLabel ?? "会话"}
      onBack={props.onBack}
      title="文件"
      trailing={<ConnBadge state="online" />}
    >
      <div className="flex h-full flex-col gap-2 overflow-y-auto px-4 pb-3">
        <p className="text-[11px] text-muted-foreground">feat-mobile · 只读</p>
        {preview ? (
          <div className="rounded-xl border border-border bg-card px-3 py-3 text-sm leading-relaxed">
            Pier 是本地 AI 开发工作台。
          </div>
        ) : (
          <>
            <PressRow>
              <span className="w-4 text-muted-foreground">▸</span>
              <p className="min-w-0 flex-1 truncate text-sm">apps</p>
            </PressRow>
            <PressRow>
              <span className="w-4 text-muted-foreground">▸</span>
              <p className="min-w-0 flex-1 truncate text-sm">docs</p>
            </PressRow>
            <PressRow
              onClick={() => {
                setPreview(true);
              }}
            >
              <span className="w-4 text-muted-foreground">·</span>
              <p className="min-w-0 flex-1 truncate font-mono text-sm">
                README.md
              </p>
            </PressRow>
          </>
        )}
      </div>
    </PhoneShell>
  );
}

export function NotificationsScreen(props: {
  onBack?: (() => void) | undefined;
  onOpen?: (() => void) | undefined;
}): ReactNode {
  return (
    <PhoneShell
      backLabel={DEMO.hostOnline}
      onBack={props.onBack}
      title="通知"
      trailing={<HeaderLink>全部已读</HeaderLink>}
    >
      <div className="flex h-full flex-col gap-3 overflow-y-auto px-4 pb-3">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-3 py-3">
          <p className="text-xs leading-relaxed">
            把 Pier 添加到主屏幕后，离开电脑也能收到「需要你处理」
          </p>
          <HitButton className="shrink-0 px-3">开启提醒</HitButton>
        </div>
        <PressRow onClick={props.onOpen}>
          <span className="size-2 shrink-0 rounded-full bg-action-danger" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm">需要你处理</p>
            <p className="text-[11px] text-muted-foreground">
              权限确认停在终端，点按打开该会话 · 刚刚
            </p>
          </div>
        </PressRow>
        <PressRow>
          <span className="size-2 shrink-0 rounded-full bg-transparent" />
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-sm">回合结束</p>
            <p className="text-[11px] text-muted-foreground">
              {DEMO.runningTitle} 已停在当前屏幕 · 12 分钟前
            </p>
          </div>
        </PressRow>
      </div>
    </PhoneShell>
  );
}
