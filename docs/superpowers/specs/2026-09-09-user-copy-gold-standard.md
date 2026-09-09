# 用户可见文案规范 — 金标准

日期：2026-09-09
状态：已确认。本文是用户可见文案的唯一权威细则；AGENTS.md「用户可见文案规范」只保留不变量与指针。正文 2026-09-09 自 AGENTS.md 迁入，规则文字不变。

面向用户的 toast、空态、错误、状态栏、确认弹窗和设置说明必须让非实现者读得懂，并尽量给出下一步动作。文案进 locale（宿主 `src/renderer/i18n/locales/**`，插件 `src/plugins/builtin/*/locales/**`），禁止在业务代码里内联中文/英文用户串。

写作规则：

- **说用户动作，不说内部概念。** 反例：「没有可打开的终端选区」；正例：「请先在终端中选中文本。」
- **失败与空态要带下一步。** 反例：「无项目上下文」；正例：「未打开项目」+「请先打开项目文件夹以浏览文件。」
- **产品词全产品统一。** 当前约定：智能体（不要混用 Agent/agent）、工作树（中文界面不要写 worktree）、Canvas 发现面「物料」（仓库 `.pier/canvases/canvas-kit`，后续官网文档；不要做进设置）、需要你处理（中文不要直出 Needs you）、git 产品名用全大写 GIT（插件名、设置页标题、命令面板分组头、命令前缀与终端状态栏芯片标签）；正文与说明仍用小写 git，不要写成 Git；GitHub 等专有名除外。界面语言与根 README 的语言集合均为 `SUPPORTED_LOCALES`（`zh-CN` / `en` / `ja` / `ko`）。
- **根 README 与产品语言集合一致。** `README.md` 为简体中文真源；并列 `README.en.md` / `README.ja.md` / `README.ko.md`。语言标签只用上述四项，不要 `zh` / `zh_CN` / `jp` / `kr`。改中文前门必须同步三份译文。检查点在 `tests/unit/docs/readme-locale-governance.test.ts`。
- **CLI GitHub 手册同样四语。** `.pier/canvases/pier-cli-user-manual/README.md` 为简体中文真源；并列同目录 `README.en.md` / `README.ja.md` / `README.ko.md`。命令语义仍以同目录 `data.json` 为真源，不要把 `data.json` 复制成四份。应用内 Canvas 暂不按语言分文件。检查点同上。
- **实现词禁止进入前台主路径文案。** 包括但不限于：选区、上下文、面板参数、耐久性、绑定、运行标识、运行态、renderer、清单预览、hook（首次可写「钩子（hook）」）、tip tree、upstream（应写「上游分支」）。
- **中文界面少夹英文状态码。** git 状态用「分离头指针 / 合并中 / 变基中」等，不要用 DETACHED / MERGING 全大写码。
- **fallback 英文与 en locale 同步可读**；改中文时必须核对英文是否同样术语化。

严格度分层：

- Toast / 空态 / 确认弹窗标题：最严，禁实现词，优先给动作。
- 状态栏短标签：严，统一产品词。
- 设置说明：中，可保留 git 等领域词，仍要白话。
- 插件权限列表、开发模式提示：可偏技术，但不得污染前台主路径。
- 路径占位与代码标识符（如 `{项目名}.worktree`、命令 id）不受禁词约束。

**代码审查检查点**：

- 新增用户文案能否回答「用户看懂吗 / 下一步做什么 / 和现有产品词一致吗」。
- 中文界面出现 Agent、worktree、选区、上下文、耐久性、Needs you、DETACHED、Title Case Git 等 → finding。
- 业务代码 `toast.*("…")` / `showAppAlert({ title: "…" })` 内联用户串未走 i18n → finding。

检查点在 `tests/unit/renderer/app/user-copy-governance.test.ts`：锁定 AGENTS.md 本节存在，并扫描中英日韩 locale 字符串值中的禁用实现词。根 README 四语检查点在 `tests/unit/docs/readme-locale-governance.test.ts`。
