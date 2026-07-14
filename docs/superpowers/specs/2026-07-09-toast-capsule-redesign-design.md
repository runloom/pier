# Toast 胶囊化重设计

**日期**：2026-07-09  
**状态**：已实现（实现中保留 toast `action`，如文件移动撤销；仅移除 `description`）  
**范围**：宿主 Sonner toast 视觉与内容策略；带详情失败改走 `showAppAlert`；插件 notification API 对齐  
**非目标**：不换 toast 库；不做 OS 系统通知改版；不做 toast 内 action / Undo / description

**参考 UI**：用户提供的胶囊 toast（深色表面 + 彩色实心状态图标 + 单行白字）

## 1. 背景与问题

当前 toast 是 shadcn Sonner 薄封装（`src/renderer/components/primitives/sonner.tsx`）：

- 只映射了 `--popover` / `--border` / `--radius`，未接入 Pier elevation、status token、圆角体系
- Sonner 默认样式（系统字体、硬编码 description 色、`8px` 圆角、浅阴影）与其它浮层（`rounded-2xl`、`shadow-lg`、`ring-1 ring-foreground/5`）脱节
- 大量失败路径把 `err.message` 塞进 `description`，胶囊化后无法承载长文

产品决定：短反馈走精致胶囊 toast；长错误详情直接弹 `showAppAlert`。

## 2. 目标与非目标

### 目标

- Toast 视觉对齐参考图：top-center 胶囊、彩色实心状态图标、单行 title
- **反差色表面**（亮主题深底 / 暗主题浅底），相对 app chrome 高对比
- Toast **只承载短 title**；带技术详情的失败改为 `showAppAlert({ title, body })`
- 插件 `notifications.`* 与宿主策略一致（忽略 / 移除 description、action）
- 保持 Sonner 作为引擎（堆叠、划走、promise/loading）

### 非目标

- 不引入新 toast 库或自研队列
- Toast 内不放 description、action 按钮、关闭叉
- 不改 OS `notifications.system` 通道
- 不做「点 toast 再打开 alert」的两步流

## 3. 已确认产品决定


| 项           | 决定                                 |
| ----------- | ---------------------------------- |
| 视觉方向        | 参考图胶囊 + 色块图标                       |
| 位置          | `top-center`                       |
| 主题          | **反差色**：亮主题深底浅字，暗主题浅底深字；图标色两边共用    |
| 长错误         | **直接** `showAppAlert`，不先 toast 再点开 |
| description | Toast 不再使用                         |


## 4. 视觉规格

### 4.1 容器

- 形状：`rounded-full` 胶囊
- 高度：约 40–44px（单行）
- 宽度：`w-fit`，上限 `min(420px, calc(100vw - 32px))`
- 内边距：水平约 14–16px，图标与文字间距约 10–12px
- 表面（反差色，相对 app chrome 高对比）：
  - Light：深灰近黑 `--toast-surface` + 浅色字
  - Dark：近白浅灰 `--toast-surface` + 深色字
- 边框/阴影：细 ring + 深投影，保证浅色底上也不「贴死」
- 布局：横向 `nowrap` 胶囊；toaster `--width` 必须给足横向空间，禁止 `auto`（否则 CJK 会被 `overflow-wrap: anywhere` 拆成竖排）
- 字体：继承应用 UI 字体，不用 Sonner 默认 system stack 硬编码

### 4.2 状态图标


| 类型      | 形状   | 填充色             | glyph                  |
| ------- | ---- | --------------- | ---------------------- |
| success | 圆    | `--success`     | 深色 check               |
| error   | 圆    | `--destructive` | 深色 `!`                 |
| warning | 圆角三角 | `--warning`     | 深色 `!`                 |
| info    | 圆    | `--info`        | 深色 `i`                 |
| loading | —    | 中性              | `Loader2` spin（无色块底亦可） |


图标尺寸约 18–20px；glyph 用近黑以保证在亮色填充上的对比度（亮暗主题同一套图标）。

### 4.3 位置与动效

- `position="top-center"`
- offset：避开 titlebar / 拖拽区（`top` 至少 `var(--app-titlebar-height) + 12px` 量级）
- 进入：自上滑入 + fade
- 多条：垂直堆叠展开，避免默认「叠卡片只露边」的 dense stack（可用 Sonner `expand` / gap 配置贴近参考图）
- 消失：超时自动；支持向下/向外划走；无关闭按钮

### 4.4 时长（建议默认）

- success / info：~2.5–3s
- warning：~4s
- error（仅短 title toast）：~4–5s
- loading：直到 dismiss / 被 success·error 替换

## 5. 内容策略

### 5.1 Toast 只放短 title

允许：

```ts
toast.success(t("..."));
toast.info(t("..."));
toast.warning(t("..."));
toast.error(t("...")); // 仅短句，无 description
toast.loading(t("..."));
toast.promise(p, { loading, success, error }); // error 字符串也须短
```

禁止：

```ts
toast.error(title, { description: err.message });
toast.success(title, { description, action });
```

### 5.2 带详情失败 → `showAppAlert`

规则：

> 失败且需要展示技术详情（`Error.message`、IPC 错误串、多行说明）时，**直接**调用 `showAppAlert`，不再发 toast。

```ts
await showAppAlert({
  title: t("settings.environment.saveFailed"),
  body: err instanceof Error ? err.message : String(err),
  // size 默认即可（长错误不宜 sm）
});
```

短失败（用户能从 title 理解、无额外详情）仍用 `toast.error(title)`。

### 5.3 `toast.promise` 错误路径

`managed-plugin-rows` 等处当前把 `失败文案 — ${msg}` 拼进 promise error 字符串。改为：

- promise `error` 只返回短失败 title；或
- 不用 `toast.promise` 的 error 文案承载详情，在 `catch` / `rejectFailed…` 后对失败结果调 `showAppAlert`

实现计划阶段选一种，原则是：**toast 可见字符串始终短**。

## 6. API 与调用点迁移

### 6.1 宿主 Toaster

改 `src/renderer/components/primitives/sonner.tsx`：

- `position="top-center"`
- 自定义 `icons`（色块 + glyph，可用小 span/SVG，不必死磕 lucide 线框）
- `toastOptions.classNames` 接到胶囊样式（`cn-toast` 或等价）
- CSS 变量映射 Pier token；覆盖 Sonner 默认 padding / radius / shadow / description 色
- 可选：`richColors={false}`（状态靠图标，不靠整卡 tint）

### 6.2 宿主调用点（去掉 description）

至少包括：


| 文件                                 | 现状                                      | 目标              |
| ---------------------------------- | --------------------------------------- | --------------- |
| `environment-section.tsx`          | error + description                     | `showAppAlert`  |
| `app-update-section.tsx`           | error + description                     | `showAppAlert`  |
| `managed-plugins-section.tsx`      | checkUpdatesFailed + description        | `showAppAlert`  |
| `plugin-configuration-section.tsx` | error + description                     | `showAppAlert`  |
| `terminal-status-bar-block.tsx`    | updateFailed + description              | `showAppAlert`  |
| `terminal-status-bar-menu.ts`      | updateFailed + description              | `showAppAlert`  |
| `task-status-item.tsx`             | unsupported / startFailed + description | `showAppAlert`  |
| `managed-plugin-rows.tsx`          | promise error 拼长串                       | 短 toast 或 alert |


仅短 title 的调用（如 `keybindings-section`、`new-agent-action`、workbench arrange success）保留 toast，改皮即可。

### 6.3 插件 notification API

`RendererPluginNotificationOptions` 原先可带 `description` / `action`。

本规格落地：

- **移除**公开 options 的 `description`；长说明改走 `context.dialogs.alert`
- **保留** `action`（files 插件移动撤销等短操作依赖）
- 宿主 `toastNotificationOptions` 只转发 `action`
- `external-plugin-context` / `host-context` 注释同步：「短结果播报 + 可选 action；长说明走 dialogs」

## 7. 测试与治理

- 更新依赖 toast `description` 的单测 / 组件测断言（environment、managed-plugins、terminal-status-bar、plugin-host-context 等）
- 新增或扩展：Toaster 配置（position top-center、无 description class 路径）的轻量单测（若现有治理测风格允许）
- 操作反馈规范（AGENTS.md）补充一句：短反馈 toast；带详情失败用 `showAppAlert`，禁止 `toast.*({ description })`

## 8. 验收标准

1. 亮 / 暗主题下 toast 均为胶囊 + 色块图标；亮主题深底、暗主题浅底，相对 chrome 高对比，不出现竖排文字或「浅色主题下白条贴白底」
2. Toast 出现在窗口顶部居中，横向单行排版（CJK 不拆字竖排）
3. 全仓库宿主代码无 `toast.*(…, { description })`
4. 带 `err.message` 的失败路径弹出 `AppDialogHost` alert，用户能读完整详情
5. success / error / warning / info / loading / promise 短路径视觉一致
6. `pnpm check` 相关单测与类型通过

## 9. 实现顺序（供后续 plan）

1. Toaster 视觉（position、胶囊 class、图标、token）
2. 迁移宿主 `description` 调用点 → `showAppAlert`
3. 收紧插件 notification options + host-context
4. 更新测试与 AGENTS.md 操作反馈一句
5. 手动亮暗主题目视验收

