/**
 * M1 审批条（S1）：仅当 agent waiting 且快照携带 pendingInteractionId 时渲染。
 * 13 个键级审批键（Enter/Esc/y/n/1-9）——语义动作映射不在 UI（宿主无法核实
 * TUI 里 Enter 的真实含义，禁止画成「批准/拒绝」），按键字节经
 * agent.attention.respond 回写，服务端双重门校验。
 * 工效分层：Enter/Esc 大按钮主次呈现（最常用），y/n 次排，数字键折叠。
 */
import { useState } from "react";

export const APPROVAL_KEYS = [
  "enter",
  "escape",
  "y",
  "n",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
] as const;

export type ApprovalKey = (typeof APPROVAL_KEYS)[number];

const DIGIT_KEYS = APPROVAL_KEYS.filter((key) => /^[1-9]$/.test(key));

export function ApprovalBar(props: {
  /** 快照中该 agent 是否 waiting。 */
  waiting: boolean;
  /** 快照 activity 摘要的未决交互 id；客户端不得猜测。 */
  interactionId: string | null;
  /** interaction_stale 后置位：提示并已触发快照刷新。 */
  stale?: boolean;
  onRespond: (key: ApprovalKey) => void;
}) {
  const [digitsOpen, setDigitsOpen] = useState(false);
  if (!props.waiting || props.interactionId === null) {
    return null;
  }
  return (
    <section
      className="border-neutral-800 border-t bg-neutral-900 px-4 py-3"
      data-testid="approval-bar"
    >
      {props.stale === true && (
        <p className="mb-2 text-amber-400 text-xs" data-testid="approval-stale">
          交互已失效，快照已刷新；请确认最新待办后再操作
        </p>
      )}
      <p className="mb-2 text-neutral-300 text-xs">
        需要你处理
        <span className="ml-2 text-[10px] text-neutral-600">
          按键原样发送到该终端 · 交互 {props.interactionId}
        </span>
      </p>
      <div className="flex gap-2">
        <button
          className="min-h-11 flex-[2] rounded-md bg-emerald-600 font-medium text-sm text-white active:bg-emerald-700"
          data-testid="approval-key-enter"
          onClick={() => props.onRespond("enter")}
          type="button"
        >
          Enter
        </button>
        <button
          className="min-h-11 flex-1 rounded-md border border-neutral-600 text-neutral-100 text-sm active:bg-neutral-800"
          data-testid="approval-key-escape"
          onClick={() => props.onRespond("escape")}
          type="button"
        >
          Esc
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        {(["y", "n"] as const).map((key) => (
          <button
            className="min-h-11 flex-1 rounded-md border border-neutral-700 text-neutral-200 text-sm active:bg-neutral-800"
            data-testid={`approval-key-${key}`}
            key={key}
            onClick={() => props.onRespond(key)}
            type="button"
          >
            {key}
          </button>
        ))}
        <button
          className="min-h-11 flex-1 rounded-md border border-neutral-700 border-dashed text-neutral-400 text-sm active:bg-neutral-800"
          data-testid="approval-digits-toggle"
          onClick={() => setDigitsOpen((open) => !open)}
          type="button"
        >
          {digitsOpen ? "收起数字键" : "数字键 1-9"}
        </button>
      </div>
      {digitsOpen && (
        <div className="mt-2 grid grid-cols-5 gap-2">
          {DIGIT_KEYS.map((key) => (
            <button
              className="min-h-11 rounded-md border border-neutral-700 text-neutral-200 text-sm active:bg-neutral-800"
              data-testid={`approval-key-${key}`}
              key={key}
              onClick={() => props.onRespond(key)}
              type="button"
            >
              {key}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
