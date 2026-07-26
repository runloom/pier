/**
 * 规则层语料快照——中英文 prompt → 期望标题。
 *
 * 这是规则层的唯一真源：改规则流水线必须先改这里的期望，让回归立即可见。
 * 期望的原则：
 * - 名词短语，不是完整句子或问句
 * - 不以省略号结尾（除非原始 prompt 就是长篇，规则层没截到）
 * - 剥掉元语言前缀与句尾语气
 */

import { deriveAgentSessionTitleFromPrompt } from "@shared/agent-session-title/index.ts";
import { describe, expect, it } from "vitest";

interface Case {
  expected: string | null;
  input: string;
}

const CASES: readonly Case[] = [
  // —— 中文：疑问句名词化 ——
  {
    input: "当前项目 agent 的标题生成逻辑现在是什么样的呢",
    expected: "项目 agent 的标题生成逻辑",
  },
  { input: "这个函数是怎么实现的", expected: "这个函数" },
  { input: "为什么终端会闪", expected: "终端会闪" },
  { input: "帮我看看这个 bug 怎么修", expected: "看看这个 bug" },
  { input: "如何修复 resize 崩溃", expected: "修复 resize 崩溃" },

  // —— 中文：元语言前缀剥离 ——
  { input: "帮我分析下当前未提交的修改", expected: "分析下当前未提交的修改" },
  { input: "请帮我重构 markdown 预览大纲", expected: "重构 markdown 预览大纲" },
  { input: "我想问下工作树的创建流程", expected: "工作树的创建流程" },
  { input: "能不能加一个刷新按钮", expected: "加一个刷新按钮" },
  { input: "麻烦看下这个报错", expected: "看下这个报错" },

  // —— 中文：句尾语气 ——
  { input: "终端 resize 对齐问题吧", expected: "终端 resize 对齐问题" },
  { input: "字体加载顺序哈", expected: "字体加载顺序" },

  // —— 中文：首句截断 ——
  {
    input: "修一下 parser 崩溃，复现步骤很长很长很长很长",
    expected: "修一下 parser 崩溃",
  },

  // —— 中文：噪声（返回 null，等下一条） ——
  { input: "你好", expected: null },
  { input: "继续", expected: null },
  { input: "好的", expected: null },
  { input: "谢谢", expected: null },
  { input: "/clear", expected: null },
  { input: "/compact", expected: null },

  // —— 英文 ——
  {
    input: "How do I fix the terminal flicker",
    expected: "fix the terminal flicker",
  },
  {
    input: "Can you refactor the auth module",
    expected: "refactor the auth module",
  },
  {
    input: "What is the deployment pipeline",
    expected: "the deployment pipeline",
  },
  {
    input: "help me debug the websocket connection",
    expected: "debug the websocket connection",
  },
  { input: "hi", expected: null },
  { input: "ok", expected: null },
  { input: "thanks", expected: null },

  // —— 报错栈 / 路径 / URL ——
  { input: "TypeError: Cannot read properties of undefined", expected: null },
  { input: "    at foo (bar.ts:12:34)", expected: null },
  { input: "src/foo/bar.ts", expected: null },
  { input: "https://example.com/x", expected: null },

  // —— 标记包装 ——
  {
    input: "<user_query>\ncmd + p 会先展示 loading spinner\n</user_query>",
    expected: "cmd + p 会先展示 loading spinner",
  },

  // —— 图片占位 ——
  {
    input: "[Image #1] 帮我修一下 parser 崩溃，复现步骤很长",
    expected: "修一下 parser 崩溃",
  },
];

describe("deriveAgentSessionTitleFromPrompt — 语料快照", () => {
  for (const { input, expected } of CASES) {
    it(JSON.stringify(input).slice(0, 40), () => {
      expect(deriveAgentSessionTitleFromPrompt(input)).toBe(expected);
    });
  }
});
