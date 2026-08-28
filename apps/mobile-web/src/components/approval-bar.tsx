/**
 * M1 审批条（S1）：仅当 agent waiting 且快照携带 pendingInteractionId 时渲染。
 * 13 个键级审批键（Enter/Esc/y/n/1-9）——语义动作映射不在 UI，按键字节经
 * agent.attention.respond 回写，服务端双重门校验。
 */
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

const APPROVAL_KEY_LABEL: Record<ApprovalKey, string> = {
  enter: "Enter",
  escape: "Esc",
  n: "n",
  y: "y",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
};

export function ApprovalBar(props: {
  /** 快照中该 agent 是否 waiting。 */
  waiting: boolean;
  /** 快照 activity 摘要的未决交互 id；客户端不得猜测。 */
  interactionId: string | null;
  /** interaction_stale 后置位：提示并已触发快照刷新。 */
  stale?: boolean;
  onRespond: (key: ApprovalKey) => void;
}) {
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
        需要你处理 · 交互 {props.interactionId}
      </p>
      <div className="flex flex-wrap gap-2">
        {APPROVAL_KEYS.map((key) => (
          <button
            className="min-w-10 flex-1 border border-neutral-600 bg-neutral-800 py-2 text-center text-neutral-100 text-xs active:bg-neutral-700"
            data-testid={`approval-key-${key}`}
            key={key}
            onClick={() => props.onRespond(key)}
            type="button"
          >
            {APPROVAL_KEY_LABEL[key]}
          </button>
        ))}
      </div>
    </section>
  );
}
