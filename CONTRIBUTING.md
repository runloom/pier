# 贡献指南

感谢你改进 Pier。本文面向人类贡献者；编码助手请同时遵守 [`AGENTS.md`](AGENTS.md)。

## 行为准则

请保持专业、具体、可复核的沟通。Issue / PR 中避免人身攻击、刷屏和泄露他人隐私。维护者有权关闭偏离主题或含恶意内容的讨论。

## 许可证与贡献权属

Pier 源码默认使用 `AGPL-3.0-only`。提交贡献即表示：

1. 你有权提交这些内容；
2. 你同意这些贡献按本仓库许可证发布。

### 商业再授权（贡献者授权）

Pier 同时提供 / 计划提供商业授权。为避免贡献权属阻塞再授权，**非平凡贡献在合并前需要完成贡献者授权流程**。

| 类型 | 示例 | 要求 |
| --- | --- | --- |
| 平凡贡献 | typo、注释、文档小修、测试夹具微调 | 可直接 PR |
| 非平凡贡献 | 新功能、行为变更、重要修复、较大文档、设计稿、图标、字体、图片 | 维护者确认授权流程后再合并 |

不要提交你无权再授权的第三方代码、字体、图片、图标或设计资源。代表公司贡献时，请确认公司允许你提交并授权这些内容。

细节见 [`docs/legal/licensing.md`](docs/legal/licensing.md)。

## 第三方素材

第三方素材必须带清晰来源与许可证。即使标注「免费商用」，也不一定允许再分发到开源仓库；提交前确认再分发与嵌入权限。

## 开发环境

完整步骤见 [`docs/development.md`](docs/development.md)。最短路径：

```bash
pnpm bootstrap   # macOS：预检 Xcode CLI / brew / zig@0.15 → install → native
pnpm dev
```

工具链摘要：

- Node.js 24 LTS + TypeScript strict
- pnpm 11（`--frozen-lockfile`）
- Biome 2.5 + Ultracite（lint + format；单一 fix 入口即 pre-commit）
- Electron 43 + Vite 8 + React 19 + Tailwind v4 + dockview-react
- Vitest + Playwright

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm check          # 静态检查 + unit / component / integration
```

提交前至少保证与改动相关的检查通过；大改动优先跑 `pnpm check`。

## 架构边界（必读）

进程与模块边界由 dependency-cruiser 守护：

- `main/` ⊥ `renderer/`（双向禁止）
- `preload/` 只可 import `shared/` + `electron`
- renderer 业务代码不可直接 import dockview 运行时 API，必经 `components/workspace/`
- 不同 panel-kit / 插件包不要跨域乱引；走 `components/common`、`stores` 或公开 API

完整规则、UI 文案、弹窗选型与操作反馈规范见 [`AGENTS.md`](AGENTS.md)。违反边界的 PR 会被要求先改结构再谈功能。

## 提交与 PR

### Commit

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```text
feat(terminal): add rich input attachments
fix(ci): stabilize git-review e2e tree nav
docs(readme): restructure project front door
```

- 说明 **为什么**，不要只罗列文件名
- 一个逻辑变更一个 commit 更易审；无关格式化请拆开

### Pull Request

1. 从最新 `main` 开分支
2. 保持 PR 聚焦：一个问题 / 一个能力
3. 描述里写清：动机、行为变化、如何验证
4. 关联 Issue（若有）
5. 用户可见文案走 i18n（中英 locale 同步），禁止业务代码内联中英文用户串
6. 不要 `git add .` 顺手带走无关文件；不要提交密钥、`electron-builder.env`、本机路径

维护者可能要求补测试、补治理单测（governance test）或拆 PR。

## 安全

疑似漏洞请按 [`SECURITY.md`](SECURITY.md) 私下报告，不要在公开 Issue / PR 中贴利用细节。

## 需要帮助？

- 文档索引：[`docs/README.md`](docs/README.md)
- 插件开发：[`docs/plugins.md`](docs/plugins.md)
- 发布（维护者）：[`docs/release.md`](docs/release.md)
- GitHub Issues：https://github.com/runloom/pier/issues
