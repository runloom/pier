# Contributing to Pier

感谢你愿意改进 Pier。

## 许可证

Pier 源码默认使用 `AGPL-3.0-only`。提交贡献时，你确认自己有权提交这些内容，并同意这些贡献按本仓库许可证发布。

## 商业再授权

Pier 计划同时提供商业授权。为了避免贡献权属阻塞后续商业授权，非平凡贡献在合并前需要签署贡献者授权协议。当前规则是：

- typo、注释修正、文档小修、测试数据小修等平凡贡献可以直接通过普通拉取请求提交；
- 新功能、行为变更、重要修复、较大文档、设计稿、图标、字体、图片等非平凡贡献，需要在维护者确认贡献者授权流程后再合并；
- 不要提交你没有权利再授权的第三方代码、字体、图片、图标或设计资源。

如果你代表公司贡献，请确认公司允许你提交并授权这些内容。

## 第三方素材

第三方素材必须带清晰来源和许可证。字体、图标、图片、音频、视频等资产即使“免费商用”，也不一定允许再分发到开源仓库；提交前必须确认再分发和嵌入权限。

## 工具链

- Node.js 24 LTS + TypeScript 6 strict
- pnpm 11（`--frozen-lockfile` 强制）
- Biome 2.5 + Ultracite（lint + format，单一 fix 入口 = pre-commit）
- Electron 43 + Vite 8 + React 19 + Tailwind v4 + dockview-react

## 开发命令

```
pnpm install          # 安装依赖
pnpm dev              # 启动 Electron 桌面应用
pnpm typecheck        # tsc --noEmit
pnpm lint             # ultracite check (biome)
pnpm test             # vitest
pnpm test:e2e         # Playwright + Electron
pnpm check            # 一键检查 (typecheck + lint + depcruise + file-size)
pnpm build            # electron-vite build
```

## 架构边界

进程边界由 dependency-cruiser 守护（`dependency-cruiser.config.cjs`）：

- `main/` ⊥ `renderer/`（双向禁止）
- `preload/` 只可 import `shared/` + `electron`
- renderer 业务代码不可直接 import dockview，必经 `components/workspace/` 边界

完整规则见 `AGENTS.md`。
