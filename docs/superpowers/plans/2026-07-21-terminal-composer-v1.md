# Agent Composer V1：原生输入能力对等

## 闭环标准

Composer 挂载并持有焦点时，用户无需点击原生终端表面，就能完成智能体会话中的键盘输入、文本编辑和图片输入。

## 输入规则

- 空草稿且无附件时，Composer 是透明键盘桥。普通字符、数字、标点、方向键、Tab、Enter，以及 Ctrl/Alt/Shift 组合均通过 `terminal.sendKeyPress` 注入。
- Meta 组合保留给 macOS 和应用菜单；IME composing 事件保留给网页输入法。
- 非空草稿是本地编辑态。Enter 发送，Shift+Enter 换行，Ctrl+C 仍透传；第一次 Esc 清空草稿，草稿为空后 Esc 透传。
- 空草稿的方向键始终透传。只有编辑非空草稿时，↑/↓ 才浏览当前 panel 最近 50 条发送历史。
- 搜索栏等浮层关闭后，agent Composer 重新取得键盘焦点。

## 图片输入

- 从剪贴板粘贴图片时，renderer 将图片字节交给 main，写入系统临时目录下的 `pier-terminal-pastes`，然后显示附件。
- 附件按钮可选择多张本地图片；拖放图片使用相同的临时文件路径。
- 发送时先写入每个附件路径，再写入正文，最后注入真实 Return。Pier 不引入额外的多模态协议。

## 快捷入口

- “模式”发送 Shift+Tab。
- “模型”发送并提交 `/model`。
- 这些入口只提高可发现性；完整能力由键盘对等保证，Pier 不维护智能体内部的当前模型状态。

## Shell 挂载

设置中的“Shell 输入框”默认关闭。开启后，shell/idle 状态可显示 Composer，但不强制接管原生终端焦点；用户点击 Composer 后可使用同一输入内核。

## 验收矩阵

| 能力 | Claude | Codex | Cursor / Grok | 空草稿 | 非空草稿 |
| --- | --- | --- | --- | --- | --- |
| `y` / `n` / 菜单数字 | 原生按键 | 原生按键 | 原生按键 | 透传 | 本地编辑 |
| Ctrl+O 等 Ctrl 组合 | 透传 | 透传 | 透传 | 透传 | Ctrl+C 透传，其余编辑 |
| Alt+P 等 Alt 组合 | 透传 | 透传 | 透传 | 透传 | 本地编辑 |
| Shift+Tab | 模式切换 | TUI 行为 | TUI 行为 | 透传 | 本地编辑 |
| `/model` | agent 命令 | agent 命令 | agent 命令 | 可输入或使用快捷入口 | 可编辑后发送 |
| 文本粘贴 | 网页草稿 | 网页草稿 | 网页草稿 | 进入编辑态 | 插入光标处 |
| 图片粘贴/选择/拖放 | 临时路径 | 临时路径 | 临时路径 | 附件 | 附件 |
| Esc | 透传 | 透传 | 透传 | 透传 | 先清空草稿 |
| Ctrl+C | 透传 | 透传 | 透传 | 透传 | 透传 |

## 自动化覆盖

- passthrough 单测锁定普通字符、Ctrl+O、Alt+P、Shift+Tab 和 Meta 保留行为。
- Composer 组件测试锁定文本发送、真实按键路径、附件路径、模式/模型入口和发送历史。
- main 单测锁定剪贴板图片物化与文件选择返回契约。
- macOS E2E 抽测真实 `sendText` / `sendKeyPress` IPC 到 native surface。
