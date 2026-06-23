// native/src/addon.mm — N-API bridge: JS ↔ C ABI (GhosttyBridge.swift)
#import <AppKit/AppKit.h>
#import <napi.h>
#include <string>

extern "C" {
    bool ghostty_bridge_setup_window(void* nsWindow, long browserWindowId);
    void ghostty_bridge_set_overlay_active(void* nsWindow, bool active);
    bool ghostty_bridge_create_terminal(void* nsWindow, const char* panelId,
                                         double x, double y, double w, double h);
    void ghostty_bridge_set_frame(const char* panelId,
                                   double x, double y, double w, double h);
    void ghostty_bridge_show(const char* panelId);
    void ghostty_bridge_hide(const char* panelId);
    void ghostty_bridge_close(const char* panelId);
    void ghostty_bridge_focus(const char* panelId);
    void ghostty_bridge_close_all(void* nsWindow);
    void ghostty_bridge_detach_window(void* nsWindow);
    // C 函数指针 typedef 让 swift cb 能传给 N-API ThreadSafeFunction 持有的 trampoline.
    // 签名: (browserWindowId, modifierFlags, chars UTF-8). browserWindowId 是 Electron
    // BrowserWindow.id, 让 main 端按 window id 路由 (多窗口下 getFocusedWindow 不准).
    typedef void (*KeyboardForwardFn)(long browserWindowId, unsigned long modifiers, const char* chars);
    void ghostty_bridge_set_keyboard_forward_callback(KeyboardForwardFn cb);
    // PWD forward: swift TerminalSurfacePwdDelegate 收到 OSC 7 → 此 trampoline → JS.
    // 签名 (browserWindowId, panelId UTF-8, cwd UTF-8). 与 keyboard forward 同模式.
    typedef void (*PwdForwardFn)(long browserWindowId, const char* panelId, const char* cwd);
    void ghostty_bridge_set_pwd_forward_callback(PwdForwardFn cb);
    // Title forward: swift TerminalSurfaceTitleDelegate 收到 OSC 0/2 → 此 trampoline → JS.
    // 签名 (browserWindowId, panelId UTF-8, title UTF-8). 与 PWD 同模式.
    typedef void (*TitleForwardFn)(long browserWindowId, const char* panelId, const char* title);
    void ghostty_bridge_set_title_forward_callback(TitleForwardFn cb);
    void ghostty_bridge_set_active_panel_kind(void* nsWindow, long kindRaw, const char* panelId);
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
    bool ok = ghostty_bridge_create_terminal((__bridge void*)win, panelId.c_str(), x, y, w, h);
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

static Napi::Value JsCloseAll(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return info.Env().Undefined();
    ghostty_bridge_close_all((__bridge void*)win);
    return info.Env().Undefined();
}

static Napi::Value JsDetachWindow(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return info.Env().Undefined();
    ghostty_bridge_detach_window((__bridge void*)win);
    return info.Env().Undefined();
}

// ---- Keyboard forward callback (swift → main JS) ----
//
// swift NSEvent monitor 捕获 Cmd+key 时, 通过 C 函数指针 (g_keyForwardTrampoline)
// 调到这里, 我们通过 ThreadSafeFunction 把事件分发到 main 进程的 JS 线程, 让 JS
// 端注册的 callback 收到 { modifiers, chars }.
//
// 不能直接在 swift 线程调 napi function (会 crash) — ThreadSafeFunction 是 N-API
// 标准的跨线程 callback 桥.
static Napi::ThreadSafeFunction g_keyboardTSFN;

struct KeyForwardPayload {
    long windowId;
    unsigned long modifiers;
    std::string chars;  // heap-owned (跨线程持久化)
};

static void g_keyForwardTrampoline(long windowId, unsigned long modifiers, const char* chars) {
    if (!g_keyboardTSFN) return;
    auto* payload = new KeyForwardPayload{ windowId, modifiers, std::string(chars) };
    auto status = g_keyboardTSFN.BlockingCall(payload, [](Napi::Env env, Napi::Function jsCallback, KeyForwardPayload* p) {
        jsCallback.Call({
            Napi::Number::New(env, static_cast<double>(p->windowId)),
            Napi::Number::New(env, static_cast<double>(p->modifiers)),
            Napi::String::New(env, p->chars),
        });
        delete p;
    });
    if (status != napi_ok) {
        delete payload;
    }
}

static Napi::Value JsSetKeyboardForwardCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() == 0 || info[0].IsNull() || info[0].IsUndefined()) {
        if (g_keyboardTSFN) {
            g_keyboardTSFN.Release();
            g_keyboardTSFN = Napi::ThreadSafeFunction();
        }
        ghostty_bridge_set_keyboard_forward_callback(nullptr);
        return env.Undefined();
    }
    Napi::Function jsFn = info[0].As<Napi::Function>();
    if (g_keyboardTSFN) g_keyboardTSFN.Release();
    g_keyboardTSFN = Napi::ThreadSafeFunction::New(env, jsFn, "PierKeyForward", 0, 1);
    ghostty_bridge_set_keyboard_forward_callback(&g_keyForwardTrampoline);
    return env.Undefined();
}

// ---- PWD forward callback (swift → main JS) ----
//
// swift TerminalSurfacePwdDelegate 收到 OSC 7 → forwardPwdCallback → 这里. 通过
// ThreadSafeFunction 把事件分发到 main JS 线程, 让 JS 端注册的 callback 收到
// (browserWindowId, panelId, cwd).
//
// 与 keyboard forward 同模式 — 不能在 swift 线程直接调 napi function (会 crash),
// ThreadSafeFunction 是 N-API 标准的跨线程 callback 桥.
static Napi::ThreadSafeFunction g_pwdTSFN;

struct PwdForwardPayload {
    long windowId;
    std::string panelId;  // heap-owned (跨线程持久化)
    std::string cwd;
};

static void g_pwdForwardTrampoline(long windowId, const char* panelId, const char* cwd) {
    if (!g_pwdTSFN) return;
    auto* payload = new PwdForwardPayload{ windowId, std::string(panelId), std::string(cwd) };
    auto status = g_pwdTSFN.BlockingCall(payload, [](Napi::Env env, Napi::Function jsCallback, PwdForwardPayload* p) {
        jsCallback.Call({
            Napi::Number::New(env, static_cast<double>(p->windowId)),
            Napi::String::New(env, p->panelId),
            Napi::String::New(env, p->cwd),
        });
        delete p;
    });
    if (status != napi_ok) {
        delete payload;
    }
}

static Napi::Value JsSetPwdForwardCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() == 0 || info[0].IsNull() || info[0].IsUndefined()) {
        if (g_pwdTSFN) {
            g_pwdTSFN.Release();
            g_pwdTSFN = Napi::ThreadSafeFunction();
        }
        ghostty_bridge_set_pwd_forward_callback(nullptr);
        return env.Undefined();
    }
    Napi::Function jsFn = info[0].As<Napi::Function>();
    if (g_pwdTSFN) g_pwdTSFN.Release();
    g_pwdTSFN = Napi::ThreadSafeFunction::New(env, jsFn, "PierPwdForward", 0, 1);
    ghostty_bridge_set_pwd_forward_callback(&g_pwdForwardTrampoline);
    return env.Undefined();
}

// ---- Title forward callback (swift OSC 0/2 → main JS) ----
//
// 与 PWD forward 同模式. TUI 应用 (claude / vim / aider) 主动通过 OSC 0/2 写
// 自定义 title, swift TerminalSurfaceTitleDelegate 接, 经 ThreadSafeFunction
// 跨线程到 JS.
static Napi::ThreadSafeFunction g_titleTSFN;

struct TitleForwardPayload {
    long windowId;
    std::string panelId;
    std::string title;
};

static void g_titleForwardTrampoline(long windowId, const char* panelId, const char* title) {
    if (!g_titleTSFN) return;
    auto* payload = new TitleForwardPayload{ windowId, std::string(panelId), std::string(title) };
    auto status = g_titleTSFN.BlockingCall(payload, [](Napi::Env env, Napi::Function jsCallback, TitleForwardPayload* p) {
        jsCallback.Call({
            Napi::Number::New(env, static_cast<double>(p->windowId)),
            Napi::String::New(env, p->panelId),
            Napi::String::New(env, p->title),
        });
        delete p;
    });
    if (status != napi_ok) {
        delete payload;
    }
}

static Napi::Value JsSetTitleForwardCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() == 0 || info[0].IsNull() || info[0].IsUndefined()) {
        if (g_titleTSFN) {
            g_titleTSFN.Release();
            g_titleTSFN = Napi::ThreadSafeFunction();
        }
        ghostty_bridge_set_title_forward_callback(nullptr);
        return env.Undefined();
    }
    Napi::Function jsFn = info[0].As<Napi::Function>();
    if (g_titleTSFN) g_titleTSFN.Release();
    g_titleTSFN = Napi::ThreadSafeFunction::New(env, jsFn, "PierTitleForward", 0, 1);
    ghostty_bridge_set_title_forward_callback(&g_titleForwardTrampoline);
    return env.Undefined();
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
    exports.Set("closeAllTerminals", Napi::Function::New(env, JsCloseAll));
    exports.Set("detachWindow",    Napi::Function::New(env, JsDetachWindow));
    exports.Set("setKeyboardForwardCallback", Napi::Function::New(env, JsSetKeyboardForwardCallback));
    exports.Set("setPwdForwardCallback", Napi::Function::New(env, JsSetPwdForwardCallback));
    exports.Set("setTitleForwardCallback", Napi::Function::New(env, JsSetTitleForwardCallback));
    exports.Set("setActivePanelKind", Napi::Function::New(env, JsSetActivePanelKind));
    return exports;
}

NODE_API_MODULE(ghostty_native, Init)
