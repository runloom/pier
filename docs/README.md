# Pier 文档

Pier 是给命令行 AI 用的桌面工作台。根目录 [`README.md`](../README.md) 是产品前门，先讲谁在等你，以及文件、编辑、Git 在同一个窗口；本页按用户、贡献者和维护者的常见任务整理深入资料。

## 使用 Pier

| 文档 | 适合谁 | 你会找到什么 |
| --- | --- | --- |
| [项目 README](../README.md) | 初次了解 Pier 的用户 | 给谁用、谁在等你、Git、Canvas 编排、能力边界、安装与首次使用 |
| [GitHub Releases](https://github.com/runloom/pier/releases) | 安装桌面端的用户 | 适用于 macOS 的当前安装包与版本说明 |
| [CLI 用户手册](../.pier/canvases/pier-cli-user-manual/README.md) | 需要从命令行控制 Pier 的用户与工具调用方 | 控制正在本机运行的 Pier；包含上手步骤、常用命令和状态语义 |
| [变更日志](../CHANGELOG.md) | 所有人 | 版本变化与尚未发布的更新 |

## 参与开发

| 文档 | 适合谁 | 你会找到什么 |
| --- | --- | --- |
| [开发指南](./development.md) | 贡献者 | 环境、Git 工作树、检查、构建与架构要点 |
| [贡献指南](../CONTRIBUTING.md) | 贡献者 | Issue、Pull Request、授权流程与工具链要求 |
| [官方插件](./plugins.md) | 插件开发者 | 支持范围、开发、打包、校验与信任模型 |
| [安全政策](../SECURITY.md) | 所有人 | 私下报告安全问题的方式 |
| [授权说明](./legal/licensing.md) | 所有人 | AGPLv3、商业授权与品牌边界 |

## 维护与发布

| 文档 | 你会找到什么 |
| --- | --- |
| [发布总览](./release.md) | 宿主与官方插件的双通道发布流程 |
| [桌面端发布](./app-release.md) | CI、secrets 与本地 `build:dist` |
| [模型定价](./model-pricing.md) | 模型定价目录与更新流程 |
| [Claude 账号插件](./claude-account-plugin.md) | `pier.claude` 账号能力的维护说明 |

## 设计与实现笔记

| 路径 | 用途 |
| --- | --- |
| [`design/`](./design/) | 仍生效的专题契约，例如 [LSP 语言矩阵](./design/lsp-language-matrix.md) 与 [LSP 会话策略](./design/workspace-lsp-policy.md) |
| [`superpowers/`](./superpowers/) | 仍在引用或持续更新的规格与计划；不等同于完整的现行 API 文档 |
| [`archive/`](./archive/) | 已落地、已被取代的历史规格、计划、探索与专题设计 |
| [`AGENTS.md`](../AGENTS.md) | 编码助手使用的架构与界面治理硬约束；不是用户手册 |

归档与现行文档的边界见 [`archive/README.md`](./archive/README.md)。设计与实现笔记不保证完整描述当前行为；如有差异，以源码、`AGENTS.md` 和上方现行文档为准。

## 文档约定

- 根 `README.md` 是产品前门，聚焦它是什么、如何开始和去哪里深入了解
- 长流程放在 `docs/` 或相应 Canvas 手册中，避免在多个入口重复维护
- 用户可见文案使用统一产品词，并尽量说明下一步动作
- 行为变化时同步更新相关文档与 `CHANGELOG.md` 的 `[Unreleased]`
- 已交付且无外部引用的过程文档迁入 `docs/archive/`，不要堆在 `superpowers/` 或 `design/` 前台
