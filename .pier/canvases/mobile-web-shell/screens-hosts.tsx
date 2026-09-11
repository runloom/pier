import { Textarea } from "pier/canvas";
import { type ReactNode, useEffect, useState } from "react";
import {
  Body,
  cx,
  DeviceGlyph,
  EmptyState,
  HitButton,
  InlineNote,
  NavBar,
  PhoneShell,
  TOUCH_PRESS,
} from "./chrome.tsx";
import { Icon } from "./icons.tsx";
import { type DemoHost, PAIRED_HOST } from "./model.ts";

type PairPhase =
  | "scanning"
  | "idle"
  | "paste"
  | "recognized"
  | "pairing"
  | "done"
  | "failed-camera"
  | "failed-code"
  | "failed-paste";

const RECOGNIZE_MS = 1600;
const PAIR_MS = 900;

/** 画板内的格式校验演示：真实校验在宿主，这里只要求内容形似配对载荷。 */
function pastedLooksValid(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= 8 && trimmed.toLowerCase().includes("pier");
}

const FAILURE_COPY: Record<
  "failed-camera" | "failed-code" | "failed-paste",
  { body: string; title: string }
> = {
  "failed-camera": {
    body: "无法使用相机。可以在系统设置里允许浏览器使用相机，或改用粘贴配对内容。",
    title: "相机不可用",
  },
  "failed-code": {
    body: "二维码已过期或没有识别完整。请在电脑上重新打开「远程访问」生成新码，或改用粘贴配对内容。",
    title: "没有识别到配对码",
  },
  "failed-paste": {
    body: "粘贴的文本不是有效的配对内容。请回到电脑重新打开「远程访问」，复制完整内容再试。",
    title: "配对内容不完整或已过期",
  },
};

/**
 * H0 配对。主路径是扫码，粘贴是退路；两条路都汇到同一个成功态。
 * 相机不可用与识别失败都有明示帧：重试为主按钮，粘贴为退路。
 * 带 `onPaired` 时（P0）取景框会模拟识别；静态帧用 `initialPhase` 定格。
 */
export function PairScreen(props: {
  initialPhase?: PairPhase | undefined;
  onBack?: (() => void) | undefined;
  onPaired?: ((host: DemoHost) => void) | undefined;
}): ReactNode {
  const [phase, setPhase] = useState<PairPhase>(
    props.initialPhase ?? "scanning"
  );
  const [pasted, setPasted] = useState("");
  const simulate = props.onPaired !== undefined;

  useEffect(() => {
    if (phase === "scanning" && simulate) {
      const timer = setTimeout(() => {
        setPhase("recognized");
      }, RECOGNIZE_MS);
      return () => {
        clearTimeout(timer);
      };
    }
    if (phase === "recognized" || phase === "pairing") {
      const timer = setTimeout(() => {
        setPhase("done");
      }, PAIR_MS);
      return () => {
        clearTimeout(timer);
      };
    }
    return;
  }, [phase, simulate]);

  const busy = phase === "recognized" || phase === "pairing";
  const scanning = phase === "scanning";
  const failed =
    phase === "failed-camera" ||
    phase === "failed-code" ||
    phase === "failed-paste";

  const finish = () => {
    if (props.onPaired === undefined) {
      setPhase("scanning");
      setPasted("");
      return;
    }
    props.onPaired(PAIRED_HOST);
  };

  const nav = (
    <NavBar
      back={
        props.onBack === undefined
          ? undefined
          : { label: "主机", onClick: props.onBack }
      }
      ghost
      layout="split"
      title={
        phase === "done" || phase === "paste" || failed
          ? props.onBack === undefined
            ? "配对"
            : "添加主机"
          : undefined
      }
    />
  );

  if (failed) {
    const copy = FAILURE_COPY[phase];
    return (
      <PhoneShell nav={nav}>
        <Body>
          <InlineNote tone="danger">
            <span className="font-medium">{copy.title}</span>
            <span className="mt-1 block">{copy.body}</span>
          </InlineNote>
          <div className="flex flex-col gap-3">
            <HitButton
              icon={phase === "failed-paste" ? "clipboard" : "scan"}
              onClick={() => {
                if (phase === "failed-paste") {
                  setPasted("");
                  setPhase("paste");
                  return;
                }
                setPhase("scanning");
              }}
            >
              {phase === "failed-paste" ? "重新粘贴" : "重新扫码"}
            </HitButton>
            {phase === "failed-paste" ? null : (
              <HitButton
                icon="clipboard"
                onClick={() => {
                  setPhase("paste");
                }}
                variant="outline"
              >
                粘贴配对内容
              </HitButton>
            )}
          </div>
        </Body>
      </PhoneShell>
    );
  }

  if (phase === "done") {
    return (
      <PhoneShell nav={nav}>
        <Body>
          <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-10 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-status-success-bg text-status-success-fg">
              <Icon className="size-8" name="check" strokeWidth={2} />
            </span>
            <div>
              <p className="font-semibold text-[17px] leading-[22px]">
                已配对 · {PAIRED_HOST.name}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground leading-[18px]">
                之后打开手机端直接看到这台电脑，不用再扫。
              </p>
            </div>
            <HitButton className="mt-2 w-full" onClick={finish}>
              完成
            </HitButton>
          </div>
        </Body>
      </PhoneShell>
    );
  }

  if (phase === "paste") {
    return (
      <PhoneShell nav={nav}>
        <Body>
          <Textarea
            aria-label="配对内容"
            className="min-h-28 resize-none rounded-2xl px-4 py-3 font-mono text-[13px] leading-[18px]"
            onChange={(event) => {
              setPasted(event.target.value);
            }}
            placeholder="粘贴二维码里的完整文本"
            value={pasted}
          />
          <div className="flex gap-3">
            <HitButton
              className="flex-1"
              onClick={() => {
                setPhase("scanning");
                setPasted("");
              }}
              variant="outline"
            >
              取消
            </HitButton>
            <HitButton
              className="flex-[2]"
              disabled={pasted.trim().length === 0}
              onClick={() => {
                setPhase(pastedLooksValid(pasted) ? "pairing" : "failed-paste");
              }}
            >
              配对
            </HitButton>
          </div>
        </Body>
      </PhoneShell>
    );
  }

  return (
    <PhoneShell
      footer={
        <div className="flex flex-col items-center gap-3 px-4 pb-8">
          <p className="text-center text-[13px] text-muted-foreground leading-[18px]">
            在电脑上打开「远程访问」，<span>对准二维码</span>。
          </p>
          <button
            aria-label={
              busy ? "取消配对" : scanning ? "停止扫码" : "开始扫码"
            }
            className="flex size-11 items-center justify-center rounded-xl bg-action-accent text-action-accent-foreground transition-opacity duration-75 active:opacity-80"
            onClick={() => {
              if (busy) {
                setPhase("idle");
                return;
              }
              setPhase(scanning ? "idle" : "scanning");
            }}
            type="button"
          >
            <Icon className="size-[22px]" name={scanning || busy ? "x" : "scan"} />
          </button>
          <button
            className="flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-[13px] text-muted-foreground transition-colors duration-75 active:bg-interactive-active"
            disabled={busy}
            onClick={() => {
              setPhase("paste");
            }}
            type="button"
          >
            <Icon className="size-4" name="clipboard" />
            粘贴配对内容
          </button>
        </div>
      }
      nav={nav}
      tone="terminal"
    >
      <Viewfinder busy={busy} />
    </PhoneShell>
  );
}

function Viewfinder(props: { busy: boolean }): ReactNode {
  const corner = "absolute size-8 border-foreground/80";
  return (
    <div className="flex h-full items-center justify-center pt-[52px] pb-36">
      <div className="relative size-[min(72%,280px)]">
        <span className={cx(corner, "top-0 left-0 border-t-2 border-l-2")} />
        <span className={cx(corner, "top-0 right-0 border-t-2 border-r-2")} />
        <span className={cx(corner, "bottom-0 left-0 border-b-2 border-l-2")} />
        <span className={cx(corner, "right-0 bottom-0 border-b-2 border-r-2")} />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[13px]">
          {props.busy ? (
            <>
              <Icon
                className="size-6 animate-spin text-muted-foreground"
                name="refresh"
              />
              <span className="text-muted-foreground">已识别，正在配对…</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const OFFLINE_HINT =
  "这台电脑目前离线：请让它保持开机并开启远程访问，之后这里会自动变为在线。";
const UNKNOWN_HINT = "远程连接暂时不可用，主机状态未知，会自动重试。";

/**
 * H1 主机（根面）。设备行整行进入；状态点在图标上。
 * 添加入口只留顶栏扫码。离线点按出提示，提示里才出现移除。
 */
export function HostsScreen(props: {
  hosts: readonly DemoHost[];
  /** 静态帧直接展开某台离线 / 未知主机下方的提示。 */
  initialHintId?: string | undefined;
  onAdd?: (() => void) | undefined;
  onEnter?: ((host: DemoHost) => void) | undefined;
  /** 根面等待计数的加速器：1 个等待则打开该会话，多个则进工作台。 */
  onEnterWaiting?: ((host: DemoHost) => void) | undefined;
  onRemove?: ((hostId: string) => void) | undefined;
  /** 每台主机上「需要你处理」的会话数：不依赖推送也能在根面分诊。 */
  waitingByHost?: Readonly<Record<string, number>> | undefined;
}): ReactNode {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [hint, setHint] = useState<{ hostId: string; text: string } | null>(
    () => {
      if (props.initialHintId === undefined) return null;
      const host = props.hosts.find((item) => item.id === props.initialHintId);
      if (host === undefined || host.status === "online") return null;
      return {
        hostId: host.id,
        text: host.status === "offline" ? OFFLINE_HINT : UNKNOWN_HINT,
      };
    }
  );

  useEffect(() => {
    if (props.hosts.length === 0) {
      setConfirmId(null);
    }
  }, [props.hosts.length]);

  const tapHost = (host: DemoHost) => {
    if (confirmId === host.id) {
      setConfirmId(null);
      return;
    }
    setConfirmId(null);
    if (host.status === "online") {
      setHint(null);
      props.onEnter?.(host);
      return;
    }
    setHint({
      hostId: host.id,
      text: host.status === "offline" ? OFFLINE_HINT : UNKNOWN_HINT,
    });
  };

  return (
    <PhoneShell
      nav={
        <NavBar
          layout="split"
          title="主机"
          trailing={
            props.onAdd === undefined ? undefined : (
              <button
                aria-label="添加主机"
                className={cx(
                  "flex min-h-11 items-center gap-1 rounded-xl px-2.5 font-medium text-[13px] leading-5",
                  TOUCH_PRESS
                )}
                onClick={props.onAdd}
                type="button"
              >
                <Icon className="size-5" name="scan" />
                添加
              </button>
            )
          }
        />
      }
    >
      <Body>
        {props.hosts.length === 0 ? (
          <EmptyState
            body="在电脑上出示配对二维码，用顶栏扫码连上一台电脑。"
            icon="scan"
            title="还没有配对的电脑"
          />
        ) : (
          <div className="flex flex-col">
            {props.hosts.map((host) => (
              <HostRow
                confirm={confirmId === host.id}
                hint={hint?.hostId === host.id ? hint.text : undefined}
                host={host}
                key={host.id}
                onCancelConfirm={() => {
                  setConfirmId(null);
                }}
                onDismissHint={() => {
                  setHint(null);
                }}
                onRemove={() => {
                  setConfirmId(null);
                  setHint(null);
                  props.onRemove?.(host.id);
                }}
                onRequestRemove={
                  props.onRemove === undefined
                    ? undefined
                    : () => {
                        setConfirmId(host.id);
                        setHint(null);
                      }
                }
                onTap={() => {
                  tapHost(host);
                }}
                onEnterWaiting={
                  props.onEnterWaiting === undefined
                    ? undefined
                    : () => {
                        if (host.status !== "online") {
                          tapHost(host);
                          return;
                        }
                        props.onEnterWaiting?.(host);
                      }
                }
                waiting={props.waitingByHost?.[host.id] ?? 0}
              />
            ))}
          </div>
        )}
      </Body>
    </PhoneShell>
  );
}

function HostRow(props: {
  confirm: boolean;
  hint?: string | undefined;
  host: DemoHost;
  onCancelConfirm: () => void;
  onDismissHint: () => void;
  onEnterWaiting?: (() => void) | undefined;
  onRemove: () => void;
  onRequestRemove?: (() => void) | undefined;
  onTap: () => void;
  waiting: number;
}): ReactNode {
  const host = props.host;
  const waitingChip =
    props.waiting > 0 ? (
      props.onEnterWaiting === undefined ? (
        <span className="flex min-h-11 max-w-[8.5rem] shrink-0 items-center self-center rounded-xl bg-status-warning-bg px-2.5 text-right text-[12px] text-status-warning-fg leading-4">
          {props.waiting} 个需要你处理
        </span>
      ) : (
        <button
          className="flex min-h-11 max-w-[8.5rem] shrink-0 items-center self-center rounded-xl bg-status-warning-bg px-2.5 text-right text-[12px] text-status-warning-fg leading-4 transition-colors duration-75 active:bg-interactive-active"
          onClick={props.onEnterWaiting}
          type="button"
        >
          {props.waiting} 个需要你处理
        </button>
      )
    ) : null;
  return (
    <div>
      <div className="flex min-h-[88px] items-center gap-2 px-1">
        <button
          className="flex min-h-[88px] min-w-0 flex-1 items-center gap-3.5 py-3 text-left transition-colors duration-75 active:bg-interactive-active"
          onClick={props.onTap}
          type="button"
        >
          <DeviceGlyph device={host.device} status={host.status} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[17px] leading-[22px]">
              {host.name}
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-muted-foreground leading-4">
              {host.detail}
            </span>
          </span>
        </button>
        {waitingChip}
        <button
          aria-label={`进入${host.name}`}
          className="flex min-h-11 shrink-0 items-center px-1 transition-colors duration-75 active:bg-interactive-active"
          onClick={props.onTap}
          type="button"
        >
          <Icon
            className="size-5 text-muted-foreground/50"
            name="chevron-right"
          />
        </button>
      </div>
      {props.hint === undefined || props.confirm ? null : (
        <div className="px-1 pb-3">
          <InlineNote
            action={
              <span className="-my-1.5 flex shrink-0 items-center gap-1">
                {props.onRequestRemove === undefined ? null : (
                  <button
                    className="flex min-h-11 items-center rounded-lg px-3 font-medium text-[13px] leading-[18px] transition-colors duration-75 active:bg-interactive-active"
                    onClick={props.onRequestRemove}
                    type="button"
                  >
                    移除
                  </button>
                )}
                <button
                  className="flex min-h-11 items-center rounded-lg px-3 font-medium text-[13px] leading-[18px] transition-colors duration-75 active:bg-interactive-active"
                  onClick={props.onDismissHint}
                  type="button"
                >
                  知道了
                </button>
              </span>
            }
            tone={props.hint === OFFLINE_HINT ? "warn" : "info"}
          >
            {props.hint}
          </InlineNote>
        </div>
      )}
      {props.confirm ? (
        <div className="flex flex-col gap-3 px-1 pb-4">
          <p className="text-[13px] text-muted-foreground leading-[18px]">
            移除「{host.name}」后，需要重新扫码才能再连这台电脑。
          </p>
          <div className="flex gap-3">
            <HitButton
              className="flex-1"
              onClick={props.onCancelConfirm}
              variant="outline"
            >
              取消
            </HitButton>
            <HitButton className="flex-1" onClick={props.onRemove} variant="danger">
              移除
            </HitButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
