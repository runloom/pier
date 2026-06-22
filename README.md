# Pier

**本地 AI 开发工作台。**

Pier 提供 dockview panel 布局、终端、代码变更预览、文件查看和多 agent 状态可见性，让 AI 编程从会话走向项目连续性。

## 技术栈

- Electron 42 · React 19 · TypeScript · pnpm
- dockview-react 6.6.1（panel 布局核心）
- Tailwind CSS v4 + shadcn primitives
- Biome 2.5 + Ultracite（lint + format）
- Vitest + Playwright（测试）

## 开发命令

```bash
pnpm install          # 安装依赖
pnpm dev              # 启动 Electron 桌面应用
pnpm check            # typecheck + lint + depcruise + file-size
pnpm test             # vitest
pnpm build            # electron-vite build
```

完整规则见 [`AGENTS.md`](AGENTS.md)。
