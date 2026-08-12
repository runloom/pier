# Pier 文档

面向贡献者与维护者的文档入口。产品定位与仓库总览见根目录 [`README.md`](../README.md)。

## 快速导航

| 文档 | 受众 | 内容 |
| --- | --- | --- |
| [development.md](./development.md) | 贡献者 | 环境、worktree、检查、构建、架构要点 |
| [CLI 用户手册（Canvas）](../.pier/canvases/pier-cli-user-manual/) | 用户 / 脚本 / MCP | Pier 本机命令行手册**唯一真源**（应用内 DocsShell；`data.json`） |
| [plugins.md](./plugins.md) | 插件开发者 | 官方插件范围、打包、校验、信任模型 |
| [release.md](./release.md) | 维护者 | 宿主与插件双通道发布总览 |
| [app-release.md](./app-release.md) | 维护者 | 宿主 CI、secrets、本地 `build:dist` |
| [model-pricing.md](./model-pricing.md) | 维护者 | 模型定价目录与更新流程 |
| [claude-account-plugin.md](./claude-account-plugin.md) | 插件维护者 | `pier.claude` 账号能力说明 |
| [legal/licensing.md](./legal/licensing.md) | 所有人 | AGPLv3 + 商业授权边界 |
| [../SECURITY.md](../SECURITY.md) | 所有人 | 漏洞报告 |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献者 | PR、CLA、工具链 |
| [../CHANGELOG.md](../CHANGELOG.md) | 所有人 | Keep a Changelog |
| [../AGENTS.md](../AGENTS.md) | 编码助手 | 架构与 UI 治理硬约束 |

## 设计与实现笔记

| 路径 | 角色 |
| --- | --- |
| [`design/`](./design/) | 仍生效的专题契约（例如工作台刷新策略、[LSP 语言矩阵](./design/lsp-language-matrix.md)、[LSP 会话策略](./design/workspace-lsp-policy.md)） |
| [`superpowers/`](./superpowers/) | **仍被引用或近期演进**的规格与计划；不是现行 API 全文 |
| [`archive/`](./archive/) | 已落地 / 已被取代的历史 specs、plans、spikes 与专题设计 |

归档与活文档的边界说明见 [`archive/README.md`](./archive/README.md)。**不是**现行 API 契约时，以源码、`AGENTS.md` 与上表「现行文档」为准。

## 文档约定

- 根 `README.md` 只保留产品前门：是什么、怎么跑起来、链到哪里
- 长流程（CLI、发布、插件）放在 `docs/`，避免 README 膨胀
- 用户可见产品文案走 locale，不把实现词写进前台文案（规则在 `AGENTS.md`）
- 改行为时同步更新相关文档与 `CHANGELOG.md` 的 `[Unreleased]`
- 已 ship 且无外部引用的过程文档迁入 `docs/archive/`，不要堆在 `superpowers/` 或 `design/` 前台
