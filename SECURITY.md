# 安全政策

Pier 重视本地开发工作台的安全边界：密钥走 Electron `safeStorage`、官方插件索引经 Ed25519 签名校验、生产环境忽略未受管理的本地插件覆盖。

## 支持范围

| 组件 | 接收安全报告 |
| --- | --- |
| 当前 `main` 与最新正式发布（`v*`） | 是 |
| 官方受管理插件（`pier.*`，经签名索引分发） | 是 |
| 过时的预发布 / 私人 fork 修改版 | 视情况；优先请先升级到最新正式版 |

桌面端当前仅正式支持 macOS。

## 报告漏洞

**请勿**在公开 GitHub Issue、Discussions 或社交渠道披露未修复漏洞或利用细节。

优先使用 GitHub 私密漏洞报告：

1. 打开 https://github.com/runloom/pier/security/advisories/new
2. 填写影响版本、复现步骤、预期与实际行为、概念验证（若有）
3. 说明是否已在公开场合讨论过

若私密 advisory 不可用，可创建仅含「请求安全联系」的 Issue（不要贴 PoC），维护者会转为私下渠道。

## 我们会怎么做

- 尽快确认收到报告（通常数个工作日内）
- 评估影响面与修复优先级
- 在修复可用或缓解措施就绪前，与报告者协调披露节奏
- 修复发布后，可在 [`CHANGELOG.md`](CHANGELOG.md) / GitHub Release 中致谢（除非报告者要求匿名）

## 非安全类问题

功能缺陷、崩溃、文档错误请用普通 Issue 或 PR，见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 信任模型说明（插件）

内置插件与官方受管理外部插件属于**可信代码**：renderer 与宿主同 realm，external main 为普通 Node ESM。manifest capability、RPC `pluginId` 作用域与包扫描是工程纪律边界，**不是**针对恶意第三方插件的安全沙箱。当前产品不加载任意第三方插件；相关设计见 [`docs/plugins.md`](docs/plugins.md)。
