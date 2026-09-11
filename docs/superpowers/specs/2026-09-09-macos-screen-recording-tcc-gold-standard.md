# macOS 未使用隐私权限 — 金标准

日期：2026-09-09  
状态：现行权威（桌面宿主 macOS TCC）  
范围：启动与日常不得弹出 Pier 用不到的系统隐私卡（屏幕与系统音频录制、相机、麦克风、蓝牙）。  
不包含：把屏幕录制 / 相机 / 麦克风做成产品能力；完全磁盘访问的设置入口。

权威实现：[`display-capture-policy.ts`](../../../src/main/display-capture-policy.ts)、[`gpu-workarounds.ts`](../../../src/main/gpu-workarounds.ts)（ready 前关掉采集功能）、[`mac-privacy-descriptions.mjs`](../../../scripts/mac-privacy-descriptions.mjs)（需要的说明 vs 未使用黑名单）、[`mac-helper-icons.mjs`](../../../scripts/mac-helper-icons.mjs)（afterPack 从主应用与 Helper 删掉 Electron 默认说明）、[`dev-profile.mjs`](../../../scripts/dev-profile.mjs)（PierDev 同样删除）、[`verify-mac-release-artifacts.mjs`](../../../scripts/verify-mac-release-artifacts.mjs)。  
检查点：`tests/unit/main/display-capture-policy.test.ts`、`tests/unit/main/macos-screen-recording-governance.test.ts`、`tests/unit/scripts/mac-privacy-descriptions.test.ts`、`tests/unit/scripts/mac-helper-icons.test.ts`、`tests/unit/main/preferences/mac-release-assets.test.ts`。

---

## 一句话终态

Pier 不录屏、不采集系统音频、不用相机 / 麦克风 / 蓝牙。启动、日常使用、自动更新之后，系统都不得弹出这些用不到的隐私卡。设置里开关开着、关着、或绑着过期哈希，都一样不弹。根治是 **不再调用会问这些权限的 API，也不带用途说明**，不是引导用户再授一次权。

桌面 / 文稿 / 下载 / 网络 / 可移除宗卷 / 同步盘 / Apple 事件：继续用现有用途说明，需要时才问。

---

## 决策树

1. 要不要录屏、采集其他 App 窗口、系统音频、相机、麦克风、蓝牙？→ **不要。** 不调用对应 API，Info.plist 不留用途说明。
2. Chromium 默认会探活采集？→ 在 `app.whenReady()` **之前** 把相关功能写进 `--disable-features`，并与已有 disable 列表合并去重。
3. 网页或插件仍可能要 `display-capture` / `media`？→ 每个 session **拒绝**，显示媒体请求回空流。这只挡 Chromium 权限层，挡不住系统卡，只能做第二道。
4. Electron 默认 Info.plist 带了相机 / 麦克风 / 音频 / 蓝牙说明？→ 打包后、签名前从 **主应用与 Helper** 删掉。`extendInfo` 只能合并，不能删键。
5. 用户设置里开着却仍弹？→ 视为过期代码签名要求（csreq）。产品不做设置页、不重置 TCC、不主动枚举采集源。停探测后自然不再弹。
6. 必须用被禁 API 或用途说明？→ 先改产品。例外只能进治理测试 allowlist。

---

## 硬规则

### 1. 永不问用不到的权限

产品源码（`src/main`、`src/renderer`、`src/plugins`、`packages/*/src`、`native/Sources`、`native/src`）禁止：

- `desktopCapturer`、`desktopCapturer.getSources`
- `getDisplayMedia`、`chromeMediaSource`
- `getMediaAccessStatus("screen")` / `getMediaAccessStatus('screen')`、`askForMediaAccess`
- `CGRequestScreenCaptureAccess`、`CGWindowListCreateImage`、`CGDisplayStream`
- `SCShareableContent`、`SCScreenshotManager`、`SCStream`、`SCContentSharingPicker`
- `AXIsProcessTrusted`、`AXUIElementCreate`、`PHPhotoLibrary`

允许：只采集 **本进程窗口** 且系统保证不问权的路径（Ghostty 自己的 IOSurface；Chromium `getCurrentProcessShareableContent` 若在当前系统不问权）。一旦某条「本进程」路径在 macOS 26 上仍弹出系统卡，必须当缺陷关掉或换 API，不得改成「请去系统设置授权」。

辅助功能与照片图库：产品不用。不补用途说明（补了会把过期开关激活成正当弹窗）。本机若仍有过期授权，不问则不弹。

### 2. 未使用用途说明黑名单

单一来源：`MAC_UNUSED_USAGE_DESCRIPTION_KEYS`。

- `NSScreenCaptureUsageDescription`
- `NSAudioCaptureUsageDescription`
- `NSCameraUsageDescription`
- `NSMicrophoneUsageDescription`
- `NSBluetoothAlwaysUsageDescription`
- `NSBluetoothPeripheralUsageDescription`

正式包 afterPack 与 PierDev 签名前，主应用与每个 Helper 的 Info.plist 必须删掉这些键。`electron-builder.yml` extendInfo、隐私说明表、zh lproj **不得**把它们当用途正文。门禁脚本可以出现键名，以便拒绝。

需要保留的说明仍只来自 `MAC_FOLDER_USAGE_DESCRIPTIONS`（文件夹、同步盘、Apple 事件）。

通知声是播放，不是采集；删掉音频采集说明不影响 `notification-sounds`。

### 3. 启动前关掉 Chromium 采集功能

`disableUnusedScreenCaptureFeatures()` 必须在 `app.whenReady()` 之前调用。现有调用点是 `applyGpuWorkarounds()`（`src/main/index.ts` 模块加载处）。禁止挪到 ready 之后。

功能名单一来源：`SCREEN_CAPTURE_DISABLE_FEATURES`。`--disable-features` **只放功能名**，不放 `Feature:param/value`。只在 `darwin` 上动手；读出现有 disable 列表，去重后一次 `appendSwitch`。

Electron 在 macOS 14.4+ 仍会把 ScreenCaptureKit 写进 `--enable-features`（`EnablePlatformSpecificFeatures`）。Chromium `FeatureList` 先注册 disable、`insert` 不覆盖，**disable 赢**。禁止为了对抗再把同名功能写进 `--enable-features`。

### 4. Session 拒绝采集（第二道，不能当第一道）

每个 session：`display-capture` / `media` / `deprecated-sync-clipboard-read` 检查与请求都拒绝；`setDisplayMediaRequestHandler` 回空流，不枚举源、不用系统选择器。`session.defaultSession` 与之后 `session-created` 都要装上。

禁止启动时用 `getSources` 或 `getMediaAccessStatus("screen")` 去「落实」权限。

### 5. 签名身份要稳，但不靠它消弹窗

正式包 designated requirement 必须含 `identifier "io.pier.app"` 与 TeamID `QXK3VU5R45`，禁止整段只绑 cdhash。这让 **新授权** 能熬过更新。它修不了已经写成旧 cdhash 的 TCC 行，也不需要：停探测后旧行不再被问到。

### 6. 文案与设置

前台主路径、设置页、通知中心不准出现「请到系统设置允许录屏 / 相机 / 麦克风」。不新增这些设置项、不新增简单弹窗、不走消息中心。Changelog 允许一句一次性修复说明。

---

## 明确不做

- 应用内「打开系统设置」向导、过期授权检测 UI、从应用里 `tccutil reset`
- 为了让系统卡「好看」而补黑名单里的用途说明
- 启动时枚举采集源、查询屏幕权限、提示辅助功能
- Hook / swizzle ScreenCaptureKit
- 改 Helper bundle id 去迁就 TCC
- 关掉 `IOSurfaceCapturer`（旧 `CGDisplayStream` 路径；关掉可能把采集逼回 SCK）
- 把完全磁盘访问、文件夹权限改成启动时主动请求

---

## 功能名核对

对照 Electron 43.4.0（Chrome 150）`Electron Framework` 字符串与 `shell/browser/feature_list_mac.mm`。**不存在的名字不得写入关闭列表。**

| 功能 | 为何关掉 |
|------|----------|
| `ScreenCaptureKitPickerScreen` | Electron 在 14.4+ 会强行 enable；选择器屏幕缩略图走 SCK |
| `ScreenCaptureKitStreamPickerSonoma` | 同上，窗口缩略图 |
| `ScreenCaptureKitMacScreen` | 用 SCK 采屏幕 |
| `ScreenCaptureKitDeviceMac` | SCK 采集设备 |
| `ScreenCaptureKitFullDesktopFallback` | 全桌面源仍走 SCK 采第一块屏 |
| `ThumbnailCapturerMac` | Electron 以带参数形式 enable；关闭列表只写功能名 |
| `UseSCContentSharingPicker` | macOS 15+ 系统内容选择器 |
| `MacCatapLoopbackAudioForScreenShare` | 屏幕共享环回音频 |
| `MacCatapLoopbackAudioForCast` | Cast 环回音频，同属系统音频采集 |
| `ScreenAIOCREnabled` | 屏幕 OCR；Electron 也会关，由关闭列表持有以免上游改默认 |

核对过、**不得**写入关闭列表：

- `WarmScreenCaptureSonoma`（未链进 Electron Framework）
- `ScreenCaptureKitMacWindow` / `ScreenCaptureKitMac` / `ScreenCaptureKitStreamPickerVentura`
- `UseSCContentSharingPickerSonoma`
- `MacSckSystemAudioLoopbackOverride` / `MacCatapSystemAudioLoopbackCapture`
- `ScreenCaptureKitAudioHelper` / `ScreenCaptureKitDeviceHelper` / `ScreenCaptureKitPickerHelper`（直方图名，不是功能）
- `ThumbnailCapturerMac:capture_mode/sc_screenshot_manager`（参数形式）
- `IOSurfaceCapturer`

升级 Electron 后：对照新 Framework 字符串重跑本节；增删名字必须同时改 `SCREEN_CAPTURE_DISABLE_FEATURES`、本表和治理测试。

---

## 复发记录

- **0.1.30** 关掉一批 ScreenCaptureKit 功能，并拒绝 session 采集。0.1.41 运行中的 Helper 已带上那批 `--disable-features`，仍会弹系统卡。
- **2026-09-09 本机**：`io.pier.app` 的屏幕录制在系统设置里为开，TCC 却绑着 2026-06-28 的 cdhash `70e72b09…`，当前 `/Applications/Pier.app` 0.1.41 为 `a972da5c…`。系统卡文案是「屏幕和音频」，没有「允许」。完全磁盘访问在 8 月 30 日重授时写成了稳定的 `identifier + TeamID`。
- 同一天 cdhash 过期账还在：辅助功能、照片、Apple 事件→系统事件、坚果云。产品不问则不弹。
- Electron 默认 Info.plist 把 `NSAudioCaptureUsageDescription` / 相机 / 麦克风 / 蓝牙说明带进正式包与 Helper。`extendInfo` 删不掉它们。
- 根治是停探测并删掉未使用说明。过期授权变成死记录；用户若仍看到旧开关，可完全退出后关开一次（changelog 一次性说明）。
