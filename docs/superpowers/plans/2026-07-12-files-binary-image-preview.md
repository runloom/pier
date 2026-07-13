# Files 二进制与图片预览实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 files 插件直接预览安全的位图文件，并以统一、可操作的 `Empty` 界面承载未选择文件和不可预览文件状态。

**Architecture:** main 进程用文件签名将 PNG、JPEG、GIF、WebP 从普通二进制中分类出来，并通过受限的 `pier-file-preview:` 协议按 root-relative 文件身份提供内容；renderer 文档状态只保存预览元数据和可复现资源 URL，不经 IPC 搬运完整图片。文件面板按 text/image/unsupported 能力分派专用视图，文本编辑器状态和图片查看器互不耦合。

**Tech Stack:** Electron `protocol.handle`、React 19、TypeScript strict、shadcn `Empty`/`Button`/`Badge`、Vitest、Testing Library

---

## 文件结构

- 新建 `src/main/files/file-preview-protocol.ts`：注册并处理受限图片资源协议，复用文件路径身份校验和图片签名识别。
- 新建 `src/plugins/builtin/files/renderer/file-image-preview.tsx`：图片画布、缩放、适应窗口、原始尺寸和加载失败状态。
- 修改 `src/main/services/file-document-reader.ts`：在文本大小限制前用有限文件头识别可预览图片，返回图片描述信息。
- 修改 `src/shared/contracts/file.ts`：增加 `kind: "image"` 读取结果及 MIME 白名单类型。
- 修改 `src/main/index.ts`、`src/main/csp.ts`：注册协议并只为 `img-src` 放行。
- 修改 `src/plugins/builtin/files/renderer/files-document-types.ts`、`files-document-reducers.ts`：保留图片 MIME、revision 和资源 URL 所需元数据。
- 修改 `src/plugins/builtin/files/renderer/file-panel-body.tsx`、`file-panel-actions.tsx`：按查看能力分派，图片隐藏文本专属操作。
- 修改 `src/plugins/builtin/files/renderer/file-panel-parts.tsx`、`file-editor-adapter.tsx`：用 `Empty` 统一正常无内容/不支持状态，错误继续使用 `Alert`。
- 修改中英文 locale：新增图片查看、缩放、系统显示和失败状态文案。
- 修改 `tests/unit/main/file-service.test.ts`、新增协议单元测试、修改 `tests/unit/renderer/files-document-store.test.ts` 和 `tests/component/files-file-panel.test.tsx`。

### Task 1：图片签名分类契约

- [x] 在 `tests/unit/main/file-service.test.ts` 先增加 PNG/JPEG/GIF/WebP 在超过文本编辑限制时仍返回 `kind: "image"` 的测试，并增加扩展名伪装、SVG 和普通二进制仍返回既有结果的测试。
- [x] 运行 `pnpm vitest run tests/unit/main/file-service.test.ts`，确认测试因缺少 `image` 结果失败。
- [x] 在 `src/shared/contracts/file.ts` 定义受限图片 MIME schema，并为读取结果增加 `{ kind: "image", mime, canonicalPath, mtimeMs, revision, size }`。
- [x] 在 `file-document-reader.ts` 用最多数十字节文件头识别 PNG、JPEG、GIF、WebP；识别发生在文本 10 MiB 限制之前，未知文件继续走原文本/二进制判定。
- [x] 重跑测试并确认通过。

### Task 2：安全图片资源协议

- [x] 新增协议测试，覆盖合法 root-relative 图片、路径越界、伪装 MIME、SVG、目录和不存在文件；断言 `Content-Type`、`Content-Length`、`ETag`、`nosniff`。
- [x] 运行该测试，确认因协议解析器不存在而失败。
- [x] 新建 `file-preview-protocol.ts`，URL 只携带 base64url 编码的 root/path 和 revision；handler 解码后调用现有文件身份解析，再校验文件签名和 revision，最后返回图片 bytes。
- [x] 在 `main/index.ts` 于 `app.ready` 前注册 scheme、ready 后安装 handler；在 `csp.ts` 的 `img-src` 增加 `pier-file-preview:`，不修改其他 CSP 指令。
- [x] 重跑协议测试和 CSP 测试。

### Task 3：renderer 文档模型

- [x] 在 `files-document-store.test.ts` 先断言 image 读取结果被保存为图片预览元数据、无文本保存能力，并断言从图片重新加载成文本时清除预览元数据。
- [x] 运行测试并确认因 `preview` 字段不存在失败。
- [x] 给 `FilesDocument` 增加 `preview: { kind: "image"; mime; revision } | null`，所有 factory/save-as 构造路径初始化为空。
- [x] 修改 reducers：image 结果保留 canonicalPath/size/revision/preview；普通 binary 仍为 `readOnlyReason: "binary"`；text 结果清除 preview。
- [x] 重跑 store 测试。

### Task 4：图片查看器

- [x] 在组件测试先覆盖图片渲染、alt、默认适应窗口、缩放上下限、原始尺寸、加载失败后的 `Empty` 和文本操作隐藏。
- [x] 运行组件测试，确认因图片查看器不存在而失败。
- [x] 新建 `file-image-preview.tsx`：使用 `<img>` 与受限协议 URL；实现 10% 到 800% 缩放、适应窗口、100% 原始尺寸、双击切换和键盘 `+/-/0`；加载失败显示 `Empty`。
- [x] 在 `file-panel-body.tsx` 优先分派图片视图；在 `file-panel-actions.tsx` 对 image/binary 返回空操作，避免语言、格式和文本视图切换误导用户。
- [x] 重跑组件测试。

### Task 5：统一状态界面与操作闭环

- [x] 在组件测试先断言未选择文件、普通二进制、临时文件丢失、尚未实现视图使用 `data-slot="empty"`；断言普通二进制展示文件名、类型、格式化大小和“在文件管理器中显示”操作。
- [x] 运行测试并确认现有手写状态导致失败。
- [x] 用 `Empty`/`EmptyHeader`/`EmptyMedia`/`EmptyTitle`/`EmptyDescription`/`EmptyContent` 重写正常无内容状态；错误恢复状态和读写错误继续使用 `Alert`。
- [x] 普通二进制调用现有 `context.files.reveal`，成功依靠系统文件管理器自然反馈，失败通过 `context.dialogs.alert` 展示技术详情。
- [x] 使用 `formatBytes` 和 i18n 文案，避免内联用户文案、固定颜色和手写徽标。
- [x] 重跑组件测试与 shadcn 治理测试。

### Task 6：回归验证

- [x] 运行 files/main 针对性单元与组件测试。
- [x] 运行 `pnpm typecheck`。
- [x] 运行 `pnpm lint`。
- [x] 运行 `pnpm test:unit -- tests/unit/renderer/color-token-governance.test.ts tests/unit/renderer/shadcn-governance.test.ts`。
- [x] 检查 `git diff --check` 和最终 diff，确认没有扩大协议 MIME、路径或 CSP 权限，并记录未运行的验证。
