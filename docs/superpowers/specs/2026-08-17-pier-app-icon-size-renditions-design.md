# Pier 应用图标多尺寸适配设计

## 状态

- 日期：2026-08-17
- 状态：已确认并实施
- 目标：将已确认的 F 大尺寸稿与 I 小尺寸稿接入 Pier 的完整应用图标链路。

## 结论

Pier 不再用同一张 SVG 机械缩放到所有平台和尺寸，而是采用两套同源、分尺寸的正式稿：

- **F（标准稿）**：用于大尺寸 macOS 图标，以及 Windows、Linux 的透明背景图标。
- **I（Micro 稿）**：仅用于 macOS Dock 和系统界面中的 16–128px 小尺寸图标，并用于开发环境的 Dock 图标。

I 是 F 的小尺寸光学适配，不是新的品牌方向。两者必须保持同一主体结构、比例关系与色彩语言。

## 已确认的视觉规范

### F 标准稿

- 港湾相对早期版本整体缩小 10%。
- 终端宽度保持不变，只在垂直方向增高 12%。
- 终端与港湾左右保留明确间距，不允许因增高而横向贴合。
- 主体在 macOS 可见底板中的最大横向占比约为 80%。
- 港湾底部厚度使用 G 之前确认的标准大尺寸几何，不使用 Micro 的额外减薄。
- 保留大尺寸下必要的层次、渐变和材质细节。

### I Micro 稿

- 继承 F 的主体比例与终端横向间距。
- 港湾下部在 H 的基础上减薄约 12%，仅改变下部厚度，手臂与承托面位置不变。
- 移除终端左上角紫色屏幕光斑；不得以其他泛光替代。
- 移除在小尺寸下易糊成脏边的终端、港湾和字形阴影。
- 适当加强终端描边、提示符和下划线的有效笔画，保证 16–64px 可辨识。
- 保留底板微弱外缘、终端顶部高光和港湾承托面高光；这些是结构分层，不是装饰泛光。
- Dock 场景下主体垂直光学占比约为 69%，同时避免触碰 macOS 图标安全边界。

## 已确认源文件

| 用途 | 文件 | SHA-256 |
| --- | --- | --- |
| F 标准稿 | `/private/tmp/pier-logo-preview/f-decoupled-terminal.svg` | `ed1f59e2d4f95f62ed4a3336999f83e72003f31449a842b70f2d21b6e7ce8f2d` |
| I Micro 稿 | `/private/tmp/pier-logo-preview/i-micro-clean-screen.svg` | `8e3387d34d9eef1861d3e1768798ca09be1d07c087aed2ea2426afe95eb17ae3` |

实施时必须先校验上述哈希，避免误接入旧版或中间稿。

## 平台与尺寸分配

| 目标 | 尺寸 | 使用稿 | 背景 |
| --- | --- | --- | --- |
| macOS ICNS | 16、32、64、128px | I Micro | macOS 深色底板 |
| macOS ICNS | 256、512、1024px | F 标准稿 | macOS 深色底板 |
| 开发环境 Dock `build/icon.png` | 512px | I Micro | macOS 深色底板 |
| Windows ICO | 工具链标准尺寸 | F 标准稿 | 透明 |
| Linux hicolor PNG | 工具链标准尺寸 | F 标准稿 | 透明 |
| 项目公开 SVG 母版 | 矢量 | F 标准稿 | 透明 |

Windows 与 Linux 不套用 macOS 深色底板，避免在系统原生图标容器中出现双重底板。

## 项目文件规划

实施阶段更新或新增以下文件：

- `build/design-sources/pier-logo.svg`：透明背景的 F 品牌母版。
- `build/app-icon-master.svg`：带 macOS 底板的 F 标准稿。
- `build/app-icon-micro.svg`：带 macOS 底板的 I Micro 稿。
- `build/app-icon-unplated.svg`：供 Windows、Linux 使用的透明 F 稿。
- `scripts/build-app-icons.mjs`：支持 macOS 大小尺寸双稿合成。
- `build/icon.icns`：macOS 最终多尺寸图标。
- `build/icon.png`：开发环境 Dock 图标。
- `build/icon.ico`：Windows 图标。
- `build/icons/*.png`：Linux hicolor 图标集。
- `docs/development.md`：记录两套母版的职责和再生成方式。

现有 `electron-builder.yml` 和运行时图标路径仅在确有必要时调整；不更改产品 UI、功能或品牌文案。

## 生成方案

### macOS

使用项目锁定的 electron-builder 官方图标工具分别生成 F 与 I 的现代临时 ICNS；非 Retina 16/32px 由 `rsvg-convert` 栅格化 I，再交给 macOS `sips` 编成系统兼容的 legacy RGB + alpha 条目。项目脚本随后按 ICNS 条目类型合成最终文件：

- I Micro：`is32` + `s8mk`（16px）、`il32` + `l8mk`（32px）、`ic11`（32px Retina）、`ic12`（64px Retina）、`ic07`（128px）。
- F 标准稿：`ic08`（256px）、`ic09`（512px）、`ic10`（1024px）；`ic13` 复用 `ic08` 的 256px 数据，`ic14` 复用 `ic09` 的 512px 数据。

最终容器不得包含 `icp4`、`icp5`、`icp6`：macOS 26 的系统解码器会把该工具生成的这些条目还原成彩色噪点。对应关系仍覆盖 16、32、64、128、256、512、1024px 及 Retina 条目。合成脚本必须校验：

- ICNS 文件头与总长度一致。
- 目标条目类型齐全且不重复。
- modern 条目包含完整有效的非交错 8-bit RGBA PNG，CRC、IEND、zlib、scanline 长度和逐行 filter 均合法。
- PNG 像素尺寸与 ICNS 条目语义一致；legacy RGB/alpha 对齐全且 mask 长度准确。

不使用 `iconutil` 重新封装；它仅作为系统级验收解码器。macOS CI 必须用它解出官方 10 个 iconset 文件，并逐像素对比来源，确保 16/32px 不再损坏且没有多余 48px 帧。生成在暂存目录完成后一次性发布，测试通过依赖注入使用离线 converter，禁止冷启动下载。

### Windows 与 Linux

继续由同一官方工具从透明 F 稿生成 ICO 和 hicolor PNG 集，不引入平台专属的新视觉版本。

## 验证与审查

实施完成后必须依次完成：

1. 校验 F、I 输入文件哈希。
2. 校验所有 SVG 可解析，且不包含嵌入位图、base64、文本节点或外部资源。
3. 执行 `pnpm build:icons`，确认所有平台资产可重复生成。
4. 解析最终 ICNS，验证 modern/legacy 条目类型、PNG 尺寸和来源分配。
5. 在 macOS 用系统 `iconutil` 解包并核对官方 10 个文件名及逐像素内容。
6. 检查 16、32、64、128、256、512、1024px 渲染：小尺寸来自 I，大尺寸来自 F。
7. 对照已确认的 I Dock 合成图，检查终端与港湾间距、港湾底厚、光斑清理和整体占比。
8. 检查 Windows ICO 与 Linux PNG 保持透明背景且无裁切。
9. 执行项目格式与静态检查。
10. 由独立子智能体复核视觉、资源映射和生成脚本；若发现差异，修复后重新生成并复核，直到无关键、重要或次要问题。

## 验收标准

- macOS Dock 小尺寸效果与已确认的 I 稿一致，不再出现左上紫色光斑、额外泛光或过厚港湾底部。
- 终端只增高，不横向扩大；与港湾左右不相贴。
- 16–128px 使用 I，256–1024px 使用 F，且 Retina 条目映射正确。
- Windows 与 Linux 使用透明 F 稿，没有 macOS 底板。
- 所有项目正式图标均由脚本从受版本控制的 SVG 母版生成，不依赖 `/private/tmp` 中间文件。
- 生成结果可重复，项目检查通过，独立审查无遗留问题。

## 不在本次范围内

- 不修改应用界面、启动页或其他产品功能。
- 不重新设计已确认的 F/I 视觉方向。
- 不更改操作系统的图标遮罩、圆角或 Dock 显示规则。
- 不把 I Micro 稿扩展为所有大尺寸场景的唯一母版。
