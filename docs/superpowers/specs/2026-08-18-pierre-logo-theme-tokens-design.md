# Pierre Logo 品牌主题 Token 与设计源清理

## 状态

- 日期：2026-08-18
- 状态：已确认，待实施
- 范围：`Pierre` / `Pierre Soft` 两套样式预设的 light/dark 主题，以及 `build/design-sources`。

## 目标

1. 让 `Pierre` 与 `Pierre Soft` 的全部品牌相关主题 token 使用 Pier Logo 的紫色体系，不再保留上游默认蓝色。
2. 在主题输入层完成统一映射，使 UI、编辑器装饰、终端 ANSI 蓝、图表主色与依赖主题 token 的表面共享同一来源。
3. 保持两套主题原有的明暗背景、前景、中性色与 Soft 表面差异。
4. 删除已淘汰的 A/B/C 图标候选稿，将设计源预览页重建为最终 F / I 方案。

## 非目标

- 不修改 `catppuccin`、`github`、`gruvbox` 等第三方样式预设。
- 不修改 `node_modules/@pierre/theme`，避免依赖升级覆盖本地品牌规则。
- 不改变产品 `success`、`warning`、`destructive` 等稳定语义色。
- 不重新设计已经确认的 F 标准稿、I Micro 稿或透明 F 母版。
- 不更改主题名称、用户偏好 ID 或主题切换流程。

## 当前问题

`Pierre` 与 `Pierre Soft` 直接消费 `@pierre/theme`。上游主题把蓝色分散在下列 token：

- focus、selection、editor cursor、list focus
- activity badge、tab active、panel title active
- button、button hover、text link、notification link
- Git modified decoration
- terminal ANSI blue / bright blue

目前 UI `primary` 只从其中部分 token 派生。若仅在派生层覆写 `primary`，终端、编辑器与其余主题表面仍会保留蓝色，形成两套强调色。因此修复必须发生在预设注册之前的主题输入层。

## 品牌色单一来源

品牌主题色只在 `src/renderer/lib/theme/` 内拥有，允许使用具体色值：

| Token | 色值 | 角色 |
| --- | --- | --- |
| `pierBrandHighlight` | `#b66cff` | 焦点、光标、bright blue 等高亮状态 |
| `pierBrandPrimary` | `#8549ff` | 按钮、选中线、徽标、链接、图表主序列、ANSI blue |
| `pierBrandDeep` | `#542ee5` | 填充按钮 hover / pressed 等加深状态 |

`#8549ff` 与白色对比度约 4.78:1，与 Pierre Dark 背景 `#0a0a0a` 对比度约 4.14:1，可直接承担主填充色。高亮色只用于细线、光标或深色前景上的高亮，不作为白字按钮底色。

## 架构

新增一个纯函数品牌 overlay，例如：

```ts
applyPierBrandOverlay(theme, { mode }) -> clonedTheme
```

要求：

- 不修改导入的上游主题对象。
- 保留主题 `name`、`type` 和未覆盖的 `colors` / `tokenColors` / `semanticTokenColors`；只克隆并替换下文列出的品牌项。
- 只在 `STYLE_PRESET_REGISTRY` 注册 `pierre` / `pierre-soft` 时应用。
- light/dark 与 standard/soft 共用同一品牌三色；Soft 的差异继续由其背景、前景和中性色表达，不再用另一套蓝色表达。

数据流：

```text
@pierre/theme 原始预设
  -> Pier brand token overlay
  -> STYLE_PRESET_REGISTRY
  -> deriveAppStyleTokens / deriveTerminalColors / Shiki / Pierre Diffs
  -> DOM、终端、编辑器与图表
```

## Token 映射

### 主色 `#8549ff`

- `activityBar.activeBorder`
- `activityBarBadge.background`
- `tab.activeBorderTop`
- `panelTitle.activeBorder`
- `button.background`
- `terminal.ansiBlue`
- `charts.blue`（原主题缺失时补入）

### 高亮 `#b66cff`

- `focusBorder`
- `editorCursor.foreground`
- `list.focusOutline`
- `terminal.ansiBrightBlue`

### 深色 `#542ee5`

- `button.hoverBackground`

### 派生透明色

- `editor.selectionBackground`：dark 使用主色 30% alpha，light 使用主色 18% alpha。
- `selection.background`、`list.activeSelectionBackground`、`list.inactiveSelectionBackground`：从主色与当前主题背景混合，不引入独立蓝色色值；active 强于 inactive。
- `button.foreground` 与 `activityBarBadge.foreground`：使用白色，确保落在主色填充上的正文与图标达到 4.5:1。

### 模式相关的文本强调色

下列 token 承载小号文本或代码字形，必须优先满足正文对比度：dark 使用高亮色 `#b66cff`，light 使用主色 `#8549ff`。

- `textLink.foreground`
- `textLink.activeForeground`
- `notificationLink.foreground`
- `gitDecoration.modifiedResourceForeground`

### 代码主题中的品牌强调项

上游 Pierre Dark、Pierre Light 与 Pierre Light Soft 还把同一蓝色用于 decorator 语法强调。overlay 必须同步克隆并替换：

- `tokenColors` 中 `meta.decorator`、`entity.name.function.decorator`、`punctuation.definition.decorator` 的 `foreground`：dark 使用高亮色，light 使用主色。
- `semanticTokenColors.decorator`：dark 使用高亮色，light 使用主色。

不能对所有语法蓝色做全文替换；只替换这些与上游品牌强调色同源的 decorator 项，避免改变普通变量、类型或关键字的语义配色。

其余 ANSI 色、Git added/deleted/conflict 色和产品状态色保持不变。

## 设计源清理

保留：

- `build/design-sources/pier-logo.svg`：当前透明 F 品牌母版。
- `build/design-sources/index.html`：重建为当前设计预览页。

删除：

- `build/design-sources/pier-pier.svg`
- `build/design-sources/pier-panels.svg`
- `build/design-sources/pier-berth.svg`
- `build/design-sources/pier-berth-macos.svg`

新的 `index.html` 只展示：

1. F 标准 macOS 稿。
2. I Micro macOS 稿。
3. 透明 F 母版。
4. 16–128px 使用 I、256–1024px 使用 F 的尺寸分配。
5. Logo 三色品牌 token 与 `Pierre` / `Pierre Soft` 的 light/dark 表面示例。

页面引用 `../app-icon-master.svg`、`../app-icon-micro.svg` 和 `pier-logo.svg`，不得内嵌另一套图标几何，不得保留“候选”“推荐 A/B/C”等历史文案。

## 测试与验收

### 自动化

1. 品牌 overlay 单测锁定所有目标 `colors`、decorator `tokenColors` 与 `semanticTokenColors`，覆盖 Pierre、Pierre Soft 的 light/dark 四种组合。
2. 验证 overlay 不修改输入对象，并保留未覆盖 token。
3. 验证所有非 Pierre 预设保持原对象与原 token。
4. 验证两套 Pierre 主题的最终 `primary` 为 Logo 紫色色相，并满足背景与前景对比度门槛。
5. 验证终端 `ansiBlue` / `ansiBrightBlue` 与图表第一序列来自品牌 token。
6. 设计源治理测试确认四份旧候选稿不存在，预览页只引用当前 F / I /透明 F。
7. 运行主题专项测试、设计源测试、`pnpm check:static`。

### 视觉

- `Pierre` 与 `Pierre Soft` 的选中线、按钮、链接、开关、徽标和焦点细线呈同一 Logo 紫色语言。
- Soft 仍比 Pierre 更柔和，但差异来自中性表面，而不是另一套品牌色。
- 终端蓝色槽位、编辑器光标与 modified 装饰同步为紫色，不出现蓝紫混用。
- light/dark 下文字、按钮和焦点状态可辨识，不以降低对比度换取品牌一致。
- 新设计源页面不再显示旧 A/B/C 方向。

## 风险与约束

- ANSI blue 变为紫色是本次明确选择；它改变视觉色相，但仍保留 ANSI 槽位语义。
- Git modified 装饰随主题变紫，但产品级成功/警告/错误色不受影响。
- 上游 `@pierre/theme` 新增 token 时不会自动被覆盖；测试锁定当前目标集合，依赖升级时需要复核蓝色残留扫描。
- 禁止把品牌 overlay 扩展为所有第三方预设的全局强制品牌色。

## 完成标准

- 两套 Pierre 主题的 `colors`、decorator `tokenColors` 与 `semanticTokenColors` 中不存在旧品牌蓝色残留。
- 所有映射从一份 Logo 品牌 palette 派生。
- 旧图标候选稿已删除，预览页与正式图标链路一致。
- 相关测试、静态检查和视觉复核全部通过。
