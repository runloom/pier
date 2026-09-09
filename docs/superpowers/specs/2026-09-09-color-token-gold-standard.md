# 颜色使用规范 — 金标准

日期：2026-09-09
状态：已确认。本文是产品界面颜色治理的唯一权威细则；AGENTS.md「颜色使用规范」只保留不变量与指针。正文 2026-09-09 自 AGENTS.md 迁入，规则文字不变。

产品界面颜色按“主题原色 → 语义令牌 → 组件变体 → 业务映射”单向使用：

- `src/renderer/app/globals.css` 是产品 UI 调色板和语义令牌的唯一所有者。`info`、
  `success`、`warning`、`destructive`、`done` 不随编辑器或终端主题改变。
- `src/renderer/lib/theme/` 只负责中性外壳、主强调色、图表序列和终端 ANSI 色派生，
  不得重新派生产品状态色。
- `packages/ui` 组件只消费 `background`、`foreground`、`status-*`、`action-*` 等
  语义令牌；业务代码只选择语义，不持有具体颜色值。
- 普通动作使用 `action-accent`，破坏性动作使用 `action-danger`，结构性控件使用
  `action-muted`；不要用成功绿表达导航或普通按钮。
- 业务源码禁止新增十六进制、`rgb()`、`hsl()`、`oklch()` 和 Tailwind 固定色阶。
  允许的例外只有主题/终端颜色引擎、原生窗口启动兜底、第三方图表选择器和品牌图标。
- 检查点在 `tests/unit/renderer/app/color-token-governance.test.ts`，新增颜色例外必须同时说明
  所有权和无法使用现有语义令牌的原因。
- 对比度治理分层：Tier 1（严格 WCAG 4.5:1）覆盖正文、toast 容器、shimmer 文字，
  两个主题都强制；Tier 3（设计决策）覆盖暗色主题 badge 内 glyph 对比度——
  `:root` 使用亮色状态色 + 统一亮色 `--status-solid-foreground`，WCAG 亮度公式
  报告 1.6–2.7（低于 3:1），但 glyph 是简单形状、暗色 surround 提升感知亮度、
  色相对比提供额外辨识线索，由设计决策覆盖，测试只验证 token 存在。如设计
  变更需恢复严格检查，把 `:root` 加回 Tier 1 循环。
