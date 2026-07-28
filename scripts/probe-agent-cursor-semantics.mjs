#!/usr/bin/env node
/**
 * 探测某个 agent TUI 的硬件光标语义（DECTCEM `?25`），用于决定能否在
 * `AGENT_CATALOG` 里为它声明 `inputFocusProbe: "cursor"`。
 *
 * 背景：Pier 可把「硬件光标可见」作为「TUI 输入框已聚焦」的风险信号。
 * 这个等价关系**不是通用惯例**——多数现代 TUI 自绘插入点、首帧后恒 `?25l`，
 * 对它们启用探针会持续误报（2026-07-27 claude 回归即此）。因此每次新增或
 * 复核声明前必须实测一次。
 *
 * 用法（在**真实终端**里跑，需要 tty）：
 *
 *   pnpm probe:cursor-semantics -- crush
 *   pnpm probe:cursor-semantics --keep -- grok
 *   pnpm probe:cursor-semantics --analyze /tmp/pier-cursor-probe-xxx.log
 *
 * 交互步骤：agent 起来后，手动在「输入框聚焦」和「浏览态（点消息区 / Tab /
 * Esc）」之间来回切几次，再退出 agent。脚本读取 `script(1)` 的原始记录，
 * 打印 `?25` 翻转序列和末态，供人工核对。
 *
 * 判读：
 * - 多次翻转 → 只说明记录足够核对，仍须人工确认翻转是否与聚焦/失焦动作
 *   一一对应。
 * - 没有序列或翻转不足 → 证据不足，不能声明。
 * - 末态取决于退出前所处界面，不能单独用于判断。
 *
 * 相关：docs/superpowers/specs/2026-07-24-tui-input-focus-model.md §2
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

/** DECTCEM 序列的 ESC 前缀（正则里写不了控制字符，故单独比对前一字节）。 */
const ESC = String.fromCharCode(0x1b);

/**
 * 匹配 `[?25l|h`（DECTCEM 序列去掉 ESC 前缀）。
 *
 * 正则里刻意不含 ESC：裸控制字符触发 `noControlCharactersInRegex`，写成 \u001B
 * 转义同样被判成控制字符，而 `new RegExp` 又触发 `useRegexLiterals`。改为匹配
 * CSI 主体、再单独校验前一字节是 ESC，精度不变。
 *
 * 用函数而非常量：`/g` 正则带可变 `lastIndex`，每次调用新建实例避免串状态。
 */
function cursorModePattern() {
  return /\[\?25([lh])/g;
}

export function parseArgs(argv) {
  const options = { analyze: null, command: [], keep: false };
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === "--analyze") {
      options.analyze = argv[index + 1] ?? null;
      index += 2;
      continue;
    }
    if (arg === "--keep") {
      options.keep = true;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      index += 1;
      continue;
    }
    if (arg === "--") {
      options.command = argv.slice(index + 1);
      break;
    }
    // 第一个非选项起，余下全部视为被测命令（含它自己的选项）。
    options.command = argv.slice(index);
    break;
  }
  return options;
}

function printUsage() {
  process.stdout.write(
    [
      "用法：",
      "  pnpm probe:cursor-semantics [--keep] -- <agent 命令> [agent 参数…]",
      "  pnpm probe:cursor-semantics --analyze <已有的 script 记录文件>",
      "",
      "选项：",
      "  --keep      保留原始记录文件（默认删除）",
      "  --analyze   跳过录制，直接分析已有记录",
      "",
      "在真实终端里运行；agent 起来后手动在聚焦态与浏览态之间切换数次再退出。",
      "",
    ].join("\n")
  );
}

/**
 * 抽取 `?25` 翻转序列。
 * 只保留「与上一状态不同」的读数：TUI 每帧重发同一模式位很常见，全留会淹没信号。
 */
export function extractCursorTimeline(raw) {
  const transitions = [];
  const pattern = cursorModePattern();
  let last = null;
  let match = pattern.exec(raw);
  while (match !== null) {
    // 正则不含 ESC，这里补校验前一字节，避免把正文里的 "[?25h" 当序列。
    if (raw[match.index - 1] === ESC) {
      const state = match[1] === "h" ? "visible" : "hidden";
      if (state !== last) {
        transitions.push({ atByte: match.index - 1, state });
        last = state;
      }
    }
    match = pattern.exec(raw);
  }
  return { final: last, transitions };
}

export function verdictFor(timeline) {
  if (timeline.final === null) {
    return {
      candidate: false,
      reason:
        "记录里没有任何 ?25 序列：没有可与聚焦动作关联的光标信号，不能声明探针。",
    };
  }
  if (timeline.transitions.length < 3) {
    return {
      candidate: false,
      reason:
        "光标状态翻转不足：无法区分聚焦态与浏览态。请确认切换步骤已执行后重测。",
    };
  }
  return {
    candidate: true,
    reason:
      "记录包含多次 ?25 翻转，可进入人工核对；只有翻转与输入框聚焦/失焦动作一一对应，才能声明探针。末态本身不作为证据。",
  };
}

function report(raw) {
  const timeline = extractCursorTimeline(raw);
  const lines = ["", "── ?25 翻转序列 ──"];
  if (timeline.transitions.length === 0) {
    lines.push("（无）");
  } else {
    for (const [index, item] of timeline.transitions.entries()) {
      const label =
        item.state === "visible" ? "visible (?25h)" : "hidden (?25l)";
      lines.push(
        `${String(index + 1).padStart(3)}. @${item.atByte}B  ${label}`
      );
    }
  }
  const verdict = verdictFor(timeline);
  lines.push(
    "",
    `末态：${timeline.final ?? "无"}`,
    `翻转次数：${Math.max(0, timeline.transitions.length - 1)}`,
    "",
    `结论：${verdict.candidate ? "可人工核对" : "证据不足，不能声明探针"}`,
    verdict.reason,
    ""
  );
  process.stdout.write(lines.join("\n"));
  return verdict.candidate;
}

/** BSD（macOS）与 util-linux 的 script 参数序不同。 */
function scriptArgsFor(logPath, command) {
  if (process.platform === "darwin") {
    return ["-q", logPath, ...command];
  }
  return ["-q", "-c", command.join(" "), logPath];
}

function record(command, keep) {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "需要真实终端：请直接在终端里运行本命令（当前 stdin 不是 tty）。\n"
    );
    process.exitCode = 2;
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "pier-cursor-probe-"));
  const logPath = join(dir, "session.log");
  process.stdout.write(
    [
      `录制中 → ${logPath}`,
      "请在 agent 里手动切换「输入框聚焦 ↔ 浏览态」数次，然后退出 agent。",
      "",
    ].join("\n")
  );

  const child = spawn("script", scriptArgsFor(logPath, command), {
    stdio: "inherit",
  });
  child.on("error", (err) => {
    process.stderr.write(`启动 script(1) 失败：${err.message}\n`);
    process.exitCode = 2;
  });
  child.on("exit", () => {
    let raw = "";
    try {
      raw = readFileSync(logPath, "latin1");
    } catch (err) {
      process.stderr.write(`读取记录失败：${String(err)}\n`);
      process.exitCode = 2;
      return;
    }
    report(raw);
    if (keep) {
      process.stdout.write(`原始记录保留在：${logPath}\n`);
      return;
    }
    rmSync(dir, { force: true, recursive: true });
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (options.analyze !== null) {
    report(readFileSync(options.analyze, "latin1"));
    return;
  }
  if (options.command.length === 0) {
    printUsage();
    process.exitCode = 2;
    return;
  }
  record(options.command, options.keep);
}

if (process.argv[1]?.endsWith("probe-agent-cursor-semantics.mjs")) {
  main();
}
