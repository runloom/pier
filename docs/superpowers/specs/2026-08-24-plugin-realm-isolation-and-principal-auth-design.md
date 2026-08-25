# 插件机制 Phase 2：Realm 隔离 + 每插件主体授权设计

**日期：** 2026-08-24  
**状态：** 基础设施已实施（M0–M4 见文末「实施状态」）；生产入口仍关闭  
**前置：**  
- [2026-08-24 插件失败语义契约](./2026-08-24-plugin-failure-semantics.md)  
- AGENTS.md「插件边界是纪律边界，不是安全边界」节  
- Phase 1 纪律强化（workspace.plan / 权限透明度）已交付

## 1. 一句话

第三方插件进**独立源的沙箱 iframe**（realm 隔离），所有宿主调用经**能力桥逐条校验**，main 按 **pluginId 主体**授权（deny-by-default）；官方插件维持 in-realm 快路径不变——双轨制。

## 2. 威胁模型（为什么现状不够）

| 现状 | 后果 |
|---|---|
| 外部 renderer 经 `import(url)` 进宿主同 realm | 共享全局/原型/DOM；可 monkey-patch 宿主、摸任意 DOM |
| 授权按 client-kind（desktop-renderer 整体 ~30 能力） | 装任何一个第三方插件 = 自动获得 file:write/git:write/terminal:read 全集 |
| 无安装时权限确认 | 用户无法知情，遑论同意 |

结论：开放第三方前，「纪律边界」必须升级为「结构边界」。

## 3. 双轨制

| 轨道 | 执行域 | 授权 | 适用 |
|---|---|---|---|
| **快轨（现状不变）** | 宿主 renderer 同 realm | 门面断言 + client-kind | builtin + 官方签名托管 |
| **沙箱轨（新增）** | 每插件一个 `sandbox` iframe（无 `allow-same-origin` ⇒ opaque origin） | 能力桥 + plugin-principal 主体 | 未来第三方 |

明确不做进程级隔离（utility process per plugin）：内存/延迟成本不匹配 UI 插件场景；保留为未来「原生级」插件的可选档。

## 4. Realm 隔离设计

### 4.1 宿主侧

- dockview panel / workbench widget 的内容区挂 `<iframe sandbox="allow-scripts">`（**不给** `allow-same-origin` / `allow-top-navigation` / `allow-popups`）
- iframe 文档由宿主生成（srcdoc）：内联引导脚本持有**一次性桥令牌**（见 §5.1），随后加载插件 bundle
- 文档加 CSP：`script-src 'unsafe-inline' <bundle-url>`；`connect-src 'none'`——插件网络一律走能力桥，禁止直连

### 4.2 免费收益

- 样式天然隔离（现 live-modules 的 CSS 注入/清理问题在沙箱轨不存在）
- 崩溃半径 = 单 iframe；失败语义契约 F1 的沙箱轨对应物

## 5. 能力桥消息协议（草案 v1）

### 5.1 信任锚

opaque origin 下 `event.origin === "null"` 无法做源校验，采用**令牌回执**：

```
宿主生成 per-iframe 一次性 token → 注入引导脚本
所有上行帧必须携带 token；宿主校验 token + event.source === 该 iframe.contentWindow
token 校验失败一次 → 冻结该 iframe 并上报诊断
```

### 5.2 帧

```ts
type BridgeFrame =
  | { t: "hello"; proto: 1; token: string }
  | { t: "ready"; proto: 1 }
  // 请求-响应（id 关联；单插件并发上限 16；超时与现有外部加载超时同量级 10s）
  | { t: "call"; id: number; method: string; params: JsonValue }
  | { t: "result"; id: number; ok: true; data: JsonValue }
  | { t: "result"; id: number; ok: false;
      error: { code: "denied" | "unknown_method" | "timeout" | "internal_error";
               message: string } }
  // 订阅广播（白名单通道复用 canvas-host 的 isCanvasHostChannelAllowed 思路）
  | { t: "subscribe"; channel: string }
  | { t: "event"; channel: string; payload: JsonValue }
  // 生命周期：宿主下发，插件须在 drain 时限内 ack（对齐 F5 失败矩阵）
  | { t: "dispose" } | { t: "disposed" };
```

规则：

- **方法面 deny-by-default**：method → handler 注册表只含桥显式暴露的条目；未注册 = `denied`
- 每个 method 在注册时声明所需 capability；派发前查该插件 manifest 权限集，缺 = `denied`
- 帧大小帽 2 MiB；超限直接断链并记录操作日志

### 5.3 与既有面的关系

- 沙箱轨**不复用** `window.pier` / `PIER.PLUGIN_RPC_INVOKE`（那些以 renderer 全权为前提）
- 贡献点（panel/widget/命令）仍由 manifest 静态声明为主；运行时动态注册仅经 `contribute` 类帧且需 manifest 已声明同 kind 贡献点（对齐 `assertDeclaredContribution` 语义）

## 6. 每插件主体授权

### 6.1 新增第六种 client kind：`plugin-principal`

```ts
// permissions.ts
pierClientKindSchema: + "plugin-principal"
PierClient: { id: `plugin:${pluginId}`, kind: "plugin-principal",
              capabilities: <manifest 权限集 ∩ 桥允许集> }
```

- `DEFAULT_CAPABILITIES_BY_CLIENT_KIND["plugin-principal"] = []` —— **静态默认为零**，能力完全来自 manifest，运行期不可扩
- `CommandMetadata` 增加 `allowPluginPrincipals?: boolean`（缺省 false）。今天所有命令保持 false；逐个命令显式开启并 review——这就是 deny-by-default 的落点
- `authorizeCommand` 顺序不变（kind → capability），capability 来源换成主体注入

### 6.2 知情同意与审计（对齐 Chrome 扩展模型）

- 安装/首次启用：展示权限摘要（Phase 1.3 的四语言标签直接复用），破坏性权限（file:write/git:write/terminal:*）单独列出
- 撤销：设置页禁用即回收全部主体能力；操作日志记 grant/revoke/denied 事件
- 官方索引 schema v2 预留 per-entry `permissions` 字段：让「未安装先看权限」成为可能（当前索引只有 name/version/assets）

## 7. 迁移路径（每步有独立验收门）

| 里程碑 | 内容 | 验收门 |
|---|---|---|
| **M0 协议床** | BridgeFrame zod 契约 + 内存版桥 mock + 测试床（假插件跑 hello/call/event/dispose 全帧型）| 帧契约测试 100% 分支覆盖 |
| **M1 主体授权先行** | 第六 client kind + `allowPluginPrincipals` 落地；对**官方插件**启用（行为不变——manifest 权限早已存在，纯换发证方式）| 全量既有命令路由测试绿；未开闸命令对 principal 返回 denied |
| **M2 沙箱桥试点** | iframe 容器 + 能力桥 + 一个 demo 第三方插件（panel + widget + 2 条命令）全链路 | 试点插件功能等价 in-realm 版本；F1 失败矩阵在 iframe 内复验 |
| **M3 同意与审计** | 安装/启用权限摘要 UI + grant/revoke/denied 操作日志 | 漏配权限文案被治理测试拦下 |
| **M4 索引 v2** | official index 带 per-entry permissions + 发布者签名预留 | 验签管线回归绿 |

**总闸门：M0–M4 全绿之前，生产包第三方入口维持 AGENTS.md 现状（默认隐藏、返回拒绝）。**

## 8. 落点（未来代码位置预告）

```
src/shared/contracts/plugin-bridge.ts        BridgeFrame + 方法注册表契约
src/main/app-core/permissions.ts             plugin-principal 授权路径
src/main/app-core/command-metadata.ts        allowPluginPrincipals 字段
src/renderer/lib/plugins/sandbox/            iframe 容器 + 能力桥 + 令牌管理
tests/unit/main/plugins/plugin-principal*.test.ts
tests/unit/renderer/plugins/sandbox-bridge.test.tsx
docs/superpowers/specs/2026-08-24-plugin-failure-semantics.md   （沙箱轨行追加）
```

## 9. 实施状态（2026-08-24）

| 里程碑 | 状态 | 落点 |
|---|---|---|
| M0 协议床 | ✅ | `src/shared/contracts/plugin/bridge.ts` + `tests/unit/renderer/plugin-sandbox/sandbox-bridge.test.ts` |
| M1 主体授权 | ✅ | `permissions.ts` 第六 client kind（静态零能力）+ `allowPluginPrincipals`（缺省 false）+ `authorizeForPluginPrincipal` |
| M2 沙箱桥 + 分派 | ✅（dev-only） | `sandbox/bridge.ts`、`sandbox/iframe-host.tsx`、`sandbox/dispatch.tsx`；`RendererPluginRuntime.activateExternalAttempt` 早分支接电。开关 = dev 运行时 + `localStorage["pier.sandboxTrack"]="1"`；生产恒 false |
| M3 同意与审计 | ✅ 最小闭环 | 目录行安装前权限摘要；桥 denied/frozen 经 `PIER.PLUGIN_SANDBOX_AUDIT` 进插件操作日志（每窗口限流 50 条）|
| M4 索引 v2 | ✅ schema | `officialPluginEntrySchema.permissions` 可选字段，向后兼容 |

遗留（后续迭代）：
1. 沙箱轨端到端联调需真实 Chromium iframe 环境（jsdom 无法覆盖跨窗消息）
2. 第三方开发者 SDK（类型化客户端）待首个真实需求定型
3. 发布者签名 key ceremony（运维前置）
4. 总闸门不变：生产包第三方入口默认隐藏/拒绝

## 10. 非目标

- 不给官方插件上沙箱（快轨成本收益不变）
- 不做进程级隔离（见 §3；留作未来档位）
- 不做 marketplace（分发渠道问题与本文正交；herdr 式「仅索引」在 M4 之后另议）
- 不承诺向后兼容沙箱轨协议 v1 以外的版本（proto 字段就是为此存在）
