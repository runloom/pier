# 工作树侧边栏交互设计

唯一入口：[workbench-sidebar-review.canvas.tsx](workbench-sidebar-review.canvas.tsx)，在 Pier 中打开，类型为 `composition`。

本目录包含侧栏、示例数据、四语文案、图标物料和检查记录；运行时只依赖公开 `pier/canvas`、React 与本目录文件。

「画板选项」可切换日常、首次打开、读取中、读取失败、远程主机、非 GIT 目录六个场景，以及语言、宽度、高度和更新状态。可展开项目、选择工作树、定位示例会话、检查底部通知及更新状态。右侧摊开工作树悬停卡片标本：路径、分支和 GIT。底部左侧是带文字的设置，右侧是通知；更新入口默认隐藏，仅在可下载、下载中、待重启时出现在通知左侧，常驻入口保持两端位置。不包含工作区内容。

基础外观由项目 Item / Button 等原语提供，状态消费宿主语义令牌。公开 Item 的 28px 紧凑适配、旧宿主身份色兼容资产和 Progress 类型缺口均在 [DESIGN.md](DESIGN.md) 明示。

最新层级修正、独立审查与截图见 [AUDIT.md](AUDIT.md)。历史验证结果见 [VERIFICATION.md](VERIFICATION.md)。实际宿主检查、公共 SDK 类型检查、组件交互测试分别记录；未以编译通过代替视觉验收。所有数据与行为均为设计示例。
