# Pier 文档

面向贡献者与维护者的文档入口。产品定位与仓库总览见根目录 [`README.md`](../README.md)。

## 快速导航

| 文档 | 受众 | 内容 |
| --- | --- | --- |
| [development.md](./development.md) | 贡献者 | 环境、worktree、检查、构建、架构要点 |
| [cli.md](./cli.md) | 贡献者 / 集成方 | `pier` CLI 与本机控制通道 |
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

`docs/superpowers/` 存放历史规格（`specs/`）与实施计划（`plans/`），按日期归档。它们是决策与实现过程的记录，**不是**现行 API 契约；以源码、`AGENTS.md` 与上表「现行文档」为准。

`docs/design/` 存放少量专题设计说明（例如工作台物料）。

## 文档约定

- 根 `README.md` 只保留产品前门：是什么、怎么跑起来、链到哪里
- 长流程（CLI、发布、插件）放在 `docs/`，避免 README 膨胀
- 用户可见产品文案走 locale，不把实现词写进前台文案（规则在 `AGENTS.md`）
- 改行为时同步更新相关文档与 `CHANGELOG.md` 的 `[Unreleased]`
