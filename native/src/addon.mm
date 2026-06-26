// native/src/addon.mm — N-API bridge: JS ↔ C ABI (GhosttyBridge.swift)
#import <AppKit/AppKit.h>
#import <napi.h>
#include <string>
#include <vector>

extern "C" {
    bool ghostty_bridge_setup_window(void* nsWindow, long browserWindowId);
    void ghostty_bridge_set_overlay_active(void* nsWindow, bool active);
    bool ghostty_bridge_create_terminal(void* nsWindow, const char* panelId,
                                         double x, double y, double w, double h,
                                         const char* fontFamily, float fontSize,
                                         const char* workingDirectory);
    void ghostty_bridge_set_font_config(void* nsWindow, const char* fontFamily, float fontSize);
    void ghostty_bridge_set_terminal_config(void* nsWindow, const char* cursorStyle,
                                            bool cursorBlink, double scrollbackLimitBytes,
                                            bool pasteProtection);
    void ghostty_bridge_set_frame(const char* panelId,
                                   double x, double y, double w, double h);
    void ghostty_bridge_show(const char* panelId);
    void ghostty_bridge_hide(const char* panelId);
    void ghostty_bridge_close(const char* panelId);
    void ghostty_bridge_focus(const char* panelId);
    bool ghostty_bridge_perform_binding_action(const char* panelId, const char* action);
    void ghostty_bridge_close_all(void* nsWindow);
    // 孤儿清理:关该 window 下不在 activeIds 中的 NSView. C 方案 reload 零销毁
    // 路径上, renderer 重建后报告"我现在还需要这些 panelId", swift 把不在集合
    // 里的 panel 清掉. activeIds = NULL / count = 0 表示新 renderer 还没有任何
    // terminal panel — 等价于 closeAll.
    void ghostty_bridge_reconcile(void* nsWindow, const char** activeIds, long count);
    void ghostty_bridge_detach_window(void* nsWindow);
    // C 函数指针 typedef 让 swift cb 能传给 N-API ThreadSafeFunction 持有的 trampoline.
    // 签名: (browserWindowId, modifierFlags, chars UTF-8). browserWindowId 是 Electron
    // BrowserWindow.id, 让 main 端按 window id 路由 (多窗口下 getFocusedWindow 不准).
    typedef void (*KeyboardForwardFn)(long browserWindowId, unsigned long modifiers, const char* chars);
    void ghostty_bridge_set_keyboard_forward_callback(KeyboardForwardFn cb);
    void ghostty_bridge_set_app_shortcut_keys(const char** keys, long count);
    // Mouse forward: swift NSEvent monitor 命中 terminal 区域 rightMouseDown → JS.
    // 签名 (browserWindowId, panelId UTF-8, x, y). 用于触发 native 右键菜单.
    typedef void (*MouseForwardFn)(long browserWindowId, const char* panelId, double x, double y);
    void ghostty_bridge_set_mouse_forward_callback(MouseForwardFn cb);
    typedef void (*TerminalFocusRequestFn)(long browserWindowId, const char* panelId);
    void ghostty_bridge_set_terminal_focus_request_callback(TerminalFocusRequestFn cb);
    // PWD forward: swift TerminalSurfacePwdDelegate 收到 OSC 7 → 此 trampoline → JS.
    // 签名 (browserWindowId, panelId UTF-8, cwd UTF-8). 与 keyboard forward 同模式.
    typedef void (*PwdForwardFn)(long browserWindowId, const char* panelId, const char* cwd);
    void ghostty_bridge_set_pwd_forward_callback(PwdForwardFn cb);
    // Title forward: swift TerminalSurfaceTitleDelegate 收到 OSC 0/2 → 此 trampoline → JS.
    // 签名 (browserWindowId, panelId UTF-8, title UTF-8). 与 PWD 同模式.
    typedef void (*TitleForwardFn)(long browserWindowId, const char* panelId, const char* title);
    void ghostty_bridge_set_title_forward_callback(TitleForwardFn cb);
    void ghostty_bridge_set_active_panel_kind(void* nsWindow, long kindRaw, const char* panelId);
    // 应用 Pier 主题派生的终端配色. cursor / selection 可空 (NULL = 不设置).
    // palette 是 16 槽 const char* 数组, 每槽 #RRGGBB hex (含 #). 调用同步, swift 同步
    // 构造 GhosttyThemeDefinition 后立即 setTheme — addon 端的字符串生命周期只需覆盖
    // 这次调用即可.
    void ghostty_bridge_apply_theme(
        void* nsWindow,
        const char* background,
        const char* foreground,
        const char* cursor,            // nullable
        const char* selectionBackground, // nullable
        const char* selectionForeground, // nullable
        const char** palette           // length 16, non-null entries
    );
}

// Electron getNativeWindowHandle() returns Buffer containing NSView**
static NSWindow* WindowFromHandle(const Napi::Value& v) {
    Napi::Buffer<char> buf = v.As<Napi::Buffer<char>>();
    void* raw = static_cast<void*>(buf.Data());
    NSView* __unsafe_unretained * viewPtr =
        reinterpret_cast<NSView* __unsafe_unretained *>(raw);
    NSView* view = *viewPtr;
    return view.window;
}

// --- JS exports ---

static Napi::Value JsSetupWindow(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return Napi::Boolean::New(info.Env(), false);
    long browserWindowId = static_cast<long>(info[1].As<Napi::Number>().Int64Value());
    bool ok = ghostty_bridge_setup_window((__bridge void*)win, browserWindowId);
    return Napi::Boolean::New(info.Env(), ok);
}

static Napi::Value JsSetOverlayActive(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return info.Env().Undefined();
    bool active = info[1].As<Napi::Boolean>().Value();
    ghostty_bridge_set_overlay_active((__bridge void*)win, active);
    return info.Env().Undefined();
}

static Napi::Value JsCreateTerminal(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return Napi::Boolean::New(info.Env(), false);
    std::string panelId = info[1].As<Napi::String>().Utf8Value();
    Napi::Object frame = info[2].As<Napi::Object>();
    double x = frame.Get("x").As<Napi::Number>().DoubleValue();
    double y = frame.Get("y").As<Napi::Number>().DoubleValue();
    double w = frame.Get("width").As<Napi::Number>().DoubleValue();
    double h = frame.Get("height").As<Napi::Number>().DoubleValue();
    std::string fontFamily = info[3].As<Napi::String>().Utf8Value();
    float fontSize = info[4].As<Napi::Number>().FloatValue();
    const char* cwdPtr = nullptr;
    std::string cwdHolder;
    if (info.Length() > 5 && info[5].IsString()) {
        cwdHolder = info[5].As<Napi::String>().Utf8Value();
        if (!cwdHolder.empty()) cwdPtr = cwdHolder.c_str();
    }
    bool ok = ghostty_bridge_create_terminal(
        (__bridge void*)win, panelId.c_str(),
        x, y, w, h,
        fontFamily.c_str(), fontSize,
        cwdPtr
    );
    return Napi::Boolean::New(info.Env(), ok);
}

static Napi::Value JsSetFrame(const Napi::CallbackInfo& info) {
    std::string panelId = info[0].As<Napi::String>().Utf8Value();
    Napi::Object frame = info[1].As<Napi::Object>();
    double x = frame.Get("x").As<Napi::Number>().DoubleValue();
    double y = frame.Get("y").As<Napi::Number>().DoubleValue();
    double w = frame.Get("width").As<Napi::Number>().DoubleValue();
    double h = frame.Get("height").As<Napi::Number>().DoubleValue();
    ghostty_bridge_set_frame(panelId.c_str(), x, y, w, h);
    return info.Env().Undefined();
}

static Napi::Value JsShow(const Napi::CallbackInfo& info) {
    std::string panelId = info[0].As<Napi::String>().Utf8Value();
    ghostty_bridge_show(panelId.c_str());
    return info.Env().Undefined();
}

static Napi::Value JsHide(const Napi::CallbackInfo& info) {
    std::string panelId = info[0].As<Napi::String>().Utf8Value();
    ghostty_bridge_hide(panelId.c_str());
    return info.Env().Undefined();
}

static Napi::Value JsClose(const Napi::CallbackInfo& info) {
    std::string panelId = info[0].As<Napi::String>().Utf8Value();
    ghostty_bridge_close(panelId.c_str());
    return info.Env().Undefined();
}

static Napi::Value JsFocus(const Napi::CallbackInfo& info) {
    std::string panelId = info[0].As<Napi::String>().Utf8Value();
    ghostty_bridge_focus(panelId.c_str());
    return info.Env().Undefined();
}

static Napi::Value JsPerformBindingAction(const Napi::CallbackInfo& info) {
    std::string panelId = info[0].As<Napi::String>().Utf8Value();
    std::string action = info[1].As<Napi::String>().Utf8Value();
    bool ok = ghostty_bridge_perform_binding_action(panelId.c_str(), action.c_str());
    return Napi::Boolean::New(info.Env(), ok);
}

static Napi::Value JsCloseAll(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return info.Env().Undefined();
    ghostty_bridge_close_all((__bridge void*)win);
    return info.Env().Undefined();
}

static Napi::Value JsReconcile(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return info.Env().Undefined();
    Napi::Array arr = info[1].As<Napi::Array>();
    uint32_t len = arr.Length();
    // 两段式存储:先把 Utf8Value 持回 std::string 数组 (保证字符串生命周期覆盖到
    // ghostty_bridge_reconcile 调用结束), 再收集 const char* 到平铺数组传给 swift.
    // swift 端 String(cString:) 立即拷贝, 调用结束后这边可以全部释放.
    std::vector<std::string> holders;
    holders.reserve(len);
    for (uint32_t i = 0; i < len; ++i) {
        holders.push_back(arr.Get(i).As<Napi::String>().Utf8Value());
    }
    std::vector<const char*> ptrs;
    ptrs.reserve(len);
    for (auto& s : holders) ptrs.push_back(s.c_str());
    ghostty_bridge_reconcile(
        (__bridge void*)win,
        ptrs.empty() ? nullptr : ptrs.data(),
        static_cast<long>(len)
    );
    return info.Env().Undefined();
}

static Napi::Value JsDetachWindow(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return info.Env().Undefined();
    ghostty_bridge_detach_window((__bridge void*)win);
    return info.Env().Undefined();
}

// ---- Forward channel template (swift → main JS) ----
//
// 通用 ThreadSafeFunction 桥. 每条 forward (keyboard / mouse / pwd / title) 都是:
//   swift 线程触发 C 函数指针 → trampoline 构 Payload → TSFN 跨线程到 JS 线程 →
//   payload.callJs(env, jsCallback) → delete payload.
//
// Payload 是 plain struct, 各自字段 + 一个 callJs 方法负责把字段映射到 napi 值.
// 添加新 forward 只需:声明 Payload、声明 g_xxx ForwardChannel、1 行 trampoline、
// 1 行 JsSet handler.
template <typename Payload>
class ForwardChannel {
public:
    explicit ForwardChannel(const char* debugName) : debugName_(debugName) {}

    void bindJs(Napi::Env env, Napi::Function jsFn) {
        releaseJs();
        tsfn_ = Napi::ThreadSafeFunction::New(env, jsFn, debugName_, 0, 1);
    }

    void releaseJs() {
        if (tsfn_) {
            tsfn_.Release();
            tsfn_ = Napi::ThreadSafeFunction();
        }
    }

    void emit(Payload payload) {
        if (!tsfn_) return;
        auto* heap = new Payload(std::move(payload));
        auto status = tsfn_.BlockingCall(heap, [](Napi::Env env, Napi::Function jsCallback, Payload* p) {
            p->callJs(env, jsCallback);
            delete p;
        });
        if (status != napi_ok) {
            delete heap;
        }
    }

private:
    Napi::ThreadSafeFunction tsfn_;
    const char* debugName_;
};

// JsSet handler 通用实现: 把 (release-or-bind + swift-setter 调用) 这两步合一.
// trampoline 总是非 null — 解绑时只断 JS 端, swift 端调用 setter(nullptr).
template <typename Channel, typename Trampoline>
static Napi::Value JsSetForwardCallback(
    const Napi::CallbackInfo& info,
    Channel& channel,
    void (*setter)(Trampoline),
    Trampoline trampoline)
{
    Napi::Env env = info.Env();
    if (info.Length() == 0 || info[0].IsNull() || info[0].IsUndefined()) {
        channel.releaseJs();
        setter(nullptr);
        return env.Undefined();
    }
    channel.bindJs(env, info[0].As<Napi::Function>());
    setter(trampoline);
    return env.Undefined();
}

// ---- Keyboard forward (Cmd+key 全局快捷键转 renderer) ----
struct KeyForwardPayload {
    long windowId;
    unsigned long modifiers;
    std::string chars;
    void callJs(Napi::Env env, Napi::Function jsCallback) {
        jsCallback.Call({
            Napi::Number::New(env, static_cast<double>(windowId)),
            Napi::Number::New(env, static_cast<double>(modifiers)),
            Napi::String::New(env, chars),
        });
    }
};
static ForwardChannel<KeyForwardPayload> g_keyboardChannel("PierKeyForward");
static void g_keyForwardTrampoline(long windowId, unsigned long modifiers, const char* chars) {
    g_keyboardChannel.emit({ windowId, modifiers, std::string(chars) });
}
static Napi::Value JsSetKeyboardForwardCallback(const Napi::CallbackInfo& info) {
    return JsSetForwardCallback(info, g_keyboardChannel,
                                ghostty_bridge_set_keyboard_forward_callback,
                                &g_keyForwardTrampoline);
}

static Napi::Value JsSetAppShortcutKeys(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() == 0 || !info[0].IsArray()) {
        ghostty_bridge_set_app_shortcut_keys(nullptr, 0);
        return env.Undefined();
    }
    Napi::Array arr = info[0].As<Napi::Array>();
    std::vector<std::string> holders;
    std::vector<const char*> ptrs;
    holders.reserve(arr.Length());
    ptrs.reserve(arr.Length());
    for (uint32_t i = 0; i < arr.Length(); i++) {
        Napi::Value value = arr.Get(i);
        if (!value.IsString()) continue;
        holders.push_back(value.As<Napi::String>().Utf8Value());
        ptrs.push_back(holders.back().c_str());
    }
    ghostty_bridge_set_app_shortcut_keys(ptrs.empty() ? nullptr : ptrs.data(),
                                         static_cast<long>(ptrs.size()));
    return env.Undefined();
}

// ---- Right-mouse forward (terminal 区域右键转 native menu trigger) ----
struct MouseForwardPayload {
    long windowId;
    std::string panelId;
    double x;
    double y;
    void callJs(Napi::Env env, Napi::Function jsCallback) {
        jsCallback.Call({
            Napi::Number::New(env, static_cast<double>(windowId)),
            Napi::String::New(env, panelId),
            Napi::Number::New(env, x),
            Napi::Number::New(env, y),
        });
    }
};
static ForwardChannel<MouseForwardPayload> g_mouseChannel("PierMouseForward");
static void g_mouseForwardTrampoline(long windowId, const char* panelId, double x, double y) {
    g_mouseChannel.emit({ windowId, std::string(panelId), x, y });
}
static Napi::Value JsSetMouseForwardCallback(const Napi::CallbackInfo& info) {
    return JsSetForwardCallback(info, g_mouseChannel,
                                ghostty_bridge_set_mouse_forward_callback,
                                &g_mouseForwardTrampoline);
}

// ---- Terminal focus request forward (terminal 左键点击 → renderer 激活 tab) ----
struct TerminalFocusRequestPayload {
    long windowId;
    std::string panelId;
    void callJs(Napi::Env env, Napi::Function jsCallback) {
        jsCallback.Call({
            Napi::Number::New(env, static_cast<double>(windowId)),
            Napi::String::New(env, panelId),
        });
    }
};
static ForwardChannel<TerminalFocusRequestPayload> g_terminalFocusRequestChannel("PierTerminalFocusRequest");
static void g_terminalFocusRequestTrampoline(long windowId, const char* panelId) {
    g_terminalFocusRequestChannel.emit({ windowId, std::string(panelId) });
}
static Napi::Value JsSetTerminalFocusRequestCallback(const Napi::CallbackInfo& info) {
    return JsSetForwardCallback(info, g_terminalFocusRequestChannel,
                                ghostty_bridge_set_terminal_focus_request_callback,
                                &g_terminalFocusRequestTrampoline);
}

// ---- PWD forward (OSC 7 cwd → renderer panel descriptor) ----
struct PwdForwardPayload {
    long windowId;
    std::string panelId;
    std::string cwd;
    void callJs(Napi::Env env, Napi::Function jsCallback) {
        jsCallback.Call({
            Napi::Number::New(env, static_cast<double>(windowId)),
            Napi::String::New(env, panelId),
            Napi::String::New(env, cwd),
        });
    }
};
static ForwardChannel<PwdForwardPayload> g_pwdChannel("PierPwdForward");
static void g_pwdForwardTrampoline(long windowId, const char* panelId, const char* cwd) {
    g_pwdChannel.emit({ windowId, std::string(panelId), std::string(cwd) });
}
static Napi::Value JsSetPwdForwardCallback(const Napi::CallbackInfo& info) {
    return JsSetForwardCallback(info, g_pwdChannel,
                                ghostty_bridge_set_pwd_forward_callback,
                                &g_pwdForwardTrampoline);
}

// ---- Title forward (OSC 0/2 → renderer panel descriptor) ----
struct TitleForwardPayload {
    long windowId;
    std::string panelId;
    std::string title;
    void callJs(Napi::Env env, Napi::Function jsCallback) {
        jsCallback.Call({
            Napi::Number::New(env, static_cast<double>(windowId)),
            Napi::String::New(env, panelId),
            Napi::String::New(env, title),
        });
    }
};
static ForwardChannel<TitleForwardPayload> g_titleChannel("PierTitleForward");
static void g_titleForwardTrampoline(long windowId, const char* panelId, const char* title) {
    g_titleChannel.emit({ windowId, std::string(panelId), std::string(title) });
}
static Napi::Value JsSetTitleForwardCallback(const Napi::CallbackInfo& info) {
    return JsSetForwardCallback(info, g_titleChannel,
                                ghostty_bridge_set_title_forward_callback,
                                &g_titleForwardTrampoline);
}

static Napi::Value JsApplyTerminalTheme(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return info.Env().Undefined();
    Napi::Object colors = info[1].As<Napi::Object>();

    // 解析必填: background / foreground.
    std::string bg = colors.Get("background").As<Napi::String>().Utf8Value();
    std::string fg = colors.Get("foreground").As<Napi::String>().Utf8Value();

    // 解析可选 cursor / selectionBackground / selectionForeground.
    // undefined / "" 视为缺失.
    std::string cursorStr;
    const char* cursorPtr = nullptr;
    Napi::Value cursorVal = colors.Get("cursor");
    if (cursorVal.IsString()) {
        cursorStr = cursorVal.As<Napi::String>().Utf8Value();
        if (!cursorStr.empty()) cursorPtr = cursorStr.c_str();
    }

    std::string selStr;
    const char* selPtr = nullptr;
    Napi::Value selVal = colors.Get("selectionBackground");
    if (selVal.IsString()) {
        selStr = selVal.As<Napi::String>().Utf8Value();
        if (!selStr.empty()) selPtr = selStr.c_str();
    }

    std::string selFgStr;
    const char* selFgPtr = nullptr;
    Napi::Value selFgVal = colors.Get("selectionForeground");
    if (selFgVal.IsString()) {
        selFgStr = selFgVal.As<Napi::String>().Utf8Value();
        if (!selFgStr.empty()) selFgPtr = selFgStr.c_str();
    }

    // palette: 长度 16, 每项 string. 不足则 NoOp (renderer 端 derive 保证 16 槽).
    Napi::Array paletteArr = colors.Get("palette").As<Napi::Array>();
    if (paletteArr.Length() != 16) {
        return info.Env().Undefined();
    }
    std::string paletteStrs[16];
    const char* palettePtrs[16];
    for (uint32_t i = 0; i < 16; ++i) {
        paletteStrs[i] = paletteArr.Get(i).As<Napi::String>().Utf8Value();
        palettePtrs[i] = paletteStrs[i].c_str();
    }

    ghostty_bridge_apply_theme(
        (__bridge void*)win,
        bg.c_str(),
        fg.c_str(),
        cursorPtr,
        selPtr,
        selFgPtr,
        palettePtrs
    );
    return info.Env().Undefined();
}

static Napi::Value JsSetFontConfig(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return info.Env().Undefined();
    std::string fontFamily = info[1].As<Napi::String>().Utf8Value();
    float fontSize = info[2].As<Napi::Number>().FloatValue();
    ghostty_bridge_set_font_config(
        (__bridge void*)win,
        fontFamily.c_str(),
        fontSize
    );
    return info.Env().Undefined();
}

static Napi::Value JsSetTerminalConfig(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return info.Env().Undefined();
    Napi::Object config = info[1].As<Napi::Object>();
    std::string cursorStyle = config.Get("cursorStyle").As<Napi::String>().Utf8Value();
    bool cursorBlink = config.Get("cursorBlink").As<Napi::Boolean>().Value();
    double scrollbackLimitBytes = config.Get("scrollbackLimitBytes").As<Napi::Number>().DoubleValue();
    bool pasteProtection = config.Get("pasteProtection").As<Napi::Boolean>().Value();
    ghostty_bridge_set_terminal_config(
        (__bridge void*)win,
        cursorStyle.c_str(),
        cursorBlink,
        scrollbackLimitBytes,
        pasteProtection
    );
    return info.Env().Undefined();
}

static Napi::Value JsSetActivePanelKind(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return info.Env().Undefined();
    long kindRaw = static_cast<long>(info[1].As<Napi::Number>().Int64Value());
    const char* panelIdC = nullptr;
    std::string panelIdHolder;
    if (info.Length() > 2 && info[2].IsString()) {
        panelIdHolder = info[2].As<Napi::String>().Utf8Value();
        panelIdC = panelIdHolder.c_str();
    }
    ghostty_bridge_set_active_panel_kind((__bridge void*)win, kindRaw, panelIdC);
    return info.Env().Undefined();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("setupWindow",     Napi::Function::New(env, JsSetupWindow));
    exports.Set("setOverlayActive", Napi::Function::New(env, JsSetOverlayActive));
    exports.Set("createTerminal",  Napi::Function::New(env, JsCreateTerminal));
    exports.Set("setFrame",        Napi::Function::New(env, JsSetFrame));
    exports.Set("showTerminal",    Napi::Function::New(env, JsShow));
    exports.Set("hideTerminal",    Napi::Function::New(env, JsHide));
    exports.Set("closeTerminal",   Napi::Function::New(env, JsClose));
    exports.Set("focusTerminal",   Napi::Function::New(env, JsFocus));
    exports.Set("performTerminalBindingAction", Napi::Function::New(env, JsPerformBindingAction));
    exports.Set("closeAllTerminals", Napi::Function::New(env, JsCloseAll));
    exports.Set("reconcileTerminals", Napi::Function::New(env, JsReconcile));
    exports.Set("detachWindow",    Napi::Function::New(env, JsDetachWindow));
    exports.Set("setKeyboardForwardCallback", Napi::Function::New(env, JsSetKeyboardForwardCallback));
    exports.Set("setAppShortcutKeys", Napi::Function::New(env, JsSetAppShortcutKeys));
    exports.Set("setPwdForwardCallback", Napi::Function::New(env, JsSetPwdForwardCallback));
    exports.Set("setTitleForwardCallback", Napi::Function::New(env, JsSetTitleForwardCallback));
    exports.Set("setActivePanelKind", Napi::Function::New(env, JsSetActivePanelKind));
    exports.Set("setMouseForwardCallback", Napi::Function::New(env, JsSetMouseForwardCallback));
    exports.Set("setTerminalFocusRequestCallback", Napi::Function::New(env, JsSetTerminalFocusRequestCallback));
    exports.Set("applyTerminalTheme", Napi::Function::New(env, JsApplyTerminalTheme));
    exports.Set("setTerminalFont", Napi::Function::New(env, JsSetFontConfig));
    exports.Set("setTerminalConfig", Napi::Function::New(env, JsSetTerminalConfig));
    return exports;
}

NODE_API_MODULE(ghostty_native, Init)
