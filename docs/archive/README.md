# 文档归档

本目录存放**已落地或已被取代**的设计规格与实施计划，仅作决策过程参考。

## 不是什么

- **不是**现行 API 契约或产品说明书
- **不是**贡献者日常入口（请从 [`docs/README.md`](../README.md) 进入）

## 布局

| 路径 | 内容 |
| --- | --- |
| [`superpowers/`](./superpowers/) | 历史 `specs/` / `plans/` / `spikes/` / `evidence/`（自 `docs/superpowers/` 部分迁入） |
| [`design/`](./design/) | 已实现的专题设计（自 `docs/design/` 迁入） |

## 与活文档的边界

- **仍被源码、测试或 `AGENTS.md` 引用**的规格与计划留在 [`docs/superpowers/`](../superpowers/)
- **近期仍在演进**（例如当月）的文档暂不归档
- **`docs/design/`** 只保留仍当契约或未完成实施的专题

新增归档时：优先 `git mv` 保持历史，并修正指向活文档的相对链接；不要删除原文件。

以源码、`AGENTS.md` 与 [`docs/README.md`](../README.md) 现行文档为准。
