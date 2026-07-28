/** 剥 agent / transcript 协议标记，让标题回到产品语义。 */

/**
 * 用户原文的包装标签——只有这些的**内文**可以被提出来当标题。
 * `system` / `assistant` 不在此列：它们的内文不是用户写的，一旦允许提取，
 * prompt 里随手贴的 `<system>…</system>` 就能决定标题。
 */
const USER_WRAPPER_NAMES = "user_query|user_message|user_prompt|human|query";

/** 绝不能残留在产品标题里的标签（含非用户角色标签，只删不提取内文）。 */
const PROMPT_WRAPPER_NAMES = `${USER_WRAPPER_NAMES}|system|assistant`;

const USER_WRAPPER_PAIR = new RegExp(
  `<(${USER_WRAPPER_NAMES})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`,
  "i"
);

const PROMPT_WRAPPER_TAG = new RegExp(
  `<\\/?(?:${PROMPT_WRAPPER_NAMES})\\b[^>]*>`,
  "gi"
);

/**
 * 剥协议标记但**保留换行**：优先取用户包装标签的内文，再清掉残留标签、
 * 图片占位与 Markdown 图片。行内空白折叠，行结构留给调用方决定。
 *
 * 只做协议标记清理，不做寒暄 / 噪声 / 语义判定：那类启发式已整体移除，
 * 派生层只保留确定性截断。
 */
export function unwrapAgentPromptMarkup(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 整条被代码围栏包住 → 只取围栏内容。
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/m.exec(text.trim());
  if (fenced?.[1] !== undefined) {
    text = fenced[1];
  }

  const wrapped = USER_WRAPPER_PAIR.exec(text);
  if (wrapped?.[2]?.trim()) {
    text = wrapped[2];
  }

  text = text.replace(PROMPT_WRAPPER_TAG, " ");
  text = text.replace(/\[Image\s*#?\d*\]/gi, " ");
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  // 行内空白折叠，换行保留（首行提取是派生层的下一步）。
  text = text.replace(/[^\S\n]+/g, " ");
  return text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/** 单行化版本：展示路径用（历史脏标题直接显示，不再关心行结构）。 */
export function stripAgentPromptMarkup(raw: string): string {
  return unwrapAgentPromptMarkup(raw).replace(/\s+/g, " ").trim();
}

/** 剥标记后的第一段非空文本；全空返回空串。 */
export function firstAgentPromptLine(raw: string): string {
  for (const line of unwrapAgentPromptMarkup(raw).split("\n")) {
    if (line) {
      return line;
    }
  }
  return "";
}
