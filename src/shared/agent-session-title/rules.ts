/**
 * 规则层：把口语 prompt 收敛成任务短语。确定性、离线、零成本。
 *
 * 中文口语的信息密度前低后高——「帮我 / 请问 / 当前」这类元语言前缀占满开头，
 * 主题词被挤到硬截断线之外。这一层就是把它们摘掉，让截断（如果还需要的话）
 * 落在有信息的部分。
 *
 * 每一步都有下限保护：改完短于 MIN_RULE_TITLE_LENGTH 就撤销该步，
 * 宁可留长也不产出残句。
 */

import { MIN_RULE_TITLE_LENGTH } from "./constants.ts";

/** 句末边界。命中即认为标题只需要第一小句。 */
const CLAUSE_BOUNDARY = /[。！？!?…；;，,、:：\n]/u;

/**
 * 锚定在开头的元语言前缀。全部多字符——单字「请」会把「请求超时」切成
 * 「求超时」，得不偿失。
 */
const META_PREFIX =
  /^(?:请帮我|请问|帮我|帮忙|麻烦你|麻烦|我想问一下|我想问下|我想|我要|想问一下|想问下|问一下|问下|能不能|能否|可不可以|你能|你可以|现在|当前|这边|help me|can you|could you|would you|please|i want to|i need to|i'd like to|how do i|how can i|how to|what is|what's|let's)\s*/i;

/** 剥完前缀后若以这些虚词开头，说明剥错了（如「现在的方案」→「的方案」）。 */
const DANGLING_PARTICLE = /^[的了是在得地和与及]/u;

/** 句尾语气词。 */
const TRAILING_MODALITY = /(?:呢|吧|吗|嘛|啊|呀|哈|哦|谢谢|thanks|thx)$/i;

/** 句尾标点。 */
const TRAILING_PUNCT = /[\s。，、；：！？!?,.;:…]+$/u;

/** 句尾疑问句式——摘掉后剩下的就是主题名词短语。 */
const INTERROGATIVE_TAIL =
  /(?:是什么样的|是怎么样的|是怎样的|是啥样的|是怎么回事|是什么情况|是怎么实现的|是如何实现的|怎么实现的|如何实现的|是什么|有什么问题|怎么实现|如何实现|怎么回事|怎么做的|怎么做|怎么修|怎么用|如何使用|如何修复|怎么修复)$/u;

/** 句首疑问词。剥完只剩主题。短词单独一层，避免和 META_PREFIX 混。 */
const LEADING_INTERROGATIVE = /^(?:为什么|为何|如何|怎么)\s*/u;

/** 句尾时间副词（疑问句式摘掉后常裸露出来）。 */
const TRAILING_ADVERB = /(?:现在|目前|当下|如今)$/u;

function keepIfLongEnough(next: string, fallback: string): string {
  const trimmed = next.trim();
  return [...trimmed].length >= MIN_RULE_TITLE_LENGTH ? trimmed : fallback;
}

/** 取第一小句。找不到够长的边界就整条保留。 */
export function takeFirstClause(text: string): string {
  let cursor = 0;
  while (cursor < text.length) {
    const rest = text.slice(cursor);
    const match = CLAUSE_BOUNDARY.exec(rest);
    if (!match || match.index === undefined) {
      return text;
    }
    const end = cursor + match.index;
    const head = text.slice(0, end).trim();
    if ([...head].length >= MIN_RULE_TITLE_LENGTH) {
      return head;
    }
    cursor = end + match[0].length;
  }
  return text;
}

/** 剥元语言前缀。最多三层（「麻烦帮我」这类叠加）。 */
export function stripMetaPrefix(text: string): string {
  let current = text;
  for (let pass = 0; pass < 3; pass += 1) {
    const match = META_PREFIX.exec(current);
    if (!match) {
      return current;
    }
    const next = current.slice(match[0].length).trim();
    if (
      [...next].length < MIN_RULE_TITLE_LENGTH ||
      DANGLING_PARTICLE.test(next)
    ) {
      return current;
    }
    current = next;
  }
  return current;
}

/** 剥句尾标点与语气词。 */
export function stripTrailingModality(text: string): string {
  let current = text;
  for (let pass = 0; pass < 3; pass += 1) {
    const withoutPunct = keepIfLongEnough(
      current.replace(TRAILING_PUNCT, ""),
      current
    );
    const withoutModality = keepIfLongEnough(
      withoutPunct.replace(TRAILING_MODALITY, ""),
      withoutPunct
    );
    if (withoutModality === current) {
      return current;
    }
    current = withoutModality;
  }
  return current;
}

/** 疑问句名词化：摘句首疑问词、句尾问式与裸露的时间副词。 */
export function nominalize(text: string): string {
  const withoutLeading = keepIfLongEnough(
    text.replace(LEADING_INTERROGATIVE, ""),
    text
  );
  const withoutTail = keepIfLongEnough(
    withoutLeading.replace(INTERROGATIVE_TAIL, ""),
    withoutLeading
  );
  if (withoutTail === withoutLeading) {
    return withoutLeading;
  }
  return keepIfLongEnough(
    withoutTail.replace(TRAILING_ADVERB, ""),
    withoutTail
  );
}

/**
 * 规则流水线。入参必须是已经过 stripAgentPromptMarkup 且非噪声的文本。
 * 输出未做长度上限裁剪——那是 normalize 的职责。
 */
export function applyTitleRules(text: string): string {
  const clause = takeFirstClause(text);
  const withoutPrefix = stripMetaPrefix(clause);
  const withoutModality = stripTrailingModality(withoutPrefix);
  const nominal = nominalize(withoutModality);
  const settled = stripTrailingModality(nominal).trim();
  return [...settled].length >= MIN_RULE_TITLE_LENGTH ? settled : clause.trim();
}
