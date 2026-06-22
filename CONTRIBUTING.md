# Contributing to Pier

## 工具链

- Node.js 22 LTS + TypeScript 6 strict
- pnpm 10（`--frozen-lockfile` 强制）
- Biome 2.5 + Ultracite（lint + format，单一 fix 入口 = pre-commit）
- Electron 42 + Vite 8 + React 19 + Tailwind v4 + dockview-react

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
