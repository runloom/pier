# Pier 独有的 Ghostty patches

放在 `Patches/ghostty/` 下，`scripts/build-libghostty.sh` 在 apply 完
Lakr233 上游 patches 之后再 apply 这一批。编号从 `0100` 起，跟 Lakr233
的 `0001-0009` 保持距离，一眼看清归属。

## 现存 patches

| 编号 | 说明 |
|---|---|
| `0100-command-started-action.patch` | 加 `GHOSTTY_ACTION_COMMAND_STARTED` C 符号 + Zig `Action` 变体 + Surface 消息路由，从 OSC 133 C / 633 E 提取 `cmdline_url` 交给上层。Native 通路的核心，pier `command_started` C API 依赖这一坨。等 Lakr233 上游合并同款可以删。 |
| `0101-zsh-cmdline-url.patch` | 让 ghostty 自带的 zsh shell integration 在 OSC 133 C 中附带 `cmdline_url=<URL-percent 编码>`。pier 靠这一段拿到用户敲的命令行文本，匹配 agent CLI 名点亮 tab icon。仅 zsh，其他 shell 上游没有等价 hook。 |

## 规则

- 幂等：`git apply --check` 与 `git apply --check --reverse` 双向识别，避免
  重跑 build 时 apply 失败。
- 只写「Lakr233 patches 之后」的增量。不要重复上游已有的改动。
- Lakr233 上游 `libghostty-spm` 的 tag `storage.1.2.8`（截至 2026-06-29）
  尚不包含 command_started action；pier 自带 `0100-`。
