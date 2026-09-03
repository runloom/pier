import { Textarea } from "pier/canvas";
import { type ReactNode, useEffect, useState } from "react";
import {
  Body,
  cx,
  DeviceGlyph,
  EmptyState,
  HitButton,
  IconButton,
  InlineNote,
  NavBar,
  PhoneShell,
} from "./chrome.tsx";
import { Icon } from "./icons.tsx";
import { type DemoHost, PAIRED_HOST } from "./model.ts";

type PairPhase =
  | "scanning"
  | "idle"
  | "paste"
  | "recognized"
  | "pairing"
  | "done";

const RECOGNIZE_MS = 1600;
const PAIR_MS = 900;

/**
 * H0 配对。主路径是扫码，相册与粘贴是退路；三条路都汇到同一个成功态。
 * 带 `onPaired` 时（P0）取景框会模拟识别；静态帧只切换取景框。
 */
export function PairScreen(props: {
  onBack?: (() => void) | undefined;
  onPaired?: ((host: DemoHost) => void) | undefined;
}): ReactNode {
  const [phase, setPhase] = useState<PairPhase>("scanning");
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
      backIconOnly={props.onBack !== undefined}
      ghost
      layout="split"
      title={
        phase === "done" || phase === "paste"
          ? props.onBack === undefined
            ? "配对"
            : "添加主机"
          : undefined
      }
    />
  );

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
                setPhase("pairing");
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
            aria-label={scanning ? "停止扫码" : "开始扫码"}
            className="flex size-11 items-center justify-center rounded-xl bg-action-accent text-action-accent-foreground transition-opacity duration-75 active:opacity-80 disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              setPhase(scanning ? "idle" : "scanning");
            }}
            type="button"
          >
            <Icon className="size-[22px]" name={scanning ? "x" : "scan"} />
          </button>
        </div>
      }
      nav={nav}
      tone="terminal"
    >
      <Viewfinder busy={busy} scanning={scanning} />
    </PhoneShell>
  );
}

function Viewfinder(props: { busy: boolean; scanning: boolean }): ReactNode {
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
          ) : props.scanning ? null : (
            <span className="text-muted-foreground">取景框</span>
          )}
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
  onAdd?: (() => void) | undefined;
  onEnter?: ((host: DemoHost) => void) | undefined;
  onRemove?: ((hostId: string) => void) | undefined;
}): ReactNode {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [hint, setHint] = useState<{ hostId: string; text: string } | null>(
    null
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
              <IconButton icon="scan" label="添加主机" onClick={props.onAdd} />
            )
          }
        />
      }
    >
      <Body>
        {props.hosts.length === 0 ? (
          <EmptyState
            body="在电脑上出示配对二维码，用顶栏扫码连上这台电脑。"
            icon="scan"
            title="还没有配对的电脑"
          />
        ) : (
          <>
            <div className="flex flex-col">
              {props.hosts.map((host) => (
                <HostRow
                  confirm={confirmId === host.id}
                  host={host}
                  key={host.id}
                  onCancelConfirm={() => {
                    setConfirmId(null);
                  }}
                  onRemove={() => {
                    setConfirmId(null);
                    setHint(null);
                    props.onRemove?.(host.id);
                  }}
                  onTap={() => {
                    tapHost(host);
                  }}
                />
              ))}
            </div>
            {hint === null ? null : (
              <InlineNote
                action={
                  <span className="flex shrink-0 items-center gap-3">
                    {props.onRemove === undefined ? null : (
                      <button
                        className="font-medium text-[13px] leading-[18px] transition-colors duration-75 active:bg-interactive-active"
                        onClick={() => {
                          setConfirmId(hint.hostId);
                          setHint(null);
                        }}
                        type="button"
                      >
                        移除
                      </button>
                    )}
                    <button
                      className="font-medium text-[13px] leading-[18px] transition-colors duration-75 active:bg-interactive-active"
                      onClick={() => {
                        setHint(null);
                      }}
                      type="button"
                    >
                      知道了
                    </button>
                  </span>
                }
                tone={hint.text === OFFLINE_HINT ? "warn" : "info"}
              >
                {hint.text}
              </InlineNote>
            )}
          </>
        )}
      </Body>
    </PhoneShell>
  );
}

function HostRow(props: {
  confirm: boolean;
  host: DemoHost;
  onCancelConfirm: () => void;
  onRemove: () => void;
  onTap: () => void;
}): ReactNode {
  const host = props.host;
  return (
    <div>
      <button
        className="flex min-h-[88px] w-full items-center gap-3.5 px-1 py-3 text-left transition-colors duration-75 active:bg-interactive-active"
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
