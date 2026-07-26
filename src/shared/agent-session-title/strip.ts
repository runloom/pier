/** 剥 agent / transcript 协议标记，让标题回到产品语义。 */

/** 绝不能出现在产品标题里的 transcript 包装标签。 */
const PROMPT_WRAPPER_NAMES =
  "user_query|user_message|user_prompt|human|query|system|assistant";

const PROMPT_WRAPPER_PAIR = new RegExp(
  `<(${PROMPT_WRAPPER_NAMES})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`,
  "i"
);

const PROMPT_WRAPPER_TAG = new RegExp(
  `<\\/?(?:${PROMPT_WRAPPER_NAMES})\\b[^>]*>`,
  "gi"
);

/**
 * 优先取已知包装标签的内文；再清掉残留标签、图片占位与 Markdown 图片。
 * 不做寒暄 / 噪声判定——那是 noise.ts 的职责。
 */
export function stripAgentPromptMarkup(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 整条被代码围栏包住 → 只取围栏内容。
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/m.exec(text.trim());
  if (fenced?.[1] !== undefined) {
    text = fenced[1];
  }

  const wrapped = PROMPT_WRAPPER_PAIR.exec(text);
  if (wrapped?.[2]?.trim()) {
    text = wrapped[2];
  }

  text = text.replace(PROMPT_WRAPPER_TAG, " ");
  text = text.replace(/\[Image\s*#?\d*\]/gi, " ");
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}
