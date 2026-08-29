# 项目记忆：引导随工具走

日期：2026-08-28  
状态：已确认  
范围：启动器在 MCP `initialize` 应答里注入 `instructions`；引导正文与 `AGENTS.md` 托管段字节相等。  
相关：

- [2026-08-27 项目记忆 v3](./2026-08-27-project-memory-global-registration-v3-design.md)（交付面；本文兑现其「经引擎包装注入 instructions」候选）
- [2026-08-26 项目记忆插件](./2026-08-26-project-memory-plugin-design.md)（引导段文案）

## 一句话终态

默认启用的项目不写仓库，智能体仍能在拉起 `pier-memory` 时读到同一段用法引导。引导走 MCP `initialize.result.instructions`，不走第二套记忆引擎，不接 OpenHuman / Obsidian。

## 动机

v3 为「仓库内零写入」放弃了默认写 `AGENTS.md`。智能体因此只有工具、没有用法，记忆质量偏机会型。MCP 握手的 `instructions` 字段就是给客户端的用法提示（协议写 MAY，可进 system prompt）。启动器已经是「引擎零自研」的唯一豁免面，在这里注入比弄脏仓库或自研记忆树都更贴产品哲学。

## 目标与非目标

### 目标

1. 只要启动器决定启用引擎，`initialize` 成功应答必带与 `AGENTS.md` 托管段相同的引导正文。
2. 显式打开开关仍写 `AGENTS.md`（给人看 diff；给不吃 `instructions` 的客户端兜底）。默认启用仍零写入仓库。
3. 关闭 / 解析失败的空工具应答不带 `instructions`。
4. 握手改写一次后切回原始管道；stdin 不解析；不拦截 `tools/call`。

### 非目标

- 换引擎、记忆树、评分、embedding、TinyCortex
- Obsidian 深链 / vault / Markdown 双向同步
- 常驻代理改 `tools/list` 或按 `entityType` 拒写
- bump `MEMORY_LAUNCHER_GENERATION`（仍是单文件，内容指纹会替换）

## 行为

启用路径：`stdio: ["pipe","pipe","inherit"]`。stdin 原样 pipe 进引擎。stdout 在看到 `initialize` 成功应答（`jsonrpc=2.0` 且 `result` 含 `protocolVersion` + `serverInfo` + `capabilities`）后写入 `instructions`。splice 使用 `pipe({ end: false })`，引擎 stdout EOF 不提前 `end()` 客户端通道。管道 EPIPE 不当成启动失败，跟随子进程退出。

- 引擎没有该字段 → 写入本引导
- 引擎已有非空字符串 → 原文 + `\n\n` + 本引导
- 原文已含本引导 → 不动
- 不改 `serverInfo` / `protocolVersion` / capabilities

帧格式：

- 钉死引擎 `@2026.7.4`（MCP SDK 1.29）stdout 是 NDJSON：`JSON.stringify(message) + "\n"`。握手改写按此为生产路径。
- `Content-Length: N\r\n\r\n{json}` 只作兼容：改写后重算长度
- 首包明显不是 MCP 帧（不以 `Content-Length` / `{` 开头）→ 整段原样转发（假引擎回显路径、挂起测试保持绿）
- 缓冲超过 1MB 仍拼不出帧 → 原样冲刷

改写成功或判定非 MCP 后 splice，之后不再解析。信号转发、退出码跟随、摘监听器再 re-raise 的无僵尸约束不变。

## 正文单一来源

真源：`resources/memory-launcher/memory-mcp.mjs` 的 `MEMORY_INSTRUCTIONS`。  
宿主 `guidance.ts` 的 `GUIDANCE_BODY` 必须字节相等（不 import 启动器，避免把 `spawn` 打进 main）。契约测试锁死。

## 检查点

`tests/unit/main/agent-managed-assets/launcher-contract.test.ts`：正文相等、改写函数、NDJSON 进程级注入（生产帧）+ 第二行透传、Content-Length 兼容路径、裸字节、分块帧、改写后 splice、stub 无 `instructions`、splice 前/后 SIGTERM 无僵尸。  
`tests/unit/plugins/pier-memory-governance.test.ts`：锁本设计标题与「默认启用不写 AGENTS.md、引导走 instructions」。
